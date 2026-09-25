import { LRUCache } from "./lru.js";
function unwrapFluentValue(val) {
  if (val && typeof val === "object" && typeof val.valueOf === "function") {
    return val.valueOf();
  }
  return val;
}
const numberFormatCache = new LRUCache(200);
function clearFunctionsCache() {
  numberFormatCache.clear();
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
        return `${num} ${currency}`;
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
        return `${num * 100}%`;
      }
    }
  };
}
export {
  clearFunctionsCache,
  createDefaultFunctions,
  unwrapFluentValue
};
