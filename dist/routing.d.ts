import type { DomainConfig, LocaleCookieConfig, LocalePrefixConfig } from './types';
export type { DomainConfig } from './types';
export type Pathnames<Locales extends readonly string[] = readonly string[]> = Record<string, string | Record<Locales[number], string>>;
export interface RoutingConfig<Locales extends readonly string[] = readonly string[]> {
    locales: Locales;
    defaultLocale: Locales[number];
    localePrefix?: LocalePrefixConfig;
    pathnames?: Pathnames<Locales>;
    domains?: readonly DomainConfig[];
    cookieName?: string;
    headerName?: string;
    basePath?: string;
    localeCookie?: boolean | LocaleCookieConfig;
    localeDetection?: boolean;
    alternateLinks?: boolean;
    trustedHosts?: readonly string[];
}
/** Readonly properties and tuples for the plain data returned by defineRouting. */
type Immutable<T> = T extends object ? {
    readonly [Key in keyof T]: Immutable<T[Key]>;
} : T;
/**
 * Defines the central routing configuration for next-fluent.
 * Returns an independent, deeply frozen snapshot of the supported settings,
 * preserving type-safe inference for locales and pathnames.
 */
export declare function defineRouting<const Locales extends readonly string[], const Routes extends Pathnames<Locales>>(config: Omit<RoutingConfig<Locales>, 'pathnames'> & {
    pathnames: Routes;
}): Immutable<Omit<RoutingConfig<Locales>, 'pathnames'> & {
    pathnames: Routes;
}>;
export declare function defineRouting<const Locales extends readonly string[]>(config: RoutingConfig<Locales>): Immutable<RoutingConfig<Locales>>;
