import { getOrCreateResource } from "./cache.js";
const ENTRY_DECLARATION = /^(-?[a-zA-Z][\w-]*) *=/gm;
function droppedEntryIds(source, resource) {
  const parsed = /* @__PURE__ */ new Map();
  for (const entry of resource.body) {
    if (typeof entry.id === "string") {
      parsed.set(entry.id, (parsed.get(entry.id) ?? 0) + 1);
    }
  }
  const dropped = [];
  ENTRY_DECLARATION.lastIndex = 0;
  let match;
  while ((match = ENTRY_DECLARATION.exec(source)) !== null) {
    const remaining = parsed.get(match[1]) ?? 0;
    if (remaining > 0) {
      parsed.set(match[1], remaining - 1);
    } else if (!dropped.includes(match[1])) {
      dropped.push(match[1]);
    }
  }
  return dropped;
}
const warnedCatalogs = /* @__PURE__ */ new Set();
const MAX_WARNED_CATALOGS = 200;
function warnDroppedEntries(locale, source, ids) {
  const shown = ids.slice(0, 5).map((id) => `"${id}"`).join(", ");
  const more = ids.length > 5 ? ` and ${ids.length - 5} more` : "";
  const key = `${locale}::${source.length}::${source.slice(0, 64)}`;
  if (warnedCatalogs.has(key)) return;
  if (warnedCatalogs.size >= MAX_WARNED_CATALOGS) warnedCatalogs.clear();
  warnedCatalogs.add(key);
  console.warn(
    `[next-fluent] The ${locale} catalog contains ${ids.length} entr${ids.length === 1 ? "y" : "ies"} the Fluent parser cannot read, so ${ids.length === 1 ? "it is" : "they are"} missing at runtime: ${shown}${more}. Run \`next-fluent check\` for the full report.`
  );
}
function warnAboutDroppedEntries(locale, source) {
  const sources = typeof source === "string" ? [source] : source;
  for (const src of sources) {
    if (typeof src !== "string" || src.trim() === "") continue;
    const dropped = droppedEntryIds(src, getOrCreateResource(src));
    if (dropped.length > 0) warnDroppedEntries(locale, src, dropped);
  }
}
export {
  warnAboutDroppedEntries
};
