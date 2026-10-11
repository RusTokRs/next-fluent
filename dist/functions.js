import { LRUCache } from "./lru.js";
function unwrapFluentValue(val) {
  if (val && typeof val === "object" && typeof val.valueOf === "function") {
    return val.valueOf();
  }
  return val;
}
const numberFormatCache = new LRUCache(200);
const refusedNumberFormats = /* @__PURE__ */ new Set();
const MAX_REFUSED_REPORTS = 200;
function warnRefusedFormat(name, locale, named, fallback) {
  const key = `${name}::${locale}::${Object.entries(named).map(([k, v]) => `${k}=${String(unwrapFluentValue(v))}`).sort().join(",")}`;
  if (refusedNumberFormats.has(key)) return;
  if (refusedNumberFormats.size >= MAX_REFUSED_REPORTS) refusedNumberFormats.clear();
  refusedNumberFormats.add(key);
  console.warn(
    `[next-fluent] Intl refused the options of ${name}() for "${locale}" (${key.split("::").slice(2).join("::")}); the value was rendered as ${JSON.stringify(fallback)}.`
  );
}
function clearFunctionsCache() {
  numberFormatCache.clear();
  refusedNumberFormats.clear();
}
function getCachedNumberFormat(locale, options) {
  const cacheKey = `${locale}::${options.style}::${options.currency ?? ""}::${options.currencyDisplay ?? ""}::${options.minimumFractionDigits ?? ""}::${options.maximumFractionDigits ?? ""}`;
  let nf = numberFormatCache.get(cacheKey);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(cacheKey, nf);
  }
  return nf;
}
function createDefaultFunctions(locale) {
  return {
    CURRENCY: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? "");
      }
      const currency = String(unwrapFluentValue(named.currency) || "USD");
      const currencyDisplay = named.currencyDisplay ? String(unwrapFluentValue(named.currencyDisplay)) : void 0;
      const minFraction = named.minimumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.minimumFractionDigits)) : void 0;
      const maxFraction = named.maximumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.maximumFractionDigits)) : void 0;
      try {
        return getCachedNumberFormat(locale, {
          style: "currency",
          currency,
          currencyDisplay,
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction
        }).format(num);
      } catch {
        const fallback = `${num} ${currency}`;
        warnRefusedFormat("CURRENCY", locale, named, fallback);
        return fallback;
      }
    },
    PERCENT: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? "");
      }
      const minFraction = named.minimumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.minimumFractionDigits)) : void 0;
      const maxFraction = named.maximumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.maximumFractionDigits)) : void 0;
      try {
        return getCachedNumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction
        }).format(num);
      } catch {
        const fallback = `${num * 100}%`;
        warnRefusedFormat("PERCENT", locale, named, fallback);
        return fallback;
      }
    }
  };
}
export {
  clearFunctionsCache,
  createDefaultFunctions,
  unwrapFluentValue
};
