import { parse, type Entry } from '@fluent/syntax';
import { buildKeyCandidates } from './utils';
import { toFluentSource, type MessageSource } from './catalog';

/**
 * Usage analysis: the inverse of message extraction.
 *
 * `next-intl extract` scans source code because there the code is the source of
 * truth and the JSON catalog is a hand-maintained shadow. next-fluent inverts
 * that: the catalog is the source of truth and `typegen` derives types from it,
 * so `t('unknown')` is already a compile error.
 *
 * What static types cannot tell you is the other direction — which catalog
 * messages nobody renders any more, and which call sites are too dynamic to
 * verify. This module answers exactly that, and never writes to a catalog.
 */

export type UsageIssueKind = 'unused' | 'missing' | 'dynamic' | 'missing-attributes';

export interface UsageIssue {
  kind: UsageIssueKind;
  /** Catalog key the issue is about, when there is one. */
  key?: string;
  /** Source file the issue was found in, for call-site issues. */
  file?: string;
  line?: number;
  message: string;
}

export interface UsageReport {
  referenceLocale: string;
  catalogKeys: string[];
  usedKeys: string[];
  /** Call sites whose key could not be resolved statically. */
  dynamicSites: number;
  issues: UsageIssue[];
}

export interface AnalyzeUsageOptions {
  /** Locale whose key set defines the catalog. Defaults to the first key. */
  referenceLocale?: string;
  /** Report catalog keys that no call site references. Defaults to `true`. */
  reportUnused?: boolean;
  /** Key prefixes exempt from the `unused` report (e.g. dynamically built namespaces). */
  ignore?: readonly string[];
}

/** One source file to scan. */
export interface SourceFile {
  path: string;
  content: string;
}

const CALL_METHODS = ['rich', 'attrs', 'plain', 'markup', 'has', 'exists'] as const;
type CallMethod = (typeof CALL_METHODS)[number];

/** Translator factories whose result is called with a message key. */
const FACTORIES = ['useTranslations', 'getTranslations', 'createTranslator'];

/** Comment marker exempting a call site from the usage report. */
export const IGNORE_MARKER = 'next-fluent-ignore';

interface CallSite {
  method: CallMethod | undefined;
  /** Raw source of the first argument. */
  argument: string;
  line: number;
}

/** Reads the first argument of a call starting at the opening parenthesis. */
function readFirstArgument(code: string, openParen: number): string | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return code.slice(openParen + 1, i).trim();
    } else if (depth === 1 && ch === ',') {
      return code.slice(openParen + 1, i).trim();
    }
  }
  return undefined;
}

