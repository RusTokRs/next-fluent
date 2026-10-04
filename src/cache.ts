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
    // Delimiter step — use a real separator byte so that different array
    // splits of the same concatenated content produce distinct hashes.
    combinedHash ^= 0x1f; // ASCII Unit Separator
    combinedHash = Math.imul(combinedHash, 0x01000193);
  }
  return `${source.length}:${totalLen}:${(combinedHash >>> 0).toString(16).padStart(8, '0')}`;
}

const resourceCache = new LRUCache<{ source: string; resource: FluentResource }>(MAX_RESOURCE_CACHE);
const bundleCache = new LRUCache<{
  source: string | readonly string[];
  bundle: FluentBundle;
}>(MAX_BUNDLE_CACHE);

interface CachedBundle {
  source: string | readonly string[];
  bundle: FluentBundle;
}

/**
 * Cache keyed by the custom-functions object itself.
 *
 * A bundle built with custom Fluent functions cannot join the shared cache (the
 * functions are part of its behavior), but the same functions object is usually
 * reused — a module-level table, or the stable identity `FluentProvider`
 * maintains — and re-parsing the whole catalog on every request is pure waste.
 * A `WeakMap` keyed by that object keeps the isolation without leaking it.
 */
const functionBundleCaches = new WeakMap<object, LRUCache<CachedBundle>>();

/**
 * Bumped by `clearBundleCache()`. Per-functions caches cannot be enumerated
 * (that is what makes them leak-free), so a clear invalidates them by changing
 * the keys instead.
 */
let cacheGeneration = 0;

function getFunctionBundleCache(functions: object): LRUCache<CachedBundle> {
  let cache = functionBundleCaches.get(functions);
  if (!cache) {
    cache = new LRUCache<CachedBundle>(MAX_BUNDLE_CACHE);
    functionBundleCaches.set(functions, cache);
  }
  return cache;
}

function sameSource(a: string | readonly string[], b: string | readonly string[]): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function getOrCreateResource(source: string): FluentResource {
  const hash = `${source.length}:${fnv1a32(source)}`;
  const cached = resourceCache.get(hash);
  if (cached?.source === source) return cached.resource;
  const res = new FluentResource(source);
  resourceCache.set(hash, { source, resource: res });
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
  const cacheKey = `${locale}:iso=${useIsolating}:gen=${cacheGeneration}:${sourceHash}`;
  const cache = options.disableCache
    ? undefined
    : hasCustomFunctions
      ? getFunctionBundleCache(options.functions as object)
      : bundleCache;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached && sameSource(cached.source, ftlSource)) {
      return cached.bundle;
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

  if (cache) {
    cache.set(cacheKey, {
      source: typeof ftlSource === 'string' ? ftlSource : [...ftlSource],
      bundle,
    });
  }

  return bundle;
}

export function clearBundleCache(): void {
  cacheGeneration++;
  resourceCache.clear();
  bundleCache.clear();
}

export function getBundleCacheStats(): { resourceCount: number; bundleCount: number } {
  return {
    resourceCount: resourceCache.size,
    bundleCount: bundleCache.size,
  };
}
