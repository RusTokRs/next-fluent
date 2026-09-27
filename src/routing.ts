import type { LocaleCookieConfig, LocalePrefixConfig } from './types';
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

  // The returned config is frozen, but a spread does not freeze the arrays
  // inside it — and `matchLocalePrefix` memoizes its prefix table by the
  // identity of `locales`, so a later `routing.locales.push(...)` would leave a
  // stale table behind. Snapshotting and freezing here makes the `readonly` in
  // the type true at runtime, and keeps routing behaviour from changing under
  // the caller if they reuse the array elsewhere.
  return Object.freeze({
    ...config,
    // Same elements, same order, so the inferred tuple type still describes it.
    locales: Object.freeze([...config.locales]) as Locales,
    localePrefix: config.localePrefix ?? 'always',
    cookieName: config.cookieName ?? 'NEXT_LOCALE',
    headerName: config.headerName ?? 'x-next-locale',
  });
}
