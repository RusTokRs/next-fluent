import { parse, type Resource } from '@fluent/syntax';
import { FluentError, FluentErrorCode } from './errors';

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
    return parse(source, { withSpans: false });
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
