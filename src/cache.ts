import { FluentBundle, FluentResource, type FluentFunction } from '@fluent/bundle';
import { createDefaultFunctions } from './functions';

export interface CreateFluentBundleOptions {
  useIsolating?: boolean;
  functions?: Record<string, FluentFunction>;
  disableCache?: boolean;
}

import { LRUCache } from './lru';
export { LRUCache };

const MAX_RESOURCE_CACHE = 1000;
const MAX_BUNDLE_CACHE = 500;

/**
 * Fast 32-bit FNV-1a hash without heap allocations (no BigInt).
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Backwards-compatible alias for 64-bit/32-bit string hashing.
 */
export function fnv1a64(input: string): string {
  return fnv1a32(input);
}

export function computeSourceHash(source: string | readonly string[]): string {
  if (typeof source === 'string') {
    return `${source.length}:${fnv1a32(source)}`;
  }
  let totalLen = 0;
  let combinedHash = 0x811c9dc5;
  for (const item of source) {
    if (!item) continue;
    totalLen += item.length;
    for (let i = 0; i < item.length; i++) {
      combinedHash ^= item.charCodeAt(i);
      combinedHash = Math.imul(combinedHash, 0x01000193);
    }
    // Delimiter step
    combinedHash ^= 0;
    combinedHash = Math.imul(combinedHash, 0x01000193);
  }
  return `${source.length}:${totalLen}:${(combinedHash >>> 0).toString(16).padStart(8, '0')}`;
}

const resourceCache = new LRUCache<FluentResource>(MAX_RESOURCE_CACHE);
const bundleCache = new LRUCache<FluentBundle>(MAX_BUNDLE_CACHE);

export function getOrCreateResource(source: string): FluentResource {
  const hash = `${source.length}:${fnv1a32(source)}`;
  let res = resourceCache.get(hash);
  if (!res) {
    res = new FluentResource(source);
    resourceCache.set(hash, res);
  }
  return res;
}

export function getCachedFluentBundle(
  locale: string,
  ftlSource: string | readonly string[],
  options: CreateFluentBundleOptions = {}
): FluentBundle {
  const useIsolating = options.useIsolating ?? true;
  const hasCustomFunctions = options.functions && Object.keys(options.functions).length > 0;

  const sourceHash = computeSourceHash(ftlSource);
  const cacheKey = `${locale}:iso=${useIsolating}:${sourceHash}`;

  if (!hasCustomFunctions && !options.disableCache) {
    const cached = bundleCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const defaultFunctions = createDefaultFunctions(locale);
  const bundle = new FluentBundle(locale, {
    useIsolating,
    functions: {
      ...defaultFunctions,
      ...options.functions,
    },
  });

  const sources = Array.isArray(ftlSource) ? ftlSource : [ftlSource];
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    const resource = options.disableCache
      ? new FluentResource(src)
      : getOrCreateResource(src);
    const errors = bundle.addResource(resource, { allowOverrides: true });
    if (errors && errors.length > 0) {
      console.warn(`[next-fluent] Warnings adding FTL resource for locale ${locale}:`, errors);
    }
  }

  if (!hasCustomFunctions && !options.disableCache) {
    bundleCache.set(cacheKey, bundle);
  }

  return bundle;
}

export function clearBundleCache(): void {
  resourceCache.clear();
  bundleCache.clear();
}

export function getBundleCacheStats(): { resourceCount: number; bundleCount: number } {
  return {
    resourceCount: resourceCache.size,
    bundleCount: bundleCache.size,
  };
}
