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
function junkEntries(resource) {
  const entries = [];
  for (const entry of resource.body) {
    if (entry.type !== "Junk") continue;
    const firstLine = entry.content.split("\n")[0] ?? "";
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*=/.exec(firstLine);
    entries.push({ id: match?.[1], snippet: firstLine.trim().slice(0, 120) });
  }
  return entries;
}
function unparsableCatalogError(entries, context) {
  const details = entries.map((entry) => `"${entry.snippet}"`).join("; ");
  return new FluentError({
    code: FluentErrorCode.INVALID_ARGUMENT,
    key: entries.length === 1 ? entries[0].id ?? "<catalog>" : "<catalog>",
    message: `[next-fluent] ${context} contains ${entries.length} entr${entries.length === 1 ? "y" : "ies"} the Fluent parser cannot read: ${details}`
  });
}
export {
  junkEntries,
  parseFtl,
  unparsableCatalogError
};
