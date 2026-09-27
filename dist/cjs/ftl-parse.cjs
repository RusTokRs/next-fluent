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
  parseFtl: () => parseFtl
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseFtl
});
