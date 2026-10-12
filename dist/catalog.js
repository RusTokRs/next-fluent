import { FluentError, FluentErrorCode } from "./errors.js";
const VALID_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const VARIABLE = /\\[{}]|\{\$?([a-zA-Z][a-zA-Z0-9_]*)\}/g;
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function isJsonCatalog(value) {
  return isPlainObject(value);
}
function invalid(message, key = "<catalog>") {
  return new FluentError({
    code: FluentErrorCode.INVALID_ARGUMENT,
    key,
    message: `[next-fluent] ${message}`
  });
}
function stripCatalogBom(source) {
  return source.charCodeAt(0) === 65279 ? source.slice(1) : source;
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
    out += match[1] === void 0 ? `{ "${match[0][1]}" }` : `{ $${match[1]} }`;
    last = match.index + match[0].length;
  }
  const tail = text.slice(last);
  if (tail !== "") out += `{ "${escapeLiteral(tail)}" }`;
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
function declareId(seen, id, path) {
  const existing = seen.get(id);
  if (existing !== void 0 && existing !== path) {
    throw invalid(
      `JSON catalog keys "${existing}" and "${path}" both map to the Fluent message id "${id}". Rename one of them: a catalog cannot define the same message twice.`,
      path
    );
  }
  seen.set(id, path);
}
function walk(value, id, path, out, depth = 0, seen = /* @__PURE__ */ new Map()) {
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
    declareId(seen, id, path);
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
  if (entries.length === 0) {
    throw invalid(
      `JSON catalog value at "${path}" is an empty object. Every message needs a value (\`""\`), at least one attribute, or nested messages.`,
      path
    );
  }
  const hasValue = entries.some(([key]) => key === "");
  if (hasValue) {
    const own = entries.find(([key]) => key === "")?.[1];
    if (typeof own === "object" && own !== null) {
      throw invalid(
        `JSON catalog value at "${path}" cannot mix a "" value with nested objects.`,
        path
      );
    }
    declareId(seen, id, path);
    out.push(`${id} = ${renderFluentPattern(String(own ?? ""))}`);
    const declaredAttributes = /* @__PURE__ */ new Map();
    for (const [key, attr] of entries) {
      if (key === "") continue;
      if (typeof attr === "object" && attr !== null) {
        throw invalid(`JSON catalog attribute "${path}.${key}" must be a string.`, `${path}.${key}`);
      }
      const attributeName = key.startsWith(".") ? key.slice(1) : key;
      const attributePath = `${path}.${key}`;
      const attributeId = normalizeId(attributeName, attributePath);
      const existing = declaredAttributes.get(attributeId);
      if (existing !== void 0) {
        throw invalid(
          `JSON catalog keys "${existing}" and "${attributePath}" both map to the attribute ".${attributeId}" of the message "${id}". Rename one of them: a message cannot define the same attribute twice.`,
          attributePath
        );
      }
      declaredAttributes.set(attributeId, attributePath);
      out.push(`    .${attributeId} = ${renderFluentPattern(String(attr))}`);
    }
    return;
  }
  for (const [key, nested] of entries) {
    walk(
      nested,
      `${id}-${normalizeId(key, `${path}.${key}`)}`,
      `${path}.${key}`,
      out,
      depth + 1,
      seen
    );
  }
}
function jsonToFluent(catalog) {
  if (!isPlainObject(catalog)) {
    throw invalid("JSON catalogs must be plain objects.");
  }
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(catalog)) {
    walk(value, normalizeId(key, key), key, out, 0, seen);
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
export {
  isJsonCatalog,
  jsonToFluent,
  renderFluentPattern,
  stripCatalogBom,
  toFluentSource
};
