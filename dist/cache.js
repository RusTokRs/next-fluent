import { FluentBundle, FluentResource } from "@fluent/bundle";
import { createDefaultFunctions } from "./functions.js";
import { LRUCache } from "./lru.js";
const MAX_RESOURCE_CACHE = 1e3;
const MAX_BUNDLE_CACHE = 500;
function fnv1a32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function fnv1a64(input) {
  return fnv1a32(input);
}
function computeSourceHash(source) {
  if (typeof source === "string") {
    return `${source.length}:${fnv1a32(source)}`;
  }
  let totalLen = 0;
  let combinedHash = 2166136261;
  for (const item of source) {
    if (!item) continue;
    totalLen += item.length;
    for (let i = 0; i < item.length; i++) {
      combinedHash ^= item.charCodeAt(i);
      combinedHash = Math.imul(combinedHash, 16777619);
    }
    combinedHash ^= 31;
    combinedHash = Math.imul(combinedHash, 16777619);
  }
  return `${source.length}:${totalLen}:${(combinedHash >>> 0).toString(16).padStart(8, "0")}`;
}
const resourceCache = new LRUCache(MAX_RESOURCE_CACHE);
const bundleCache = new LRUCache(MAX_BUNDLE_CACHE);
function sameSource(a, b) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
function getOrCreateResource(source) {
  const hash = `${source.length}:${fnv1a32(source)}`;
  const cached = resourceCache.get(hash);
  if (cached?.source === source) return cached.resource;
  const res = new FluentResource(source);
  resourceCache.set(hash, { source, resource: res });
  return res;
}
function getCachedFluentBundle(locale, ftlSource, options = {}) {
  const useIsolating = options.useIsolating ?? true;
  const hasCustomFunctions = options.functions && Object.keys(options.functions).length > 0;
  const sourceHash = computeSourceHash(ftlSource);
  const cacheKey = `${locale}:iso=${useIsolating}:${sourceHash}`;
  if (!hasCustomFunctions && !options.disableCache) {
    const cached = bundleCache.get(cacheKey);
    if (cached && sameSource(cached.source, ftlSource)) {
      return cached.bundle;
    }
  }
  const defaultFunctions = createDefaultFunctions(locale);
  const bundle = new FluentBundle(locale, {
    useIsolating,
    functions: {
      ...defaultFunctions,
      ...options.functions
    }
  });
  const sources = Array.isArray(ftlSource) ? ftlSource : [ftlSource];
  for (const src of sources) {
    if (!src || typeof src !== "string") continue;
    const resource = options.disableCache ? new FluentResource(src) : getOrCreateResource(src);
    const errors = bundle.addResource(resource, { allowOverrides: true });
    if (errors && errors.length > 0) {
      console.warn(`[next-fluent] Warnings adding FTL resource for locale ${locale}:`, errors);
    }
  }
  if (!hasCustomFunctions && !options.disableCache) {
    bundleCache.set(cacheKey, {
      source: typeof ftlSource === "string" ? ftlSource : [...ftlSource],
      bundle
    });
  }
  return bundle;
}
function clearBundleCache() {
  resourceCache.clear();
  bundleCache.clear();
}
function getBundleCacheStats() {
  return {
    resourceCount: resourceCache.size,
    bundleCount: bundleCache.size
  };
}
export {
  LRUCache,
  clearBundleCache,
  computeSourceHash,
  fnv1a32,
  fnv1a64,
  getBundleCacheStats,
  getCachedFluentBundle,
  getOrCreateResource
};
