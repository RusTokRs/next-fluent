import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type { Formatter, GetTranslationsOptions, RequestConfigFn, RichTranslationValues, Translations } from './types';
export interface ServerI18nOptions {
    locales?: readonly string[];
    defaultLocale?: string;
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
}
export declare const getRequestStore: () => RequestStore;
export declare function setRequestLocale(locale: string): void;
export declare function getLocale(options?: ServerI18nOptions): Promise<string>;
export declare function getMessages(localeArg?: string): Promise<string | readonly string[]>;
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
}
export declare function forLocale<Key extends string = string, ArgsMap extends Record<string, any> = Record<string, any>>(locale: string, options?: string | ForLocaleOptions): Promise<Translations<Key, ArgsMap>>;
export declare function getTranslations<Key extends string = string, ArgsMap extends Record<string, any> = Record<string, any>>(options?: string | ({
    locale?: string;
} & GetTranslationsOptions)): Promise<Translations<Key, ArgsMap>>;
export {};
