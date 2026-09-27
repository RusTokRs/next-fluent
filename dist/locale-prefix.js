import { matchSupportedLocale, validateLocalePrefix } from "./utils.js";
const LEADING_SLASH_RUN = /^[/\\]{2,}/;
function normalizeLeadingSlashes(path) {
  if (!LEADING_SLASH_RUN.test(path)) return path;
  return `/${path.replace(LEADING_SLASH_RUN, "")}`;
}
function normalizeLocalePrefix(locales, localePrefix) {
  const mode = typeof localePrefix === "object" && localePrefix !== null ? localePrefix.mode ?? "always" : localePrefix ?? "always";
  const raw = typeof localePrefix === "object" && localePrefix !== null ? localePrefix.prefixes : void 0;
  const custom = /* @__PURE__ */ new Map();
  for (const [key, prefix] of Object.entries(raw ?? {})) {
    const locale = matchSupportedLocale(key, locales);
    if (locale && !custom.has(locale)) custom.set(locale, prefix);
  }
  const prefixes = {};
  for (const locale of locales) {
    prefixes[locale] = custom.get(locale) ?? `/${locale}`;
  }
  return { mode, prefixes };
}
function prefixForLocale(locale, config) {
  return config.prefixes[locale] ?? `/${locale}`;
}
function localeNeedsPrefix(locale, defaultLocale, mode) {
  if (mode === "never") return false;
  if (mode === "as-needed") return !matchSupportedLocale(locale, [defaultLocale]);
  return true;
}
const prefixTables = /* @__PURE__ */ new WeakMap();
function sortedPrefixEntries(locales, config) {
  let byConfig = prefixTables.get(locales);
  if (!byConfig) {
    byConfig = /* @__PURE__ */ new WeakMap();
    prefixTables.set(locales, byConfig);
  }
  let entries = byConfig.get(config);
  if (!entries) {
    entries = locales.map((locale) => ({ locale, prefix: prefixForLocale(locale, config) })).sort((a, b) => b.prefix.length - a.prefix.length);
    byConfig.set(config, entries);
  }
  return entries;
}
function matchLocalePrefix(pathname, locales, config) {
  const entries = sortedPrefixEntries(locales, config);
  for (const { locale, prefix } of entries) {
    if (pathname === prefix) return { locale, rest: "/" };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, rest: normalizeLeadingSlashes(pathname.slice(prefix.length)) || "/" };
    }
  }
  return null;
}
export {
  localeNeedsPrefix,
  matchLocalePrefix,
  normalizeLeadingSlashes,
  normalizeLocalePrefix,
  prefixForLocale,
  validateLocalePrefix
};
