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
function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === "\n") line++;
  }
  return line;
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
function collectCallSites(file) {
  const { content } = file;
  const bindings = /* @__PURE__ */ new Map();
  const sites = [];
  const suppressed = ignoredLines(content);
  const factoryPattern = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(${FACTORIES.join("|")})\\s*\\(`,
    "g"
  );
  for (let match = factoryPattern.exec(content); match; match = factoryPattern.exec(content)) {
    const openParen = match.index + match[0].length - 1;
    bindings.set(match[1], namespaceOf(readFirstArgument(content, openParen)));
  }
  const inlinePattern = new RegExp(`(${FACTORIES.join("|")})\\s*\\(`, "g");
  const inlineNamespaces = [];
  for (let match = inlinePattern.exec(content); match; match = inlinePattern.exec(content)) {
    const openParen = match.index + match[0].length - 1;
    inlineNamespaces.push({
      index: match.index,
      namespace: namespaceOf(readFirstArgument(content, openParen))
    });
  }
  const names = /* @__PURE__ */ new Set([...bindings.keys(), "t", "translate"]);
  const methodAlternatives = CALL_METHODS.join("|");
  const callPattern = new RegExp(
    `\\b(${[...names].map((name) => name.replace(/\$/g, "\\$")).join("|")})\\s*(?:\\.\\s*(${methodAlternatives}))?\\s*\\(`,
    "g"
  );
  for (let match = callPattern.exec(content); match; match = callPattern.exec(content)) {
    const name = match[1];
    if (FACTORIES.includes(name)) continue;
    const openParen = match.index + match[0].length - 1;
    const argument = readFirstArgument(content, openParen);
    if (argument === void 0) continue;
    const namespace = bindings.has(name) ? bindings.get(name) : inlineNamespaces.find((entry) => entry.index < match.index)?.namespace;
    const line = lineOf(content, match.index);
    sites.push({
      method: match[2],
      argument,
      line,
      namespace,
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
      const candidates = buildKeyCandidates(site.namespace, key);
      const resolved = candidates.find((candidate) => index.keys.has(candidate));
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
      issues.push({
        kind: "missing",
        key: candidates[0],
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
