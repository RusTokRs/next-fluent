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

// Every method of `Translations` that takes a key. `raw` used to be missing,
// so `t.raw('key')` was invisible to the analyzer and its key was reported as
// unused — a false positive that fails `--strict-usage`.
const CALL_METHODS = ['raw', 'rich', 'attrs', 'plain', 'has'] as const;
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

/** Index just past the string/template literal that starts at `start`. */
function skipLiteral(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && source[i + 1] === '{') {
      // Interpolation: skip to the matching brace, honouring nested literals.
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === '{') depth++;
        else if (inner === '}') depth--;
        else if (inner === '"' || inner === "'" || inner === '`') {
          i = skipLiteral(source, i);
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return source.length;
}

/** Index just past the regex literal starting at `start`, or `start` if it is not one. */
function skipRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return start;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < source.length && /[a-z]/.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return start;
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/** Whether a `/` at this point starts a regex rather than a division. */
function regexAllowed(source: string, index: number, lastSignificant: string): boolean {
  if (lastSignificant === '') return true;
  if (lastSignificant === ')') return false;
  if (/[A-Za-z0-9_$\])]/.test(lastSignificant)) {
    // Could be `x / y`, or `return /re/`. Look at the preceding word.
    let end = index;
    while (end > 0 && /\s/.test(source[end - 1])) end--;
    let wordEnd = end;
    while (wordEnd > 0 && /[A-Za-z_$]/.test(source[wordEnd - 1])) wordEnd--;
    const word = source.slice(wordEnd, end);
    return word !== '' && REGEX_PRECEDING_KEYWORDS.has(word);
  }
  return true;
}

/**
 * Blanks out everything that is not executable code — comments, string and
 * template literals, regex literals — replacing each character with a space.
 *
 * Length and line breaks are preserved, so indices and line numbers computed on
 * the masked copy still point at the same place in the original. Without this,
 * a commented-out `t('key')` or the text of a string counts as a call site.
 *
 * Template literals are handled with a stack: their literal text is blanked,
 * but the code inside `${…}` stays visible, because that is where real call
 * sites live.
 */
function maskNonCode(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  /** `'template'` inside template text, a number inside a `${…}` expression. */
  const stack: ('template' | number)[] = [];

  let i = 0;
  let lastSignificant = '';
  while (i < source.length) {
    const ch = source[i];
    const top = stack[stack.length - 1];

    if (top === 'template') {
      if (ch === '\\') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        out[i] = ' ';
        stack.pop();
        lastSignificant = ')';
        i++;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        out[i] = ' ';
        out[i + 1] = ' ';
        stack.push(1);
        i += 2;
        continue;
      }
      if (ch !== '\n') out[i] = ' ';
      i++;
      continue;
    }

    if (typeof top === 'number') {
      if (ch === '{') {
        stack[stack.length - 1] = top + 1;
        lastSignificant = ch;
        i++;
        continue;
      }
      if (ch === '}') {
        if (top === 1) {
          stack.pop();
          out[i] = ' ';
          i++;
          continue;
        }
        stack[stack.length - 1] = top - 1;
        lastSignificant = ch;
        i++;
        continue;
      }
    }

    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '`') {
      out[i] = ' ';
      stack.push('template');
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipLiteral(source, i);
      blank(i, end);
      i = end;
      lastSignificant = ')';
      continue;
    }
    if (ch === '/' && regexAllowed(source, i, lastSignificant)) {
      const end = skipRegex(source, i);
      if (end > i) {
        blank(i, end);
        i = end;
        lastSignificant = ')';
        continue;
      }
    }

    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return out.join('');
}

/**
 * Resolves line numbers for a strictly increasing sequence of indices.
 *
 * Counting from the start for every call site made analysis quadratic — 20 000
 * call sites took ~8 s. Walking forward once keeps it linear.
 */
function createLineCounter(masked: string): (index: number) => number {
  let scanned = 0;
  let line = 1;
  return (index: number) => {
    for (let i = scanned; i < index; i++) {
      if (masked[i] === '\n') line++;
    }
    scanned = Math.max(scanned, index);
    return line;
  };
}

