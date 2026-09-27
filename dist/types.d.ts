import type { FluentBundle, FluentFunction, FluentVariable } from '@fluent/bundle';
import type React from 'react';
import type { GetMessageFallbackFn, OnErrorFn } from './errors';
export type { FluentBundle, FluentVariable, FluentFunction };
export type { JsonCatalog, MessageSource } from './catalog';
import type { MessageSource } from './catalog';
export type { OnErrorFn, GetMessageFallbackFn, MessageFallbackArgs } from './errors';
export { FluentError, FluentErrorCode } from './errors';
export type NonEmptyArray<T> = readonly [T, ...T[]];
export type FluentArgs = Record<string, FluentVariable>;
export type TagRenderFn = (children: React.ReactNode) => React.ReactNode;
export type RichTranslationValues = Record<string, FluentVariable | TagRenderFn | React.ReactNode>;
/**
 * Declaration merging target for automatic full-app type safety.
 *
 * Example:
 * ```typescript
 * declare global {
 *   interface FluentMessages extends AppMessages {}
 * }
 * ```
 */
declare global {
    interface FluentMessages {
    }
}
type AppFluentMessages = FluentMessages;
export type { AppFluentMessages as FluentMessages };
export type DefaultKey = keyof FluentMessages extends never ? string : keyof FluentMessages & string;
export type NamespaceKeys<Namespace extends string> = keyof FluentMessages extends never ? string : {
    [K in keyof FluentMessages & string]: K extends `${Namespace}.${infer Rest}` ? Rest : K extends `${Namespace}-${infer Rest}` ? Rest : never;
}[keyof FluentMessages & string];
export type NamespaceArgs<Namespace extends string> = keyof FluentMessages extends never ? Record<string, any> : {
    [K in keyof FluentMessages & string as K extends `${Namespace}.${infer Rest}` ? Rest : K extends `${Namespace}-${infer Rest}` ? Rest : never]: FluentMessages[K];
};
export type MessageArgsFor<K extends string, ArgsMap> = K extends keyof ArgsMap ? ArgsMap[K] extends Record<string, never> | undefined ? [args?: never] : [args: ArgsMap[K]] : [args?: FluentArgs];
export interface TranslationFn<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = AppFluentMessages> {
    <K extends Key>(key: K, ...args: MessageArgsFor<K, ArgsMap>): string;
    raw<K extends Key>(key: K, ...args: MessageArgsFor<K, ArgsMap>): string[] | string;
    rich<K extends Key>(key: K, values?: RichTranslationValues): React.ReactNode;
    /** Every attribute of a message, in declaration order. */
    attrs<K extends Key>(key: K, ...args: MessageArgsFor<K, ArgsMap>): Record<string, string>;
    /** Message text with rich-text markers removed. */
    plain<K extends Key>(key: K, ...args: MessageArgsFor<K, ArgsMap>): string;
    has<K extends Key>(key: K): boolean;
}
export type Translations<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = AppFluentMessages> = TranslationFn<Key, ArgsMap>;
export interface FormattedMessageProps<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = AppFluentMessages> {
    id: Key;
    args?: Key extends keyof ArgsMap ? ArgsMap[Key] : FluentArgs;
    values?: RichTranslationValues;
    fallback?: React.ReactNode;
    className?: string;
    as?: React.ElementType;
}
export interface FormatterOptions {
    locale: string;
    timeZone?: string;
    /** Named formats resolvable by passing a string to the formatter methods. */
    formats?: Formats;
}
/**
 * Named `Intl` option presets, addressable from the formatter methods:
 * `format.dateTime(value, 'short')`.
 */
export interface Formats {
    dateTime?: Record<string, Intl.DateTimeFormatOptions>;
    number?: Record<string, Intl.NumberFormatOptions>;
    relativeTime?: Record<string, Intl.RelativeTimeFormatOptions>;
    list?: Record<string, Intl.ListFormatOptions>;
}
export type FormatName<T> = T extends Record<infer K, unknown> ? K : never;
export interface Formatter {
    readonly locale: string;
    readonly timeZone?: string;
    dateTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions | string): string;
    number(value: number | bigint, options?: Intl.NumberFormatOptions | string): string;
    relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions | string): string;
    list(value: Iterable<string>, options?: Intl.ListFormatOptions | string): string;
}
export type LocalePrefixMode = 'always' | 'as-needed' | 'never';
/** Locale → URL prefix, e.g. `{ 'en-US': '/usa', de: '/deutsch' }`. */
export type LocalePrefixes = Partial<Record<string, string>>;
/**
 * `'always' | 'as-needed' | 'never'`, or the verbose form that also maps
 * individual locales to custom URL prefixes.
 */
