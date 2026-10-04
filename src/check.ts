import { type Entry } from '@fluent/syntax';
import { parseFtl } from './ftl-parse';
import { toFluentSource, type MessageSource } from './catalog';

/**
 * Catalog consistency checking (`next-fluent check`).
 *
 * Missing translations usually surface as runtime fallbacks in production. This
 * compares every locale against a reference catalog and reports keys that are
 * missing, unexpected, duplicated or unparsable — before the app ships.
 */

export type CatalogIssueKind = 'missing' | 'extra' | 'duplicate' | 'parse-error';

export interface CatalogIssue {
  kind: CatalogIssueKind;
  locale: string;
  key?: string;
  message: string;
}

export interface CheckReport {
  referenceLocale: string;
  locales: string[];
  issues: CatalogIssue[];
  keyCount: number;
}

export interface CheckCatalogsOptions {
  /** Locale every other catalog is compared against. Defaults to the first key. */
  referenceLocale?: string;
  /** Report keys that exist in a locale but not in the reference. Default `true`. */
  reportExtra?: boolean;
}

interface CatalogKeys {
  keys: Set<string>;
  duplicates: string[];
  parseErrors: string[];
}

function collectKeys(source: string | readonly string[]): CatalogKeys {
  const combined = typeof source === 'string' ? source : source.join('\n');
  const resource = parseFtl(combined, 'The catalog');
  const keys = new Set<string>();
  const duplicates: string[] = [];
  const parseErrors: string[] = [];

  const add = (key: string) => {
    if (keys.has(key)) duplicates.push(key);
    keys.add(key);
  };

  for (const entry of resource.body as Entry[]) {
    if (entry.type === 'Junk') {
      parseErrors.push(entry.content.split('\n')[0].slice(0, 120));
      continue;
    }
    if (entry.type !== 'Message') continue;
    if (entry.value) add(entry.id.name);
    for (const attr of entry.attributes) add(`${entry.id.name}.${attr.id.name}`);
  }

  return { keys, duplicates, parseErrors };
}

/**
 * Compares catalogs against a reference locale.
 *
 * `catalogs` maps a locale to anything `loadMessages` may return (FTL text, an
 * array of sources, or a JSON catalog object).
 */
export function checkCatalogs(
  catalogs: Record<string, MessageSource>,
  options: CheckCatalogsOptions = {}
): CheckReport {
  const locales = Object.keys(catalogs);
  if (locales.length === 0) {
    return { referenceLocale: '', locales: [], issues: [], keyCount: 0 };
  }

  const referenceLocale = options.referenceLocale ?? locales[0];
  if (!Object.prototype.hasOwnProperty.call(catalogs, referenceLocale)) {
    throw new Error(
      `[next-fluent] Reference locale "${referenceLocale}" is not part of the checked catalogs (${locales.join(', ')}).`
    );
  }

  const parsed = new Map<string, CatalogKeys>();
  for (const locale of locales) {
    const source = toFluentSource(catalogs[locale]);
    parsed.set(
      locale,
      collectKeys(Array.isArray(source) ? (source as readonly string[]) : (source as string))
    );
  }

  const reference = parsed.get(referenceLocale)!;
  const issues: CatalogIssue[] = [];

  for (const locale of locales) {
    const current = parsed.get(locale)!;

    for (const error of current.parseErrors) {
      issues.push({
        kind: 'parse-error',
        locale,
        message: `Unparsable FTL: ${error}`,
      });
    }
    for (const key of current.duplicates) {
      issues.push({
        kind: 'duplicate',
        locale,
        key,
        // `addResource({ allowOverrides: true })` is what the runtime uses, and
        // it keeps the *last* definition — matching `typegen`, which also lets
        // the last one win. Saying "first" pointed translators at the wrong
        // entry to delete.
        message: `"${key}" is defined more than once; Fluent keeps the last definition.`,
      });
    }

    if (locale === referenceLocale) continue;

    for (const key of [...reference.keys].sort()) {
      if (!current.keys.has(key)) {
        issues.push({ kind: 'missing', locale, key, message: `"${key}" is missing.` });
      }
    }

    if (options.reportExtra !== false) {
      for (const key of [...current.keys].sort()) {
        if (!reference.keys.has(key)) {
          issues.push({ kind: 'extra', locale, key, message: `"${key}" does not exist in ${referenceLocale}.` });
        }
      }
    }
  }

  return { referenceLocale, locales, issues, keyCount: reference.keys.size };
}

/** Human-readable rendering of a report, suitable for CI output. */
export function formatCheckReport(report: CheckReport): string {
  if (report.locales.length === 0) return '[next-fluent] No catalogs to check.';

  const lines = [
    `[next-fluent] Checked ${report.locales.length} catalog(s) against "${report.referenceLocale}" (${report.keyCount} keys).`,
  ];

  if (report.issues.length === 0) {
    lines.push('[next-fluent] No issues found.');
    return lines.join('\n');
  }

  const byLocale = new Map<string, CatalogIssue[]>();
  for (const issue of report.issues) {
    const list = byLocale.get(issue.locale) ?? [];
    list.push(issue);
    byLocale.set(issue.locale, list);
  }

  for (const [locale, issues] of byLocale) {
    lines.push(`  ${locale}:`);
    for (const issue of issues) {
      lines.push(`    [${issue.kind}] ${issue.message}`);
    }
  }

  lines.push(`[next-fluent] ${report.issues.length} issue(s) found.`);
  return lines.join('\n');
}
