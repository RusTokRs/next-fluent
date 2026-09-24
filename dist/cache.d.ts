import { FluentBundle, FluentResource, type FluentFunction } from '@fluent/bundle';
export interface CreateFluentBundleOptions {
    useIsolating?: boolean;
    functions?: Record<string, FluentFunction>;
    disableCache?: boolean;
}
import { LRUCache } from './lru';
export { LRUCache };
/**
 * Fast 32-bit FNV-1a hash without heap allocations (no BigInt).
 */
export declare function fnv1a32(input: string): string;
/**
 * Backwards-compatible alias for 64-bit/32-bit string hashing.
 */
export declare function fnv1a64(input: string): string;
export declare function computeSourceHash(source: string | readonly string[]): string;
export declare function getOrCreateResource(source: string): FluentResource;
export declare function getCachedFluentBundle(locale: string, ftlSource: string | readonly string[], options?: CreateFluentBundleOptions): FluentBundle;
export declare function clearBundleCache(): void;
export declare function getBundleCacheStats(): {
    resourceCount: number;
    bundleCount: number;
};
