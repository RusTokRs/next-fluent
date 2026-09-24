import type { FluentBundle } from '@fluent/bundle';
import type { RichTranslationValues, Translations } from './types';
import { getCachedFluentBundle, getBundleCacheStats, LRUCache, type CreateFluentBundleOptions } from './cache';
import { clearFunctionsCache } from './functions';
export declare function clearBundleCache(): void;
export { getCachedFluentBundle, clearFunctionsCache, getBundleCacheStats, LRUCache, type CreateFluentBundleOptions, };
export declare function createFluentBundle(locale: string, ftlSource: string | readonly string[], options?: CreateFluentBundleOptions): FluentBundle;
export interface CreateTranslatorOptions {
    fallbackBundle?: FluentBundle | null;
    fallbackBundles?: FluentBundle | readonly FluentBundle[] | null;
    namespace?: string;
    debug?: boolean;
    defaultTranslationValues?: RichTranslationValues;
    strictNamespace?: boolean;
}
export declare function createTranslator(bundle: FluentBundle | null, namespaceOrFallbackOrOpts?: string | FluentBundle | CreateTranslatorOptions | null, maybeNamespace?: string): Translations;
