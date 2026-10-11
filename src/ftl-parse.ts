import { parse, type Resource } from '@fluent/syntax';
import { FluentError, FluentErrorCode } from './errors';
import { stripCatalogBom } from './catalog';

/**
 * Parses FTL, turning the parser's stack overflow into an actionable error.
 *
 * `@fluent/syntax` recurses once per nesting level, so a message with a few
 * thousand nested placeables exhausts the stack. Without this the CLI reports a
 * bare "Maximum call stack size exceeded" with no hint about the cause or the
 * catalog it came from.
 *
 * Node-only: it pulls in the full FTL parser and must never reach a browser
 * entry point.
 */
export function parseFtl(source: string, context: string): Resource {
  try {
    return parse(stripCatalogBom(source), { withSpans: false });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new FluentError({
        code: FluentErrorCode.INVALID_ARGUMENT,
        key: '<catalog>',
        message:
          `[next-fluent] ${context} is nested too deeply for the FTL parser. ` +
          'Flatten the message or split it into several.',
        cause: error,
      });
    }
    throw error;
  }
}

/** A `Junk` entry: text the parser could not read as a message or term. */
export interface JunkEntry {
  /**
   * The message id the junk text starts with (`foo = broken {`), when it looks
   * like a declaration at all. Used to attribute the entry to a namespace.
   */
  id?: string;
  /** First line of the unreadable text, trimmed, for the error message. */
  snippet: string;
}

/**
 * Collects the parser's `Junk` entries.
 *
 * `parse()` does not throw on unreadable input — it drops the text into a
 * `Junk` node and returns a resource missing that message. Tools that turn a
 * catalog into something else (type declarations, pruned payloads, pseudo
 * locales) would then silently emit an incomplete artifact, so they need a way
 * to notice.
 */
export function junkEntries(resource: Resource): JunkEntry[] {
  const entries: JunkEntry[] = [];
  for (const entry of resource.body) {
    if (entry.type !== 'Junk') continue;
    const firstLine = entry.content.split('\n')[0] ?? '';
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=/.exec(firstLine);
    entries.push({ id: match?.[1], snippet: firstLine.trim().slice(0, 120) });
  }
  return entries;
}

/** Error describing unreadable catalog entries, with their first lines. */
export function unparsableCatalogError(entries: readonly JunkEntry[], context: string): FluentError {
  const details = entries.map((entry) => `"${entry.snippet}"`).join('; ');
  return new FluentError({
    code: FluentErrorCode.INVALID_ARGUMENT,
    key: entries.length === 1 ? entries[0].id ?? '<catalog>' : '<catalog>',
    message:
      `[next-fluent] ${context} contains ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} ` +
      `the Fluent parser cannot read: ${details}`,
  });
}
