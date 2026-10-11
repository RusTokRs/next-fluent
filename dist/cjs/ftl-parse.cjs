"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ftl_parse_exports = {};
__export(ftl_parse_exports, {
  junkEntries: () => junkEntries,
  parseFtl: () => parseFtl,
  unparsableCatalogError: () => unparsableCatalogError
});
module.exports = __toCommonJS(ftl_parse_exports);
var import_syntax = require("@fluent/syntax");
var import_errors = require("./errors.cjs");
function parseFtl(source, context) {
  try {
    return (0, import_syntax.parse)(source, { withSpans: false });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new import_errors.FluentError({
        code: import_errors.FluentErrorCode.INVALID_ARGUMENT,
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
  return new import_errors.FluentError({
    code: import_errors.FluentErrorCode.INVALID_ARGUMENT,
    key: entries.length === 1 ? entries[0].id ?? "<catalog>" : "<catalog>",
    message: `[next-fluent] ${context} contains ${entries.length} entr${entries.length === 1 ? "y" : "ies"} the Fluent parser cannot read: ${details}`
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  junkEntries,
  parseFtl,
  unparsableCatalogError
});
