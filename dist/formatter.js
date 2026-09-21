// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
function canonicalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return void 0;
  if (locale.length > MAX_LOCALE_TAG_LENGTH) return void 0;
  const raw = locale.trim();
  if (!raw) return void 0;
  const normalized = raw.replaceAll("_", "-");
  try {
    const canonical = Intl.getCanonicalLocales(normalized);
    return canonical[0];
  } catch {
    return void 0;
  }
}

// src/formatter.ts
var MAX_CACHE_SIZE = 200;
function createBoundedCache() {
  const map = /* @__PURE__ */ new Map();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (!map.has(key) && map.size >= MAX_CACHE_SIZE) {
        const firstKey = map.keys().next().value;
        if (firstKey !== void 0) {
          map.delete(firstKey);
        }
      }
      map.set(key, value);
    },
    clear() {
      map.clear();
    }
  };
}
var dtfCache = createBoundedCache();
var nfCache = createBoundedCache();
var rtfCache = createBoundedCache();
var lfCache = createBoundedCache();
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
      const cacheKey = `${locale}::${JSON.stringify(mergedOptions)}`;
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
      const cacheKey = `${locale}::${JSON.stringify(nfOptions ?? {})}`;
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
      const cacheKey = `${locale}::${JSON.stringify(rtfOptions ?? {})}`;
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
      const cacheKey = `${locale}::${JSON.stringify(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(value).join(", ");
        }
      }
      try {
        return formatter.format(value);
      } catch {
        return Array.from(value).join(", ");
      }
    }
  };
}
export {
  clearFormatterCache,
  createFormatter
};