export type LocalePrefixConfig = LocalePrefixMode | {
    mode?: LocalePrefixMode;
    prefixes?: LocalePrefixes;
};
export type Pathnames<Locales extends readonly string[] = readonly string[]> = Record<string, string | Record<Locales[number] | string, string>>;
export interface NavigationConfig<Locales extends readonly string[] = readonly string[]> {
    locales: Locales;
    defaultLocale: Locales[number] | string;
    localePrefix?: LocalePrefixConfig;
    pathnames?: Pathnames<Locales>;
    domains?: readonly {
        domain: string;
        defaultLocale: string;
        locales?: readonly string[];
    }[];
    basePath?: string;
}
export interface UrlObject {
    auth?: string | null;
    hash?: string | null;
    host?: string | null;
    hostname?: string | null;
    href?: string | null;
    pathname?: string | null;
    protocol?: string | null;
    search?: string | null;
    slashes?: boolean | null;
    port?: string | number | null;
    query?: Record<string, any> | string | null;
}
export type Href = string | UrlObject;
type RouteParamName<Param extends string> = Param extends `...${infer Name}` ? Name : Param extends `[...${infer Name}` ? Name : Param;
type RouteParams<Path extends string> = Path extends `${string}[${infer Param}]${infer Rest}` ? RouteParamName<Param> | RouteParams<Rest> : never;
type RouteUrlObject<Routes extends string> = {
    [Path in Routes]: Omit<UrlObject, 'pathname' | 'query'> & {
        pathname: Path;
        query: [RouteParams<Path>] extends [never] ? UrlObject['query'] : Record<RouteParams<Path>, string | number | readonly (string | number)[]> & Record<string, unknown>;
    };
}[Routes];
export type NavigationHref<Routes extends string = string> = string extends Routes ? Href : Routes | `${Routes}?${string}` | `${Routes}#${string}` | `https://${string}` | `http://${string}` | `mailto:${string}` | `#${string}` | RouteUrlObject<Routes>;
export interface GetPathnameOptions<Routes extends string = string> {
    href: NavigationHref<Routes>;
    locale?: string;
    domain?: string;
    /**
     * Add the locale prefix even for the default locale, which `as-needed`
     * otherwise omits. Useful when a URL must be unambiguous regardless of the
     * visitor's stored locale. A no-op in `never`, where prefixed URLs do not
     * exist and the middleware would strip one immediately.
     */
    forcePrefix?: boolean;
}
export interface Navigation<Locales extends readonly string[] = readonly string[], Routes extends string = string> {
    Link: React.ForwardRefExoticComponent<Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
        href: NavigationHref<Routes>;
        locale?: Locales[number];
        /** Force the locale prefix even for the default locale. */
        forcePrefix?: boolean;
        replace?: boolean;
        scroll?: boolean;
        prefetch?: boolean;
        children?: React.ReactNode;
        className?: string;
    } & React.RefAttributes<HTMLAnchorElement>>;
    usePathname: () => string;
    useRouter: () => {
        push(href: NavigationHref<Routes>, options?: {
            locale?: Locales[number];
            scroll?: boolean;
            forcePrefix?: boolean;
        }): void;
        replace(href: NavigationHref<Routes>, options?: {
            locale?: Locales[number];
            scroll?: boolean;
            forcePrefix?: boolean;
        }): void;
        prefetch(href: NavigationHref<Routes>, options?: {
            locale?: Locales[number];
            forcePrefix?: boolean;
        }): void;
        back(): void;
        forward(): void;
        refresh(): void;
    };
    redirect(url: Extract<NavigationHref<Routes>, string> | ({
        href: string;
    } & NavigationRedirectOptions<Locales>), options?: NavigationRedirectOptions<Locales> | 'push' | 'replace'): never;
    permanentRedirect(url: Extract<NavigationHref<Routes>, string> | ({
        href: string;
    } & NavigationRedirectOptions<Locales>), options?: NavigationRedirectOptions<Locales> | 'push' | 'replace'): never;
    getPathname(options: Omit<GetPathnameOptions<Routes>, 'locale'> & {
        locale?: Locales[number];
    }): string;
    /** The routing configuration this navigation was created from. */
    config: NavigationConfig;
}
export interface NavigationRedirectOptions<Locales extends readonly string[] = readonly string[]> {
    locale?: Locales[number] | string;
    type?: 'push' | 'replace';
    forcePrefix?: boolean;
}
export interface RequestConfigParams {
    locale?: string;
}
export interface RequestConfigResult {
    locale?: string;
    /** FTL text, an array of FTL sources, or a JSON catalog object. */
    messages: MessageSource;
    fallbackLocale?: string;
    fallbackMessages?: MessageSource;
    defaultTranslationValues?: RichTranslationValues;
    timeZone?: string;
    now?: Date;
    functions?: Record<string, FluentFunction>;
    /** Named `Intl` presets used by `getFormatter()` / `useFormatter()`. */
    formats?: Formats;
    /**
     * Fluent inserts U+2068/U+2069 bidi isolates around placeables by default.
     * Disable them for catalogs rendered into non-HTML sinks (`<title>`, meta
     * tags, JSON APIs, plain-text emails).
     */
    useIsolating?: boolean;
    /** Report missing/unformattable messages to your own monitoring. */
    onError?: OnErrorFn;
    /** Customize the string rendered when a message cannot be resolved. */
    getMessageFallback?: GetMessageFallbackFn;
    /** Only resolve `namespace.key` candidates (never the bare key). */
    strictNamespace?: boolean;
}
export type RequestConfigFn = (params: RequestConfigParams) => Promise<RequestConfigResult> | RequestConfigResult;
export interface GetTranslationsOptions {
    locale?: string;
    messages?: MessageSource;
    fallbackLocale?: string;
    fallbackLocales?: readonly string[];
    fallbackMessages?: MessageSource;
    defaultTranslationValues?: RichTranslationValues;
    namespace?: string;
    debug?: boolean;
    strictNamespace?: boolean;
    functions?: Record<string, FluentFunction>;
    useIsolating?: boolean;
    onError?: OnErrorFn;
    getMessageFallback?: GetMessageFallbackFn;
}
/** Attributes accepted when configuring the locale cookie. */
export interface LocaleCookieConfig {
    /** Cookie name. Defaults to `cookieName` (`NEXT_LOCALE`). */
    name?: string;
    maxAge?: number;
    sameSite?: 'strict' | 'lax' | 'none' | boolean;
    secure?: boolean;
    domain?: string;
    path?: string;
    httpOnly?: boolean;
    partitioned?: boolean;
    priority?: 'low' | 'medium' | 'high';
}
export interface I18nMiddlewareOptions {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: LocalePrefixConfig;
    cookieName?: string;
    headerName?: string;
    pathnames?: Pathnames<any>;
    domains?: readonly {
        domain: string;
        defaultLocale: string;
        locales?: readonly string[];
    }[];
    basePath?: string;
    /**
     * When set, requests whose Host does not match this allow-list receive `421
     * Misdirected Request` instead of redirects. Protects against Host-header
     * cache poisoning; entries support a `*.` subdomain wildcard.
     */
    trustedHosts?: readonly string[];
    /**
     * Disable or customize the locale cookie. `false` stops the middleware from
     * ever writing it (the locale then comes from the URL only).
     */
    localeCookie?: boolean | LocaleCookieConfig;
    /**
     * Set to `false` to ignore the locale cookie and `Accept-Language` when the
     * URL carries no locale prefix.
     */
    localeDetection?: boolean;
    /**
     * Emit `Link: <url>; rel="alternate"; hreflang="…"` response headers for the
     * localized variants of the current route. Defaults to `true`.
     */
    alternateLinks?: boolean;
}
export interface I18nConfig {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: LocalePrefixConfig;
    cookieName?: string;
    headerName?: string;
    pathnames?: Pathnames<any>;
    domains?: readonly {
        domain: string;
        defaultLocale: string;
        locales?: readonly string[];
    }[];
    basePath?: string;
    trustedHosts?: readonly string[];
    localeCookie?: boolean | LocaleCookieConfig;
    localeDetection?: boolean;
    alternateLinks?: boolean;
    loadMessages?: (locale: string) => Promise<MessageSource> | MessageSource;
}
