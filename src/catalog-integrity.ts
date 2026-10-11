import type { FluentResource } from '@fluent/bundle';
import { getOrCreateResource } from './cache';

/**
 * Names the catalog entries `@fluent/bundle` silently dropped.
 *
 * The runtime parser collects only the entries it understood: a message with a
 * syntax error is dropped without an error, a warning or any other trace, and
 * the only symptom is that `t('that.key')` reports MISSING_MESSAGE for a key the
 * catalog obviously defines.
 *
 * Two call sites, one policy per runtime:
 *
 * - the server runtime (`./server`) calls `warnAboutDroppedEntries`
 *   unconditionally, because that is where a Next.js app parses every catalog
 *   and where a production log line is actionable;
 * - the client provider (`./client`) calls it only when
 *   `process.env.NODE_ENV !== 'production'`, because a browser bundle ships to
 *   every visitor. Browser bundlers replace that expression with a literal, so
 *   the call — and this module with it — is dead code in a production bundle;
 *   `npm run size` fails if that ever stops being true.
 *
 * Both call sites share this module instance, so a catalog that is parsed in
 * both places is still reported once. `next-fluent check` reports the same
 * problems from the reference parser at build time, with source positions.
 */

/**
 * The id line of a message or term, at the start of a line — the same anchor
 * `@fluent/bundle` uses to find entries.
 */
const ENTRY_DECLARATION = /^(-?[a-zA-Z][\w-]*) *=/gm;

/**
 * Ids the runtime parser declared but did not turn into entries.
 *
 * The scan can only over-report inside a block the parser already dropped (the
 * text of a broken entry may contain a declaration-like line), never for a
 * catalog that parses completely: entries are the only constructs that start
 * with an id at column zero, while continuation lines, attributes and variants
 * are indented or begin with `.` / `[`.
 */
function droppedEntryIds(source: string, resource: FluentResource): string[] {
  const parsed = new Map<string, number>();
  for (const entry of resource.body as { id?: string }[]) {
    if (typeof entry.id === 'string') {
      parsed.set(entry.id, (parsed.get(entry.id) ?? 0) + 1);
    }
  }
  const dropped: string[] = [];
  ENTRY_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTRY_DECLARATION.exec(source)) !== null) {
    const remaining = parsed.get(match[1]) ?? 0;
    if (remaining > 0) {
      parsed.set(match[1], remaining - 1);
    } else if (!dropped.includes(match[1])) {
      dropped.push(match[1]);
    }
  }
  return dropped;
}

/** Catalogs already reported, so a list render or many requests cannot spam logs. */
const warnedCatalogs = new Set<string>();
const MAX_WARNED_CATALOGS = 200;

export function clearCatalogIntegrityWarnings(): void {
  warnedCatalogs.clear();
}

function warnDroppedEntries(locale: string, source: string, ids: readonly string[]): void {
  const shown = ids.slice(0, 5).map((id) => `"${id}"`).join(', ');
  const more = ids.length > 5 ? ` and ${ids.length - 5} more` : '';
  const key = `${locale}::${source.length}::${source.slice(0, 64)}`;
  if (warnedCatalogs.has(key)) return;
  if (warnedCatalogs.size >= MAX_WARNED_CATALOGS) warnedCatalogs.clear();
  warnedCatalogs.add(key);
  console.warn(
    `[next-fluent] The ${locale} catalog contains ${ids.length} ` +
      `entr${ids.length === 1 ? 'y' : 'ies'} the Fluent parser cannot read, so ` +
      `${ids.length === 1 ? 'it is' : 'they are'} missing at runtime: ${shown}${more}. ` +
      'Run `next-fluent check` for the full report.'
  );
}

/**
 * Reports catalog sources whose entries the runtime parser silently dropped.
 * Accepts the shapes `createFluentBundle` accepts; JSON catalogs are converted
 * by the caller first, because only FTL text can be reparsed here.
 */
export function warnAboutDroppedEntries(
  locale: string,
  source: string | readonly string[]
): void {
  const sources = typeof source === 'string' ? [source] : source;
  for (const src of sources) {
    if (typeof src !== 'string' || src.trim() === '') continue;
    // The parsed resource is reused by the bundle built right after this call.
    const dropped = droppedEntryIds(src, getOrCreateResource(src));
    if (dropped.length > 0) warnDroppedEntries(locale, src, dropped);
  }
}
