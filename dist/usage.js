import { parse } from "@fluent/syntax";
import { buildKeyCandidates } from "./utils.js";
import { toFluentSource } from "./catalog.js";
const CALL_METHODS = ["rich", "attrs", "plain", "markup", "has", "exists"];
const FACTORIES = ["useTranslations", "getTranslations", "createTranslator"];
const IGNORE_MARKER = "next-fluent-ignore";
function readFirstArgument(code, openParen) {
  let depth = 0;
  let quote;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = void 0;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return code.slice(openParen + 1, i).trim();
    } else if (depth === 1 && ch === ",") {
      return code.slice(openParen + 1, i).trim();
    }
  }
  return void 0;
}
function staticString(argument) {
  const match = /^(['"`])([\s\S]*)\1$/.exec(argument);
  if (!match) return void 0;
  if (match[1] === "`" && match[2].includes("${")) return void 0;
  return match[2];
}
function namespaceOf(argument) {
  if (!argument) return void 0;
  const literal = staticString(argument);
  if (literal !== void 0) return literal || void 0;
  const named = /namespace\s*:\s*(['"`])([^'"`]*)\1/.exec(argument);
  return named?.[2] || void 0;
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
        out[i + 1] = " ";
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
function collectCallSites(file) {
  const { content } = file;
  const masked = maskNonCode(content);
  const lineAt = createLineCounter(masked);
  const bindings = /* @__PURE__ */ new Map();
  const sites = [];
  const suppressed = ignoredLines(content);
  const factoryPattern = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(${FACTORIES.join("|")})\\s*\\(`,
    "g"
  );
  for (let match = factoryPattern.exec(masked); match; match = factoryPattern.exec(masked)) {
    const openParen = match.index + match[0].length - 1;
    bindings.set(match[1], namespaceOf(readFirstArgument(content, openParen)));
  }
  const bareNames = ["t", "translate"];
  const names = /* @__PURE__ */ new Set([...bindings.keys(), ...bareNames]);
  const methodAlternatives = CALL_METHODS.join("|");
  const callPattern = new RegExp(
    `\\b(${[...names].map((name) => name.replace(/\$/g, "\\$")).join("|")})\\s*(?:\\.\\s*(${methodAlternatives}))?\\s*\\(`,
    "g"
  );
  for (let match = callPattern.exec(masked); match; match = callPattern.exec(masked)) {
    const name = match[1];
    if (FACTORIES.includes(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const argument = readFirstArgument(content, openParen);
    if (argument === void 0) continue;
    const namespaceKnown = bindings.has(name);
    if (!namespaceKnown && staticString(argument) === void 0) continue;
    const line = lineAt(match.index);
    sites.push({
      method: match[2],
      argument,
      line,
      namespace: namespaceKnown ? bindings.get(name) : void 0,
      namespaceKnown,
      ignored: suppressed.has(line)
    });
  }
  return { bindings, sites };
}
function indexCatalog(source) {
  const combined = toFluentSource(source);
  const text = typeof combined === "string" ? combined : combined.join("\n");
  const resource = parse(text, { withSpans: false });
  const keys = /* @__PURE__ */ new Set();
  const withAttributes = /* @__PURE__ */ new Set();
  for (const entry of resource.body) {
    if (entry.type !== "Message") continue;
    if (entry.value) keys.add(entry.id.name);
    for (const attr of entry.attributes) {
      keys.add(`${entry.id.name}.${attr.id.name}`);
      withAttributes.add(entry.id.name);
    }
  }
  return { keys, withAttributes };
}
function findInAnyNamespace(keys, key) {
  if (keys.has(key)) return key;
  for (const candidate of keys) {
    if (candidate.endsWith(`.${key}`) || candidate.endsWith(`-${key}`)) return candidate;
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
  const index = referenceLocale ? indexCatalog(catalogs[referenceLocale]) : { keys: /* @__PURE__ */ new Set(), withAttributes: /* @__PURE__ */ new Set() };
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
            message: `Key is not a string literal and cannot be checked statically.`
          });
        }
        continue;
      }
      const resolved = site.namespaceKnown ? buildKeyCandidates(site.namespace, key).find((candidate) => index.keys.has(candidate)) : findInAnyNamespace(index.keys, key);
      if (resolved) {
        usedKeys.add(resolved);
        if (site.method === "attrs") {
          for (const candidate of index.keys) {
            if (candidate.startsWith(`${resolved}.`)) usedKeys.add(candidate);
          }
        }
        if ((site.method === "attrs" || site.method === "plain") && !index.withAttributes.has(resolved)) {
          issues.push({
            kind: "missing-attributes",
            key: resolved,
            file: file.path,
            line: site.line,
            message: `t.${site.method}("${key}") was called, but "${resolved}" defines no attributes.`
          });
        }
        continue;
      }
      if (site.ignored) continue;
      if (!site.namespaceKnown) {
        dynamicSites++;
        issues.push({
          kind: "dynamic",
          file: file.path,
          line: site.line,
          message: `"${key}" is used through a translator this file does not create, so its namespace cannot be verified.`
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