/** Finds translator bindings and the call sites that use them. */
export function collectCallSites(file: SourceFile): {
  bindings: Map<string, string | undefined>;
  sites: (CallSite & {
    namespace?: string;
    namespaceKnown: boolean;
    ambiguous: boolean;
    ignored: boolean;
  })[];
} {
  const { content } = file;
  // Patterns run on the masked copy so comments, strings and regex literals
  // cannot pose as call sites; arguments are read from the original text.
  const masked = maskNonCode(content);
  const lineAt = createLineCounter(masked);
  const bindings = new Map<string, string | undefined>();
  const sites: (CallSite & {
    namespace?: string;
    namespaceKnown: boolean;
    ambiguous: boolean;
    ignored: boolean;
  })[] = [];
  const suppressed = ignoredLines(content);

  // 1. Bindings: `const t = useTranslations('ns')`, optionally awaited, and the
  //    object form `getTranslations({ namespace: 'ns', locale })`.
  const factoryPattern = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(${FACTORIES.join('|')})\\s*\\(`,
    'g'
  );
  /**
   * Every `const t = useTranslations(…)` in the file, in source order.
   *
   * One file routinely holds several components, each with its own `t` bound to
   * a different namespace. Keeping only the last binding made an earlier call
   * resolve against the wrong namespace and report a key as missing.
   */
  const bindingList: { index: number; name: string; namespace: string | undefined }[] = [];
  for (let match = factoryPattern.exec(masked); match; match = factoryPattern.exec(masked)) {
    const openParen = match.index + match[0].length - 1;
    const name = match[1];
    const namespace = namespaceOf(readFirstArgument(content, openParen));
    bindingList.push({ index: match.index, name, namespace });
    bindings.set(name, namespace);
  }

  /**
   * Resolves the namespace in effect at `index`: the nearest preceding binding
   * for that name, or the file's only binding when the call appears before it.
   * Returns `undefined` for the namespace and `false` for `known` when the name
   * is bound to several different namespaces and position cannot decide.
   */
  const namespaceAt = (
    name: string,
    index: number
  ): { namespace?: string; known: boolean; ambiguous: boolean } => {
    const own = bindingList.filter((entry) => entry.name === name);
    if (own.length === 0) return { namespace: undefined, known: false, ambiguous: false };
    const preceding = own.filter((entry) => entry.index < index);
    if (preceding.length > 0) {
      return { namespace: preceding[preceding.length - 1].namespace, known: true, ambiguous: false };
    }
    const distinct = new Set(own.map((entry) => entry.namespace ?? ''));
    if (distinct.size === 1) return { namespace: own[0].namespace, known: true, ambiguous: false };
    // Bound to several namespaces and the call precedes all of them: guessing
    // would produce a false missing-key failure, and matching against every
    // namespace would silently hide a genuine typo. Report it as unresolvable.
    return { namespace: undefined, known: false, ambiguous: true };
  };

  // 2. Call sites. Only a name bound to a translator factory in this file is
  //    known to be a translator; the conventional bare names are still scanned,
  //    but a call we cannot attribute to a binding carries no namespace
  //    knowledge, so it can never be reported as a missing key.
  const bareNames = ['t', 'translate'];
  const names = new Set([...bindings.keys(), ...bareNames]);
  const methodAlternatives = CALL_METHODS.join('|');
  const callPattern = new RegExp(
    `\\b(${[...names].map((name) => name.replace(/\$/g, '\\$')).join('|')})\\s*(?:\\.\\s*(${methodAlternatives}))?\\s*\\(`,
    'g'
  );

  for (let match = callPattern.exec(masked); match; match = callPattern.exec(masked)) {
    const name = match[1];
    if ((FACTORIES as string[]).includes(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const argument = readFirstArgument(content, openParen);
    if (argument === undefined) continue;
    const { namespace, known, ambiguous } = namespaceAt(name, match.index);
    // An unattributed call with a non-string argument (`const t = 5; t(3)`) is
    // not evidence of a translator at all — skip it instead of reporting noise.
    if (!known && staticString(argument) === undefined) continue;
    const line = lineAt(match.index);
    sites.push({
      method: match[2] as CallMethod | undefined,
      argument,
      line,
      namespace,
      namespaceKnown: known,
      ambiguous,
      ignored: suppressed.has(line),
    });
  }

  return { bindings, sites };
}

interface CatalogIndex {
  /** Every addressable key: message values and `id.attribute` paths. */
  keys: Set<string>;
  /** Message ids that define at least one attribute. */
  withAttributes: Set<string>;
  /** Message ids that define a value (not attribute-only). */
  withValue: Set<string>;
  /**
   * Message ids that exist only because they carry attributes.
   *
   * The runtime address them through `t.attrs()` / `t.raw()`, but `t()` /
   * `t.rich()` / `t.plain()` cannot render a value that does not exist. They are
   * kept apart from `keys` so a call that can never resolve is still reported.
   */
  attributeOnly: Set<string>;
}

function indexCatalog(source: MessageSource): CatalogIndex {
  const combined = toFluentSource(source);
  const text = typeof combined === 'string' ? combined : combined.join('\n');
  const resource = parse(text, { withSpans: false });
  const keys = new Set<string>();
  const withAttributes = new Set<string>();
  const withValue = new Set<string>();
  const attributeOnly = new Set<string>();

  for (const entry of resource.body as Entry[]) {
    if (entry.type !== 'Message') continue;
    if (entry.value) {
      keys.add(entry.id.name);
      withValue.add(entry.id.name);
    } else if (entry.attributes.length > 0) {
      attributeOnly.add(entry.id.name);
    }
    for (const attr of entry.attributes) {
      keys.add(`${entry.id.name}.${attr.id.name}`);
      withAttributes.add(entry.id.name);
    }
  }

  return { keys, withAttributes, withValue, attributeOnly };
}

/**
 * Matches a bare key against every namespace: `total` finds `checkout-total`
 * and `checkout.total`. Used only when the namespace is unknown.
 */
function findInAnyNamespace(
  index: CatalogIndex,
  key: string,
  accept: (candidate: string) => boolean
): string | undefined {
  const consider = (candidate: string): string | undefined => {
    if (!accept(candidate)) return undefined;
    if (candidate === key || candidate.endsWith(`.${key}`) || candidate.endsWith(`-${key}`)) {
      return candidate;
    }
    return undefined;
  };

  for (const candidate of index.keys) {
    const hit = consider(candidate);
    if (hit) return hit;
  }
  for (const candidate of index.attributeOnly) {
    const hit = consider(candidate);
    if (hit) return hit;
  }
  return undefined;
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

  const index: CatalogIndex = referenceLocale
    ? indexCatalog(catalogs[referenceLocale])
    : {
        keys: new Set<string>(),
        withAttributes: new Set<string>(),
        withValue: new Set<string>(),
        attributeOnly: new Set<string>(),
      };
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

      // A call we cannot attribute to a binding in this file (a translator
      // passed via props, for instance) carries no namespace knowledge. Such a
      // call is matched against every namespace, and if nothing matches it is
      // reported as unverifiable rather than as a missing key — failing a build
      // over a call site we cannot attribute would be a false positive.
      // The name is bound in this file, but to several namespaces and only
      // after this call site. Neither the namespace nor a global lookup can
      // answer here, so the call is unverifiable rather than wrong.
      if (site.ambiguous && !site.ignored) {
        dynamicSites++;
        issues.push({
          kind: 'dynamic',
          key,
          file: file.path,
          line: site.line,
          message: `Several namespaces bind this translator in the file and the call precedes all of them, so the namespace cannot be determined statically.`,
        });
        continue;
      }

      // `t.attrs(key)` and `t.raw(key)` render attribute-only messages, and
      // `t.has(key)` is a legitimate probe for them (it answers false).
      // Value-reading calls cannot use such an id, so the method decides
      // whether it counts as resolved.
      const readsAttributes =
        site.method === 'attrs' || site.method === 'raw' || site.method === 'has';
      const accept = (candidate: string): boolean =>
        index.keys.has(candidate) ||
        (readsAttributes && index.attributeOnly.has(candidate));

      const resolved = site.namespaceKnown
        ? buildKeyCandidates(site.namespace, key).find(accept)
        : findInAnyNamespace(index, key, accept);
      if (resolved) {
        usedKeys.add(resolved);
        // `t.attrs(key)` reads every attribute at once, and so does `t.raw(key)`
        // for a message that has no value (it returns their values as a list),
        // so all of them count as used — otherwise the report flags attributes
        // the app does render.
        if (site.method === 'attrs' || (site.method === 'raw' && !index.withValue.has(resolved))) {
          for (const candidate of index.keys) {
            if (candidate.startsWith(`${resolved}.`)) usedKeys.add(candidate);
          }
        }
        if (site.method === 'attrs' && !index.withAttributes.has(resolved)) {
          issues.push({
            kind: 'missing-attributes',
            key: resolved,
            file: file.path,
            line: site.line,
            message: `t.attrs("${key}") was called, but "${resolved}" defines no attributes.`,
          });
        }
        continue;
      }

      if (site.ignored) continue;

      // The id exists, but only as an attribute carrier. Reporting it as a key
      // that is absent from the catalog would be wrong: it is there, it simply
      // has no value for a value-reading call to render.
      const attributeOnlyHit = site.namespaceKnown
        ? buildKeyCandidates(site.namespace, key).find((candidate) => index.attributeOnly.has(candidate))
        : findInAnyNamespace(index, key, (candidate) => index.attributeOnly.has(candidate));
      if (attributeOnlyHit !== undefined) {
        issues.push({
          kind: 'missing-attributes',
          key: attributeOnlyHit,
          file: file.path,
          line: site.line,
          message:
            `${site.method ? `t.${site.method}` : 't'}("${key}") resolves to ` +
            `"${attributeOnlyHit}", which defines only attributes and no value, so it cannot be rendered as text.`,
        });
        continue;
      }

      if (!site.namespaceKnown) {
        dynamicSites++;
        issues.push({
          kind: 'dynamic',
          file: file.path,
          line: site.line,
          message:
            `"${key}" is used through a translator this file does not create, ` +
            'so its namespace cannot be verified.',
        });
        continue;
      }

      // Unknown key under a known namespace. In TypeScript this is already a
      // compile error; it is reported here so JS projects and CI summaries see
      // it too.
      issues.push({
        kind: 'missing',
        key: buildKeyCandidates(site.namespace, key)[0],
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
