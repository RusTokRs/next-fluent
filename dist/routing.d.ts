import type { LocalePrefixMode } from './types';
export interface DomainConfig {
    domain: string;
    defaultLocale: string;
    locales?: readonly string[];
}
export type Pathnames<Locales extends readonly string[] = readonly string[]> = Record<string, string | Record<Locales[number], string>>;
export interface RoutingConfig<Locales extends readonly string[] = readonly string[]> {
    locales: Locales;
    defaultLocale: Locales[number];
    localePrefix?: LocalePrefixMode;
    pathnames?: Pathnames<Locales>;
    domains?: readonly DomainConfig[];
    cookieName?: string;
    headerName?: string;
    basePath?: string;
}
/**
 * Defines the central routing configuration for next-fluent.
 * Validates configuration and provides type-safe inference for locales and pathnames.
 */
export declare function defineRouting<const Locales extends readonly string[], const Routes extends Pathnames<Locales>>(config: Omit<RoutingConfig<Locales>, 'pathnames'> & {
    pathnames: Routes;
}): Omit<RoutingConfig<Locales>, 'pathnames'> & {
    pathnames: Routes;
};
export declare function defineRouting<const Locales extends readonly string[]>(config: RoutingConfig<Locales>): RoutingConfig<Locales>;
