import { type Resource } from '@fluent/syntax';
import { FluentError } from './errors';
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
export declare function parseFtl(source: string, context: string): Resource;
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
export declare function junkEntries(resource: Resource): JunkEntry[];
/** Error describing unreadable catalog entries, with their first lines. */
export declare function unparsableCatalogError(entries: readonly JunkEntry[], context: string): FluentError;
