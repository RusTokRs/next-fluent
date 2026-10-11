import { FluentBundle, FluentResource, type FluentFunction } from '@fluent/bundle';
export interface CreateFluentBundleOptions {
    useIsolating?: boolean;
    functions?: Record<string, FluentFunction>;
    disableCache?: boolean;
}
import { LRUCache } from './lru';
export { LRUCache };
export declare function computeSourceHash(source: string | readonly string[]): string;
export declare function getOrCreateResource(source: string): FluentResource;
export declare function getCachedFluentBundle(locale: string, rawSource: string | readonly string[], options?: CreateFluentBundleOptions): FluentBundle;
export declare function clearBundleCache(): void;
export declare function getBundleCacheStats(): {
    resourceCount: number;
    bundleCount: number;
};
