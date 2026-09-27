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
var catalog_exports = {};
__export(catalog_exports, {
  isJsonCatalog: () => isJsonCatalog,
  jsonToFluent: () => jsonToFluent,
  renderFluentPattern: () => renderFluentPattern,
  toFluentSource: () => toFluentSource
});
module.exports = __toCommonJS(catalog_exports);
var import_errors = require("./errors.cjs");
const VALID_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const VARIABLE = /\{\$?([a-zA-Z][a-zA-Z0-9_]*)\}/g;
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function isJsonCatalog(value) {
  return isPlainObject(value);
}
function invalid(message, key = "<catalog>") {
  return new import_errors.FluentError({
    code: import_errors.FluentErrorCode.INVALID_ARGUMENT,
    key,
    message: `[next-fluent] ${message}`
  });
}
function escapeLiteral(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function needsQuoting(text) {
  return text === "" || text !== text.trim() || /[{}"\\]/.test(text) || /^[.#*[]/.test(text);
}
function renderInline(text) {
  if (!needsQuoting(text)) return text;
  let out = "";
  let last = 0;
  let match;
  VARIABLE.lastIndex = 0;
  while ((match = VARIABLE.exec(text)) !== null) {
    const literal = text.slice(last, match.index);
    if (literal !== "") out += `{ "${escapeLiteral(literal)}" }`;
    out += `{ $${match[1]} }`;
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail !== "") {
    out += /[{}"\\]/.test(tail) ? tail.replace(
      /[{}"\\]/g,
      (ch) => ch === "{" || ch === "}" ? `{ "${ch}" }` : `{ "${escapeLiteral(ch)}" }`
    ) : `{ "${escapeLiteral(tail)}" }`;
  }
  return out === "" ? '{ "" }' : out;
}
function renderFluentPattern(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return '{ "" }';
  if (normalized.includes("\n")) {
    return `
${normalized.split("\n").map((line) => `    ${renderInline(line)}`).join("\n")}`;
  }
  return renderInline(normalized);
}
function normalizeId(segment, path) {
  const id = segment.replaceAll(".", "-");
  if (!VALID_ID.test(id)) {
    throw invalid(
      `JSON catalog key "${path}" is not a valid Fluent message id. Ids must start with a letter and contain only letters, digits, "-" and "_".`,
      path
    );
  }
  return id;
}
const MAX_JSON_DEPTH = 32;
function walk(value, id, path, out, depth = 0) {
  if (depth > MAX_JSON_DEPTH) {
    throw invalid(
      `JSON catalog value at "${path}" is nested more than ${MAX_JSON_DEPTH} levels deep.`,
      path
    );
  }
  if (value === null || value === void 0) {
    throw invalid(
      `JSON catalog value at "${path}" is ${value === null ? "null" : "undefined"}. Every message must be a string, a number, a boolean or a nested object.`,
      path
    );
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(`${id} = ${renderFluentPattern(String(value))}`);
    return;
  }
  if (Array.isArray(value)) {
    throw invalid(
      `JSON catalog value at "${path}" is an array. Fluent expresses alternatives with selectors, e.g. \`items = { $count -> [one] one item *[other] { $count } items }\`.`,
      path
    );
  }
  if (!isPlainObject(value)) {
    throw invalid(
      `JSON catalog value at "${path}" has an unsupported type: ${typeof value}.`,
      path
    );
  }
  const entries = Object.entries(value);
  const hasValue = entries.some(([key]) => key === "");
  if (hasValue) {
    const own = entries.find(([key]) => key === "")?.[1];
    if (typeof own === "object" && own !== null) {
      throw invalid(
        `JSON catalog value at "${path}" cannot mix a "" value with nested objects.`,
        path
      );
    }
    out.push(`${id} = ${renderFluentPattern(String(own ?? ""))}`);
    for (const [key, attr] of entries) {
      if (key === "") continue;
      if (typeof attr === "object" && attr !== null) {
        throw invalid(`JSON catalog attribute "${path}.${key}" must be a string.`, `${path}.${key}`);
      }
      out.push(`    .${normalizeId(key, `${path}.${key}`)} = ${renderFluentPattern(String(attr))}`);
    }
    return;
  }
  for (const [key, nested] of entries) {
    walk(nested, `${id}-${normalizeId(key, `${path}.${key}`)}`, `${path}.${key}`, out, depth + 1);
  }
}
function jsonToFluent(catalog) {
  if (!isPlainObject(catalog)) {
    throw invalid("JSON catalogs must be plain objects.");
  }
  const out = [];
  for (const [key, value] of Object.entries(catalog)) {
    walk(value, normalizeId(key, key), key, out);
  }
  return out.length > 0 ? `${out.join("\n")}
` : "";
}
function toFluentSource(messages) {
  if (typeof messages === "string") return messages;
  if (Array.isArray(messages)) return messages;
  if (isPlainObject(messages)) return jsonToFluent(messages);
  throw invalid(
    `Catalogs must be FTL text, an array of FTL sources or a JSON object (received ${typeof messages}).`
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isJsonCatalog,
  jsonToFluent,
  renderFluentPattern,
  toFluentSource
});
