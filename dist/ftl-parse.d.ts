import { type Resource } from '@fluent/syntax';
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
