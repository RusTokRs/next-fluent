import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type { DefaultKey, Formatter, FluentMessages, GetTranslationsOptions, RequestConfigFn, RequestConfigResult, RichTranslationValues, Translations, NamespaceArgs, NamespaceKeys } from './types';
export interface ServerI18nOptions {
    locales?: readonly string[];
    defaultLocale?: string;
    cookieName?: string;
    cookieNames?: readonly string[];
    headerName?: string;
}
export declare function configureServerI18n(config: {
    locales?: readonly string[];
    defaultLocale?: string;
}): void;
export declare function setRequestConfig(fn: RequestConfigFn): RequestConfigFn;
export declare function getRequestConfig(): RequestConfigFn | null;
interface RequestStore {
    locale?: string;
    timeZone?: string;
    now?: Date;
    defaultTranslationValues?: RichTranslationValues;
    functions?: Record<string, FluentFunction>;
    bundles: Map<string, FluentBundle>;
    configs: Map<string, Promise<RequestConfigResult>>;
}
export declare const getRequestStore: () => RequestStore;
export declare function setRequestLocale(locale: string, locales?: readonly string[]): void;
export declare function getLocale(options?: ServerI18nOptions): Promise<string>;
export declare function getMessages(localeArg?: string): Promise<string | readonly string[]>;
export declare function getRequestConfigSnapshot(localeArg?: string): Promise<RequestConfigResult & {
    locale: string;
    timeZone: string;
    now: Date;
}>;
export declare function getTimeZone(): string;
export declare function getNow(): Date;
export declare function getFormatter(options?: {
    locale?: string;
    timeZone?: string;
}): Promise<Formatter>;
export declare function getStaticParams(locales?: readonly string[]): {
    locale: string;
}[];
export interface ForLocaleOptions {
    messages?: string | readonly string[];
    fallbackLocale?: string;
    fallbackLocales?: readonly string[];
    fallbackMessages?: string | readonly string[];
    defaultTranslationValues?: RichTranslationValues;
    namespace?: string;
    debug?: boolean;
    strictNamespace?: boolean;
    functions?: Record<string, FluentFunction>;
    /** Instance-scoped request loader used by createI18n. */
    requestConfig?: RequestConfigFn;
}
export declare function forLocale<Namespace extends string>(locale: string, namespace: Namespace): Promise<Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>>;
export declare function forLocale<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = FluentMessages>(locale: string, options?: string | ForLocaleOptions): Promise<Translations<Key, ArgsMap>>;
export declare function getTranslations<Namespace extends string>(namespace: Namespace): Promise<Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>>;
export declare function getTranslations<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = FluentMessages>(options?: string | ({
    locale?: string;
} & GetTranslationsOptions)): Promise<Translations<Key, ArgsMap>>;
export {};
