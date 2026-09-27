import { parseFtl } from "./ftl-parse.js";
import { toFluentSource } from "./catalog.js";
function collectKeys(source) {
  const combined = typeof source === "string" ? source : source.join("\n");
  const resource = parseFtl(combined, "The catalog");
  const keys = /* @__PURE__ */ new Set();
  const duplicates = [];
  const parseErrors = [];
  const add = (key) => {
    if (keys.has(key)) duplicates.push(key);
    keys.add(key);
  };
  for (const entry of resource.body) {
    if (entry.type === "Junk") {
      parseErrors.push(entry.content.split("\n")[0].slice(0, 120));
      continue;
    }
    if (entry.type !== "Message") continue;
    if (entry.value) add(entry.id.name);
    for (const attr of entry.attributes) add(`${entry.id.name}.${attr.id.name}`);
  }
  return { keys, duplicates, parseErrors };
}
function checkCatalogs(catalogs, options = {}) {
  const locales = Object.keys(catalogs);
  if (locales.length === 0) {
    return { referenceLocale: "", locales: [], issues: [], keyCount: 0 };
  }
  const referenceLocale = options.referenceLocale ?? locales[0];
  if (!Object.prototype.hasOwnProperty.call(catalogs, referenceLocale)) {
    throw new Error(
      `[next-fluent] Reference locale "${referenceLocale}" is not part of the checked catalogs (${locales.join(", ")}).`
    );
  }
  const parsed = /* @__PURE__ */ new Map();
  for (const locale of locales) {
    const source = toFluentSource(catalogs[locale]);
    parsed.set(
      locale,
      collectKeys(Array.isArray(source) ? source : source)
    );
  }
  const reference = parsed.get(referenceLocale);
  const issues = [];
  for (const locale of locales) {
    const current = parsed.get(locale);
    for (const error of current.parseErrors) {
      issues.push({
        kind: "parse-error",
        locale,
        message: `Unparsable FTL: ${error}`
      });
    }
    for (const key of current.duplicates) {
      issues.push({
        kind: "duplicate",
        locale,
        key,
        message: `"${key}" is defined more than once; Fluent keeps the first definition.`
      });
    }
    if (locale === referenceLocale) continue;
    for (const key of [...reference.keys].sort()) {
      if (!current.keys.has(key)) {
        issues.push({ kind: "missing", locale, key, message: `"${key}" is missing.` });
      }
    }
    if (options.reportExtra !== false) {
      for (const key of [...current.keys].sort()) {
        if (!reference.keys.has(key)) {
          issues.push({ kind: "extra", locale, key, message: `"${key}" does not exist in ${referenceLocale}.` });
        }
      }
    }
  }
  return { referenceLocale, locales, issues, keyCount: reference.keys.size };
}
function formatCheckReport(report) {
  if (report.locales.length === 0) return "[next-fluent] No catalogs to check.";
  const lines = [
    `[next-fluent] Checked ${report.locales.length} catalog(s) against "${report.referenceLocale}" (${report.keyCount} keys).`
  ];
  if (report.issues.length === 0) {
    lines.push("[next-fluent] No issues found.");
    return lines.join("\n");
  }
  const byLocale = /* @__PURE__ */ new Map();
  for (const issue of report.issues) {
    const list = byLocale.get(issue.locale) ?? [];
    list.push(issue);
    byLocale.set(issue.locale, list);
  }
  for (const [locale, issues] of byLocale) {
    lines.push(`  ${locale}:`);
    for (const issue of issues) {
      lines.push(`    [${issue.kind}] ${issue.message}`);
    }
  }
  lines.push(`[next-fluent] ${report.issues.length} issue(s) found.`);
  return lines.join("\n");
}
export {
  checkCatalogs,
  formatCheckReport
};
