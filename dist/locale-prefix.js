import { matchSupportedLocale, validateLocalePrefix } from "./utils.js";
const LEADING_SLASH_RUN = /^[/\\]{2,}/;
function normalizeLeadingSlashes(path) {
  if (!LEADING_SLASH_RUN.test(path)) return path;
  return `/${path.replace(LEADING_SLASH_RUN, "")}`;
}
function canonicalKey(locales, locale) {
  return matchSupportedLocale(locale, locales);
}
function normalizeLocalePrefix(locales, localePrefix) {
  const mode = typeof localePrefix === "object" && localePrefix !== null ? localePrefix.mode ?? "always" : localePrefix ?? "always";
  const raw = typeof localePrefix === "object" && localePrefix !== null ? localePrefix.prefixes : void 0;
  const prefixes = {};
  for (const locale of locales) {
    const custom = raw ? Object.entries(raw).find(([key]) => canonicalKey(locales, key) === locale) : void 0;
    prefixes[locale] = custom?.[1] ?? `/${locale}`;
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
function matchLocalePrefix(pathname, locales, config) {
  const entries = locales.map((locale) => ({ locale, prefix: prefixForLocale(locale, config) })).sort((a, b) => b.prefix.length - a.prefix.length);
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
