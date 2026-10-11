import { canonicalizeLocale } from "./utils.js";
import { LRUCache } from "./lru.js";
const MAX_CACHE_SIZE = 200;
function stringifySorted(obj, seen) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  const path = seen ?? /* @__PURE__ */ new Set();
  if (path.has(obj)) {
    return '"[circular]"';
  }
  path.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => stringifySorted(item, path)).join(",")}]`;
    }
    const keys = Object.keys(obj).sort();
    return `{${keys.map(
      (k) => `${JSON.stringify(k)}:${stringifySorted(obj[k], path)}`
    ).join(",")}}`;
  } finally {
    path.delete(obj);
  }
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
  warnedFormats.clear();
  warnedDateTimes.clear();
}
const warnedFormats = /* @__PURE__ */ new Set();
const warnedDateTimes = /* @__PURE__ */ new Set();
const MAX_WARNED_FORMATS = 200;
function warnOnce(store, key, message) {
  if (store.has(key)) return;
  if (store.size >= MAX_WARNED_FORMATS) store.clear();
  store.add(key);
  console.warn(message);
}
function resolveFormat(presets, options, kind) {
  if (options === void 0 || typeof options !== "string") return options;
  const preset = presets?.[options];
  if (!preset) {
    warnOnce(
      warnedFormats,
      `${kind}::${options}`,
      `[next-fluent] Unknown ${kind} format "${options}". Configure it in the request config "formats" option.`
    );
    return void 0;
  }
  return preset;
}
function createFormatter(optionsOrLocale) {
  const options = typeof optionsOrLocale === "string" ? { locale: optionsOrLocale } : optionsOrLocale;
  const rawLocale = options.locale || "en";
  const locale = canonicalizeLocale(rawLocale) || rawLocale;
  const timeZone = options.timeZone;
  const formats = options.formats;
  return {
    locale,
    timeZone,
    dateTime(value, dtfOptionsOrName) {
      const dtfOptions = resolveFormat(formats?.dateTime, dtfOptionsOrName, "dateTime");
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
        let candidate;
        try {
          candidate = new Intl.DateTimeFormat(locale, mergedOptions);
        } catch {
          const requestedTimeZone = mergedOptions.timeZone;
          if (!requestedTimeZone) return date.toISOString();
          warnOnce(
            warnedDateTimes,
            `timeZone::${locale}::${requestedTimeZone}`,
            `[next-fluent] Unknown time zone "${requestedTimeZone}" (see \`requestConfig.timeZone\`); using the runtime zone.`
          );
          const { timeZone: _ignored, ...withoutZone } = mergedOptions;
          try {
            candidate = new Intl.DateTimeFormat(locale, withoutZone);
          } catch {
            return date.toISOString();
          }
        }
        formatter = candidate;
        dtfCache.set(cacheKey, formatter);
      }
      try {
        return formatter.format(date);
      } catch {
        return date.toISOString();
      }
    },
    number(value, nfOptionsOrName) {
      const nfOptions = resolveFormat(formats?.number, nfOptionsOrName, "number");
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
    relativeTime(value, unit, rtfOptionsOrName) {
      const rtfOptions = resolveFormat(formats?.relativeTime, rtfOptionsOrName, "relativeTime");
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
    list(value, lfOptionsOrName) {
      if (!value || typeof value[Symbol.iterator] !== "function") {
        return String(value ?? "");
      }
      const items = typeof value === "string" ? [value] : value;
      const lfOptions = resolveFormat(formats?.list, lfOptionsOrName, "list");
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
