import { canonicalizeLocale } from "./utils.js";
import { LRUCache } from "./lru.js";
const MAX_CACHE_SIZE = 200;
function stringifySorted(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stringifySorted).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map(
    (k) => `${JSON.stringify(k)}:${stringifySorted(obj[k])}`
  ).join(",")}}`;
}
const dtfCache = new LRUCache(MAX_CACHE_SIZE);
const nfCache = new LRUCache(MAX_CACHE_SIZE);
const rtfCache = new LRUCache(MAX_CACHE_SIZE);
const lfCache = new LRUCache(MAX_CACHE_SIZE);
function clearFormatterCache() {
  dtfCache.clear();
  nfCache.clear();
  rtfCache.clear();
  lfCache.clear();
}
function createFormatter(optionsOrLocale) {
  const options = typeof optionsOrLocale === "string" ? { locale: optionsOrLocale } : optionsOrLocale;
  const rawLocale = options.locale || "en";
  const locale = canonicalizeLocale(rawLocale) || rawLocale;
  const timeZone = options.timeZone;
  return {
    locale,
    timeZone,
    dateTime(value, dtfOptions) {
      const date = value instanceof Date ? value : new Date(typeof value === "number" || typeof value === "string" ? value : NaN);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      const mergedOptions = {
        ...timeZone && !dtfOptions?.timeZone ? { timeZone } : {},
        ...dtfOptions
      };
      const cacheKey = `${locale}::${stringifySorted(mergedOptions)}`;
      let formatter = dtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.DateTimeFormat(locale, mergedOptions);
          dtfCache.set(cacheKey, formatter);
        } catch {
          return date.toISOString();
        }
      }
      try {
        return formatter.format(date);
      } catch {
        return date.toISOString();
      }
    },
    number(value, nfOptions) {
      const cacheKey = `${locale}::${stringifySorted(nfOptions ?? {})}`;
      let formatter = nfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.NumberFormat(locale, nfOptions);
          nfCache.set(cacheKey, formatter);
        } catch {
          return String(value);
        }
      }
      try {
        return formatter.format(value);
      } catch {
        return String(value);
      }
    },
    relativeTime(value, unit, rtfOptions) {
      const cacheKey = `${locale}::${stringifySorted(rtfOptions ?? {})}`;
      let formatter = rtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.RelativeTimeFormat(locale, rtfOptions);
          rtfCache.set(cacheKey, formatter);
        } catch {
          return `${value} ${unit}`;
        }
      }
      try {
        return formatter.format(value, unit);
      } catch {
        return `${value} ${unit}`;
      }
    },
    list(value, lfOptions) {
      if (!value || typeof value[Symbol.iterator] !== "function") {
        return String(value ?? "");
      }
      const items = typeof value === "string" ? [value] : value;
      const cacheKey = `${locale}::${stringifySorted(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(items).join(", ");
        }
      }
      try {
        return formatter.format(items);
      } catch {
        return Array.from(items).join(", ");
      }
    }
  };
}
export {
  clearFormatterCache,
  createFormatter
};