/** Unwraps a plain string literal (single, double or static template). */
function staticString(argument: string): string | undefined {
  const match = /^(['"`])([\s\S]*)\1$/.exec(argument);
  if (!match) return undefined;
  // A template with an interpolation is not a static key.
  if (match[1] === '`' && match[2].includes('${')) return undefined;
  return match[2];
}

function namespaceOf(argument: string | undefined): string | undefined {
  if (!argument) return undefined;
  const literal = staticString(argument);
  if (literal !== undefined) return literal || undefined;
  const named = /namespace\s*:\s*(['"`])([^'"`]*)\1/.exec(argument);
  return named?.[2] || undefined;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

/**
 * Lines exempt from reporting.
 *
 * `// next-fluent-ignore` covers its own line and the line below it, so it can
 * sit either above a call or at its end. Ignoring a call site suppresses its
 * `missing`/`dynamic` issues while still counting a resolvable key as used.
 */
function ignoredLines(content: string): Set<number> {
  const ignored = new Set<number>();
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (!line.includes(IGNORE_MARKER)) return;
    ignored.add(index + 1);
    ignored.add(index + 2);
  });
  return ignored;
}

/** Finds translator bindings and the call sites that use them. */
export function collectCallSites(file: SourceFile): {
  bindings: Map<string, string | undefined>;
  sites: (CallSite & { namespace?: string; ignored: boolean })[];
} {
  const { content } = file;
  const bindings = new Map<string, string | undefined>();
  const sites: (CallSite & { namespace?: string; ignored: boolean })[] = [];
  const suppressed = ignoredLines(content);

  // 1. Bindings: `const t = useTranslations('ns')`, optionally awaited, and the
  //    object form `getTranslations({ namespace: 'ns', locale })`.
  const factoryPattern = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(${FACTORIES.join('|')})\\s*\\(`,
    'g'
  );
  for (let match = factoryPattern.exec(content); match; match = factoryPattern.exec(content)) {
    const openParen = match.index + match[0].length - 1;
    bindings.set(match[1], namespaceOf(readFirstArgument(content, openParen)));
  }

  // 2. Direct factory calls: `(await getTranslations('ns'))('key')` and
  //    `getTranslations('ns')` used inline. The namespace still applies.
  const inlinePattern = new RegExp(`(${FACTORIES.join('|')})\\s*\\(`, 'g');
  const inlineNamespaces: { index: number; namespace?: string }[] = [];
  for (let match = inlinePattern.exec(content); match; match = inlinePattern.exec(content)) {
    const openParen = match.index + match[0].length - 1;
    inlineNamespaces.push({
      index: match.index,
      namespace: namespaceOf(readFirstArgument(content, openParen)),
    });
  }

  // 3. Call sites: `t('key')`, `t.rich('key')`, … for every known binding, plus
  //    the conventional bare names used by the server API and by tests.
  const names = new Set([...bindings.keys(), 't', 'translate']);
  const methodAlternatives = CALL_METHODS.join('|');
  const callPattern = new RegExp(
    `\\b(${[...names].map((name) => name.replace(/\$/g, '\\$')).join('|')})\\s*(?:\\.\\s*(${methodAlternatives}))?\\s*\\(`,
    'g'
  );

  for (let match = callPattern.exec(content); match; match = callPattern.exec(content)) {
    const name = match[1];
    // Skip the factory declarations themselves.
    if ((FACTORIES as string[]).includes(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const argument = readFirstArgument(content, openParen);
    if (argument === undefined) continue;
    const namespace = bindings.has(name)
      ? bindings.get(name)
      : inlineNamespaces.find((entry) => entry.index < match.index)?.namespace;
    const line = lineOf(content, match.index);
    sites.push({
      method: match[2] as CallMethod | undefined,
      argument,
      line,
      namespace,
      ignored: suppressed.has(line),
    });
  }

  return { bindings, sites };
}

interface CatalogIndex {
  keys: Set<string>;
  /** Message ids that define at least one attribute. */
  withAttributes: Set<string>;
}

function indexCatalog(source: MessageSource): CatalogIndex {
  const combined = toFluentSource(source);
  const text = typeof combined === 'string' ? combined : combined.join('\n');
  const resource = parse(text, { withSpans: false });
  const keys = new Set<string>();
  const withAttributes = new Set<string>();

  for (const entry of resource.body as Entry[]) {
    if (entry.type !== 'Message') continue;
    if (entry.value) keys.add(entry.id.name);
    for (const attr of entry.attributes) {
      keys.add(`${entry.id.name}.${attr.id.name}`);
      withAttributes.add(entry.id.name);
    }
  }

  return { keys, withAttributes };
}

function isIgnored(key: string, ignore: readonly string[]): boolean {
  return ignore.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}-`));
}

/**
 * Compares a catalog against the call sites found in `sources`.
 *
 * Deliberately conservative: anything that cannot be resolved to a literal key
 * is reported as `dynamic` instead of being guessed at, so the `unused` report
 * never claims a message is dead just because the analyzer could not see it.
 */
export function analyzeUsage(
  catalogs: Record<string, MessageSource>,
  sources: readonly SourceFile[],
  options: AnalyzeUsageOptions = {}
): UsageReport {
  const locales = Object.keys(catalogs);
  const referenceLocale = options.referenceLocale ?? locales[0] ?? '';
  if (referenceLocale && !Object.prototype.hasOwnProperty.call(catalogs, referenceLocale)) {
    throw new Error(
      `[next-fluent] Reference locale "${referenceLocale}" is not part of the analyzed catalogs (${locales.join(', ')}).`
    );
  }

  const index = referenceLocale ? indexCatalog(catalogs[referenceLocale]) : { keys: new Set<string>(), withAttributes: new Set<string>() };
  const ignore = options.ignore ?? [];

  const usedKeys = new Set<string>();
  const issues: UsageIssue[] = [];
  let dynamicSites = 0;

  for (const file of sources) {
    const { sites } = collectCallSites(file);
    for (const site of sites) {
      const key = staticString(site.argument);
      if (key === undefined) {
        // Not a string literal: types cannot verify this call either. An
        // ignored site is a deliberate "the analyzer cannot see this" marker.
        if (site.argument.trim() !== '' && !site.ignored) {
          dynamicSites++;
          issues.push({
            kind: 'dynamic',
            file: file.path,
            line: site.line,
            message: `Key is not a string literal and cannot be checked statically.`,
          });
        }
        continue;
      }

      const candidates = buildKeyCandidates(site.namespace, key);
      const resolved = candidates.find((candidate) => index.keys.has(candidate));
      if (resolved) {
        usedKeys.add(resolved);
        // `t.attrs(key)` reads every attribute at once, so all of them count as
        // used — otherwise the report flags attributes the app does render.
        if (site.method === 'attrs') {
          for (const candidate of index.keys) {
            if (candidate.startsWith(`${resolved}.`)) usedKeys.add(candidate);
          }
        }
        if ((site.method === 'attrs' || site.method === 'plain') && !index.withAttributes.has(resolved)) {
          issues.push({
            kind: 'missing-attributes',
            key: resolved,
            file: file.path,
            line: site.line,
            message: `t.${site.method}("${key}") was called, but "${resolved}" defines no attributes.`,
          });
        }
        continue;
      }

      // Unknown key. In TypeScript this is already a compile error; it is
      // reported here so JS projects and CI summaries see it too.
      if (site.ignored) continue;
      issues.push({
        kind: 'missing',
        key: candidates[0],
        file: file.path,
        line: site.line,
        message: `"${key}" is used in ${file.path} but is missing from ${referenceLocale || 'the catalog'}.`,
      });
    }
  }

  if (options.reportUnused !== false) {
    for (const key of [...index.keys].sort()) {
      if (usedKeys.has(key) || isIgnored(key, ignore)) continue;
      issues.push({
        kind: 'unused',
        key,
        message: `"${key}" is defined in ${referenceLocale || 'the catalog'} but never referenced in the scanned sources.`,
      });
    }
  }

  return {
    referenceLocale,
    catalogKeys: [...index.keys].sort(),
    usedKeys: [...usedKeys].sort(),
    dynamicSites,
    issues,
  };
}

/** Human-readable rendering of a usage report, grouped by severity. */
export function formatUsageReport(report: UsageReport): string {
  const lines: string[] = [];
  lines.push(
    `Usage against ${report.referenceLocale || 'the catalog'}: ` +
      `${report.usedKeys.length}/${report.catalogKeys.length} keys used, ${report.dynamicSites} dynamic call site(s).`
  );

  const groups: UsageIssueKind[] = ['missing', 'missing-attributes', 'dynamic', 'unused'];
  for (const kind of groups) {
    const subset = report.issues.filter((issue) => issue.kind === kind);
    if (subset.length === 0) continue;
    lines.push('');
    lines.push(`${kind} (${subset.length})`);
    for (const issue of subset) {
      const where = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
      lines.push(`  ${issue.message}${where}`);
    }
  }

  return lines.join('\n');
}
