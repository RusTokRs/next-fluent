import { parse } from "@fluent/syntax";
import { FluentError, FluentErrorCode } from "./errors.js";
function parseFtl(source, context) {
  try {
    return parse(source, { withSpans: false });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new FluentError({
        code: FluentErrorCode.INVALID_ARGUMENT,
        key: "<catalog>",
        message: `[next-fluent] ${context} is nested too deeply for the FTL parser. Flatten the message or split it into several.`,
        cause: error
      });
    }
    throw error;
  }
}
export {
  parseFtl
};
