import { parseFtl } from "./ftl-parse.js";
import { buildKeyCandidates } from "./utils.js";
import { toFluentSource } from "./catalog.js";
const CALL_METHODS = ["raw", "rich", "attrs", "plain", "has"];
const FACTORIES = ["useTranslations", "getTranslations", "createTranslator"];
const IGNORE_MARKER = "next-fluent-ignore";
function readArgumentList(code, openParen) {
  const args = [];
  let buffer = "";
  let depth = 1;
  let quote;
  let comment;
  for (let i = openParen + 1; i < code.length; i++) {
    const ch = code[i];
    if (comment === "line") {
      if (ch === "\n") comment = void 0;
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && code[i + 1] === "/") {
        comment = void 0;
        i++;
      }
      continue;
    }
    if (quote) {
      buffer += ch;
      if (ch === "\\") {
        buffer += code[i + 1] ?? "";
        i++;
        continue;
      }
      if (ch === quote) quote = void 0;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      comment = "line";
      i++;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      comment = "block";
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      buffer += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      buffer += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        args.push(buffer.trim());
        return args;
      }
      buffer += ch;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  return void 0;
}
function scanStringLiteral(text, start) {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return -1;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && text[i + 1] === "{") return -1;
  }
  return -1;
}
function staticString(argument) {
  const text = argument.trim();
  const end = scanStringLiteral(text, 0);
  if (end === -1) return void 0;
  const rest = text.slice(end).trim();
  if (rest !== "" && rest !== "!" && !/^(?:as|satisfies)\s+[\s\S]+$/.test(rest)) return void 0;
  return text.slice(1, end - 1);
}
const NAMESPACE_PROPERTY = /namespace\s*:\s*(['"`])([^'"`]*)\1/;
const NAMESPACE_ARGUMENT = {
  useTranslations: 0,
  getTranslations: 0,
  // `createTranslator(bundle, namespaceOrFallbackOrOpts?, maybeNamespace?)`: the
  // bundle always comes first, and the namespace may be the second argument, a
  // `namespace` property in it, or — when that argument is a fallback bundle —
  // the third one.
  createTranslator: 1
};
const NAMESPACE_KEY = /(?:^|[{,\s])namespace\s*:/;
const OBJECT_SPREAD = /(?:^|[{,\s])\.\.\./;
const OBJECT_LITERAL = /^\{[\s\S]*\}$/;
function factoryNamespace(name, args) {
  let namespace;
  let literal = false;
  let unreadable = false;
  for (const arg of args.slice(NAMESPACE_ARGUMENT[name] ?? 0)) {
    const text = arg.trim();
    if (text === "" || text === "null" || text === "undefined") continue;
    const value = staticString(text);
    if (value !== void 0) {
      literal = true;
      namespace = value || void 0;
      continue;
    }
    const named = NAMESPACE_PROPERTY.exec(text);
    if (named) {
      literal = true;
      namespace = named[2] || void 0;
      continue;
    }
    if (OBJECT_LITERAL.test(text)) {
      if (NAMESPACE_KEY.test(text) || OBJECT_SPREAD.test(text)) unreadable = true;
      continue;
    }
    unreadable = true;
  }
  return literal || !unreadable ? { namespace, known: true } : { namespace: void 0, known: false };
}
function ignoredLines(content) {
  const ignored = /* @__PURE__ */ new Set();
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (!line.includes(IGNORE_MARKER)) return;
    ignored.add(index + 1);
    ignored.add(index + 2);
  });
  return ignored;
}
function skipLiteral(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const inner = source[i];
        if (inner === "{") depth++;
        else if (inner === "}") depth--;
        else if (inner === '"' || inner === "'" || inner === "`") {
          i = skipLiteral(source, i);
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return source.length;
}
function skipRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return start;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i++;
      while (i < source.length && /[a-z]/.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return start;
}
const REGEX_PRECEDING_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "throw"
]);
function regexAllowed(source, index, lastSignificant) {
  if (lastSignificant === "") return true;
  if (lastSignificant === ")") return false;
  if (/[A-Za-z0-9_$\])]/.test(lastSignificant)) {
    let end = index;
    while (end > 0 && /\s/.test(source[end - 1])) end--;
    let wordEnd = end;
    while (wordEnd > 0 && /[A-Za-z_$]/.test(source[wordEnd - 1])) wordEnd--;
    const word = source.slice(wordEnd, end);
    return word !== "" && REGEX_PRECEDING_KEYWORDS.has(word);
  }
  return true;
}
function maskNonCode(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let i2 = from; i2 < to && i2 < out.length; i2++) {
      if (out[i2] !== "\n") out[i2] = " ";
    }
  };
  const stack = [];
  let i = 0;
  let lastSignificant = "";
  while (i < source.length) {
    const ch = source[i];
    const top = stack[stack.length - 1];
    if (top === "template") {
      if (ch === "\\") {
        out[i] = " ";
        if (source[i + 1] !== "\n") out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        out[i] = " ";
        stack.pop();
        lastSignificant = ")";
        i++;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        out[i] = " ";
        out[i + 1] = " ";
        stack.push(1);
        i += 2;
        continue;
      }
      if (ch !== "\n") out[i] = " ";
      i++;
      continue;
    }
    if (typeof top === "number") {
      if (ch === "{") {
        stack[stack.length - 1] = top + 1;
        lastSignificant = ch;
        i++;
        continue;
      }
      if (ch === "}") {
        if (top === 1) {
          stack.pop();
          out[i] = " ";
          i++;
          continue;
        }
        stack[stack.length - 1] = top - 1;
        lastSignificant = ch;
        i++;
        continue;
      }
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      out[i] = " ";
      stack.push("template");
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = skipLiteral(source, i);
      blank(i, end);
      i = end;
      lastSignificant = ")";
      continue;
    }
    if (ch === "/" && regexAllowed(source, i, lastSignificant)) {
      const end = skipRegex(source, i);
      if (end > i) {
        blank(i, end);
        i = end;
        lastSignificant = ")";
        continue;
      }
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return out.join("");
}
function createLineCounter(masked) {
  let scanned = 0;
  let line = 1;
  return (index) => {
    for (let i = scanned; i < index; i++) {
      if (masked[i] === "\n") line++;
    }
    scanned = Math.max(scanned, index);
    return line;
  };
}
const JSX_COMPONENT = /<FormattedMessage(?![A-Za-z0-9_$])/g;
const JSX_ORIGIN = "<FormattedMessage>";
function jsxIdArgument(content, masked, tagStart) {
  let depth = 0;
  let end = masked.length;
  for (let i2 = tagStart; i2 < masked.length; i2++) {
    const ch = masked[i2];
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === ">" && depth === 0) {
      end = i2;
      break;
    }
  }
  const tag = masked.slice(tagStart, end);
  const attribute = /(?:^|\s)id\s*=/.exec(tag);
  if (!attribute) return void 0;
  let i = tagStart + attribute.index + attribute[0].length;
  while (i < content.length && /\s/.test(content[i])) i++;
  const first = content[i];
  if (first === "{") {
    let braces = 0;
    let quote;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = void 0;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") braces++;
      else if (ch === "}") {
        braces--;
        if (braces === 0) return content.slice(i + 1, j).trim();
      }
    }
    return void 0;
  }
  if (first === '"' || first === "'") return content.slice(i, skipLiteral(content, i));
  return /^[^\s/>]+/.exec(content.slice(i))?.[0];
}
function collectCallSites(file) {
  const { content } = file;
  const masked = maskNonCode(content);
  const lineAt = createLineCounter(masked);
  const bindings = /* @__PURE__ */ new Map();
  const sites = [];
  const suppressed = ignoredLines(content);
  const found = [];
  const factoryPattern = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(${FACTORIES.join("|")})\\s*\\(`,
    "g"
  );
  const bindingList = [];
  for (let match = factoryPattern.exec(masked); match; match = factoryPattern.exec(masked)) {
    const openParen = match.index + match[0].length - 1;
    const name = match[1];
    const args = readArgumentList(content, openParen);
    const { namespace, known } = factoryNamespace(match[2], args ?? []);
    bindingList.push({ index: match.index, name, namespace, known });
    bindings.set(name, namespace);
  }
  const namespaceAt = (name, index) => {
    const own = bindingList.filter((entry) => entry.name === name);
    if (own.length === 0) return { namespace: void 0, known: false, ambiguous: false };
    const preceding = own.filter((entry) => entry.index < index);
    if (preceding.length > 0) {
      const binding = preceding[preceding.length - 1];
      return { namespace: binding.namespace, known: binding.known, ambiguous: false };
    }
    const distinct = new Set(
      own.map((entry) => `${entry.known ? "readable" : "unreadable"}:${entry.namespace ?? ""}`)
    );
    if (distinct.size === 1) {
      return { namespace: own[0].namespace, known: own[0].known, ambiguous: false };
    }
    return { namespace: void 0, known: false, ambiguous: true };
  };
  const bareNames = ["t", "translate"];
  const names = /* @__PURE__ */ new Set([...bindings.keys(), ...bareNames]);
  const methodAlternatives = CALL_METHODS.join("|");
  const callPattern = new RegExp(
    `\\b(${[...names].map((name) => name.replace(/\$/g, "\\$")).join("|")})(?:\\s*\\?\\.\\s*|\\s*\\.\\s*)?(${methodAlternatives})?\\s*(?:\\?\\.)?\\s*\\(`,
    "g"
  );
  for (let match = callPattern.exec(masked); match; match = callPattern.exec(masked)) {
    const name = match[1];
    if (FACTORIES.includes(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const args = readArgumentList(content, openParen);
    if (args === void 0) continue;
    const argument = args[0] ?? "";
    const { namespace, known, ambiguous } = namespaceAt(name, match.index);
    if (!known && staticString(argument) === void 0) continue;
    found.push({
      index: match.index,
      site: {
        method: match[2],
        argument,
        namespace,
        namespaceKnown: known,
        ambiguous,
        namespaceNote: !known && !ambiguous && bindings.has(name) ? `"${name}" is created with a namespace argument that is not a string literal, so the key cannot be verified against one namespace.` : void 0
      }
    });
  }
  JSX_COMPONENT.lastIndex = 0;
  for (let match = JSX_COMPONENT.exec(masked); match; match = JSX_COMPONENT.exec(masked)) {
    const argument = jsxIdArgument(content, masked, match.index);
    if (argument === void 0 || argument === "") continue;
    found.push({
      index: match.index,
      site: {
        method: void 0,
        argument,
        namespaceKnown: false,
        ambiguous: false,
        origin: JSX_ORIGIN
      }
    });
  }
  found.sort((a, b) => a.index - b.index);
  for (const { index, site } of found) {
    const line = lineAt(index);
    sites.push({ ...site, line, ignored: suppressed.has(line) });
  }
  return { bindings, sites };
}
function indexCatalog(source) {
  const combined = toFluentSource(source);
  const text = typeof combined === "string" ? combined : combined.join("\n");
  const resource = parseFtl(text, "The catalog");
  const keys = /* @__PURE__ */ new Set();
  const withAttributes = /* @__PURE__ */ new Set();
  const withValue = /* @__PURE__ */ new Set();
  const attributeOnly = /* @__PURE__ */ new Set();
  for (const entry of resource.body) {
    if (entry.type !== "Message") continue;
    if (entry.value) {
      keys.add(entry.id.name);
      withValue.add(entry.id.name);
    } else if (entry.attributes.length > 0) {
      attributeOnly.add(entry.id.name);
    }
    for (const attr of entry.attributes) {
      keys.add(`${entry.id.name}.${attr.id.name}`);
      withAttributes.add(entry.id.name);
    }
  }
  return { keys, withAttributes, withValue, attributeOnly };
}
function findInAnyNamespace(index, key, accept) {
  const consider = (candidate) => {
    if (!accept(candidate)) return void 0;
    if (candidate === key || candidate.endsWith(`.${key}`) || candidate.endsWith(`-${key}`)) {
      return candidate;
    }
    return void 0;
  };
  for (const candidate of index.keys) {
    const hit = consider(candidate);
    if (hit) return hit;
  }
  for (const candidate of index.attributeOnly) {
    const hit = consider(candidate);
    if (hit) return hit;
  }
  return void 0;
}
function isIgnored(key, ignore) {
  return ignore.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}-`));
}
function analyzeUsage(catalogs, sources, options = {}) {
  const locales = Object.keys(catalogs);
  const referenceLocale = options.referenceLocale ?? locales[0] ?? "";
  if (referenceLocale && !Object.prototype.hasOwnProperty.call(catalogs, referenceLocale)) {
    throw new Error(
      `[next-fluent] Reference locale "${referenceLocale}" is not part of the analyzed catalogs (${locales.join(", ")}).`
    );
  }
  const index = referenceLocale ? indexCatalog(catalogs[referenceLocale]) : {
    keys: /* @__PURE__ */ new Set(),
    withAttributes: /* @__PURE__ */ new Set(),
    withValue: /* @__PURE__ */ new Set(),
    attributeOnly: /* @__PURE__ */ new Set()
  };
  const ignore = options.ignore ?? [];
  const usedKeys = /* @__PURE__ */ new Set();
  const issues = [];
  let dynamicSites = 0;
  for (const file of sources) {
    const { sites } = collectCallSites(file);
    for (const site of sites) {
      const key = staticString(site.argument);
      if (key === void 0) {
        if (site.argument.trim() !== "" && !site.ignored) {
          dynamicSites++;
          issues.push({
            kind: "dynamic",
            file: file.path,
            line: site.line,
            message: `Key is not a string literal and cannot be checked statically${site.origin ? ` (${site.origin})` : ""}.`
          });
        }
        continue;
      }
      if (site.ambiguous && !site.ignored) {
        dynamicSites++;
        issues.push({
          kind: "dynamic",
          key,
          file: file.path,
          line: site.line,
          message: `Several namespaces bind this translator in the file and the call precedes all of them, so the namespace cannot be determined statically.`
        });
        continue;
      }
      const readsAttributes = site.method === "attrs" || site.method === "raw" || site.method === "has";
      const accept = (candidate) => index.keys.has(candidate) || readsAttributes && index.attributeOnly.has(candidate);
      const resolved = site.namespaceKnown ? buildKeyCandidates(site.namespace, key).find(accept) : findInAnyNamespace(index, key, accept);
      if (resolved) {
        usedKeys.add(resolved);
        if (site.method === "attrs" || site.method === "raw" && !index.withValue.has(resolved)) {
          for (const candidate of index.keys) {
            if (candidate.startsWith(`${resolved}.`)) usedKeys.add(candidate);
          }
        }
        if (site.method === "attrs" && !index.withAttributes.has(resolved)) {
          issues.push({
            kind: "missing-attributes",
            key: resolved,
            file: file.path,
            line: site.line,
            message: `t.attrs("${key}") was called, but "${resolved}" defines no attributes.`
          });
        }
        continue;
      }
      if (site.ignored) continue;
      const attributeOnlyHit = site.namespaceKnown ? buildKeyCandidates(site.namespace, key).find((candidate) => index.attributeOnly.has(candidate)) : findInAnyNamespace(index, key, (candidate) => index.attributeOnly.has(candidate));
      if (attributeOnlyHit !== void 0) {
        issues.push({
          kind: "missing-attributes",
          key: attributeOnlyHit,
          file: file.path,
          line: site.line,
          message: `${site.method ? `t.${site.method}` : "t"}("${key}") resolves to "${attributeOnlyHit}", which defines only attributes and no value, so it cannot be rendered as text.`
        });
        continue;
      }
      if (!site.namespaceKnown) {
        dynamicSites++;
        issues.push({
          kind: "dynamic",
          file: file.path,
          line: site.line,
          message: site.namespaceNote ? `"${key}" is used where the namespace cannot be read: ${site.namespaceNote}` : site.origin ? `"${key}" is rendered by ${site.origin} and matches no catalog key (every namespace was searched), so it cannot be verified.` : `"${key}" is used through a translator this file does not create, so its namespace cannot be verified.`
        });
        continue;
      }
      issues.push({
        kind: "missing",
        key: buildKeyCandidates(site.namespace, key)[0],
        file: file.path,
        line: site.line,
        message: `"${key}" is used in ${file.path} but is missing from ${referenceLocale || "the catalog"}.`
      });
    }
  }
  if (options.reportUnused !== false) {
    for (const key of [...index.keys].sort()) {
      if (usedKeys.has(key) || isIgnored(key, ignore)) continue;
      issues.push({
        kind: "unused",
        key,
        message: `"${key}" is defined in ${referenceLocale || "the catalog"} but never referenced in the scanned sources.`
      });
    }
  }
  return {
    referenceLocale,
    catalogKeys: [...index.keys].sort(),
    usedKeys: [...usedKeys].sort(),
    dynamicSites,
    issues
  };
}
function formatUsageReport(report) {
  const lines = [];
  lines.push(
    `Usage against ${report.referenceLocale || "the catalog"}: ${report.usedKeys.length}/${report.catalogKeys.length} keys used, ${report.dynamicSites} dynamic call site(s).`
  );
  const groups = ["missing", "missing-attributes", "dynamic", "unused"];
  for (const kind of groups) {
    const subset = report.issues.filter((issue) => issue.kind === kind);
    if (subset.length === 0) continue;
    lines.push("");
    lines.push(`${kind} (${subset.length})`);
    for (const issue of subset) {
      const where = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ""})` : "";
      lines.push(`  ${issue.message}${where}`);
    }
  }
  return lines.join("\n");
}
export {
  IGNORE_MARKER,
  analyzeUsage,
  collectCallSites,
  formatUsageReport
};
