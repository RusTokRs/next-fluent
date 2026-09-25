import type { FluentBundle, FluentFunction, FluentVariable } from '@fluent/bundle';
import type React from 'react';
export type { FluentBundle, FluentVariable, FluentFunction };
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
}
export interface Formatter {
    readonly locale: string;
    readonly timeZone?: string;
    dateTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
    number(value: number | bigint, options?: Intl.NumberFormatOptions): string;
    relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
    list(value: Iterable<string>, options?: Intl.ListFormatOptions): string;
}
export type LocalePrefixMode = 'always' | 'as-needed' | 'never';
export type Pathnames<Locales extends readonly string[] = readonly string[]> = Record<string, string | Record<Locales[number] | string, string>>;
export interface NavigationConfig<Locales extends readonly string[] = readonly string[]> {
    locales: Locales;
    defaultLocale: Locales[number] | string;
    localePrefix?: LocalePrefixMode;
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
}
export interface Navigation<Locales extends readonly string[] = readonly string[], Routes extends string = string> {
    Link: React.ForwardRefExoticComponent<Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
        href: NavigationHref<Routes>;
        locale?: Locales[number];
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
        }): void;
        replace(href: NavigationHref<Routes>, options?: {
            locale?: Locales[number];
            scroll?: boolean;
        }): void;
        prefetch(href: NavigationHref<Routes>, options?: {
            locale?: Locales[number];
        }): void;
        back(): void;
        forward(): void;
        refresh(): void;
    };
    redirect(url: Extract<NavigationHref<Routes>, string>, options?: {
        locale?: Locales[number];
        type?: 'push' | 'replace';
    }): never;
    permanentRedirect(url: Extract<NavigationHref<Routes>, string>, options?: {
        locale?: Locales[number];
        type?: 'push' | 'replace';
    }): never;
    getPathname(options: Omit<GetPathnameOptions<Routes>, 'locale'> & {
        locale?: Locales[number];
    }): string;
}
export interface RequestConfigParams {
    locale?: string;
}
export interface RequestConfigResult {
    locale?: string;
    messages: string | readonly string[];
    fallbackLocale?: string;
    fallbackMessages?: string | readonly string[];
    defaultTranslationValues?: RichTranslationValues;
    timeZone?: string;
    now?: Date;
    functions?: Record<string, FluentFunction>;
}
export type RequestConfigFn = (params: RequestConfigParams) => Promise<RequestConfigResult> | RequestConfigResult;
export interface GetTranslationsOptions {
    locale?: string;
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
export interface I18nMiddlewareOptions {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: 'always' | 'as-needed' | 'never';
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
}
export interface I18nConfig {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: 'always' | 'as-needed' | 'never';
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
    loadMessages?: (locale: string) => Promise<string | readonly string[]> | string | readonly string[];
}
