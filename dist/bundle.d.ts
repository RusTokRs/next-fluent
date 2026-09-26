import type { FluentBundle } from '@fluent/bundle';
import type { GetMessageFallbackFn, OnErrorFn, RichTranslationValues, Translations } from './types';
import { getCachedFluentBundle, getBundleCacheStats, LRUCache, type CreateFluentBundleOptions } from './cache';
import { clearFunctionsCache } from './functions';
import { FluentErrorCode, FluentError } from './errors';
export declare function clearBundleCache(): void;
export { getCachedFluentBundle, clearFunctionsCache, getBundleCacheStats, LRUCache, FluentError, FluentErrorCode, type CreateFluentBundleOptions, };
export declare function createFluentBundle(locale: string, ftlSource: string | readonly string[], options?: CreateFluentBundleOptions): FluentBundle;
export interface CreateTranslatorOptions {
    fallbackBundle?: FluentBundle | null;
    fallbackBundles?: FluentBundle | readonly FluentBundle[] | null;
    namespace?: string;
    debug?: boolean;
    defaultTranslationValues?: RichTranslationValues;
    strictNamespace?: boolean;
    onError?: OnErrorFn;
    getMessageFallback?: GetMessageFallbackFn;
}
export declare function createTranslator(bundle: FluentBundle | null, namespaceOrFallbackOrOpts?: string | FluentBundle | CreateTranslatorOptions | null, maybeNamespace?: string): Translations;
