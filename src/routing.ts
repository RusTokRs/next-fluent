import type { LocalePrefixMode } from './types';
import { validateI18nConfig } from './utils';
import { validatePathnames, validateRouteEnvironment } from './route-engine';

export interface DomainConfig {
  domain: string;
  defaultLocale: string;
  locales?: readonly string[];
}

export type Pathnames<Locales extends readonly string[] = readonly string[]> = Record<
  string,
  string | Record<Locales[number], string>
>;

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
export function defineRouting<
  const Locales extends readonly string[],
  const Routes extends Pathnames<Locales>
>(config: Omit<RoutingConfig<Locales>, 'pathnames'> & { pathnames: Routes }): Omit<RoutingConfig<Locales>, 'pathnames'> & { pathnames: Routes };
export function defineRouting<const Locales extends readonly string[]>(
  config: RoutingConfig<Locales>
): RoutingConfig<Locales>;
export function defineRouting<const Locales extends readonly string[]>(
  config: RoutingConfig<Locales>
): RoutingConfig<Locales> {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
    cookieName: config.cookieName,
    headerName: config.headerName,
  });
  validatePathnames(config.locales, config.pathnames);
  validateRouteEnvironment(config.locales, config.domains, config.basePath);

  return Object.freeze({
    ...config,
    localePrefix: config.localePrefix ?? 'always',
    cookieName: config.cookieName ?? 'NEXT_LOCALE',
    headerName: config.headerName ?? 'x-next-locale',
  });
}
