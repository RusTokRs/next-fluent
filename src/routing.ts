import type { DomainConfig, LocaleCookieConfig, LocalePrefixConfig } from './types';
import { validateI18nConfig } from './utils';
import { validatePathnames, validateRouteEnvironment } from './route-engine';

export type { DomainConfig } from './types';

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

/** Readonly properties and tuples for the plain data returned by defineRouting. */
type Immutable<T> = T extends object ? { readonly [Key in keyof T]: Immutable<T[Key]> } : T;

/** Snapshot routing data without ever freezing a caller-owned object. */
function copyAndFreeze<T>(value: T, copies = new WeakMap<object, unknown>()): Immutable<T> {
  if (value === null || typeof value !== 'object') return value as Immutable<T>;
  const prototype = Object.getPrototypeOf(value);
  // Routing settings are plain records/arrays. Preserve opaque extension values
  // (e.g. application metadata containing a Date) rather than corrupting them.
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return value as Immutable<T>;
  }
  const existing = copies.get(value);
  if (existing) return existing as Immutable<T>;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(copy)) {
    Object.defineProperty(copy, key, { value: copyAndFreeze(Reflect.get(copy, key), copies) });
  }
  return Object.freeze(copy) as Immutable<T>;
}

/**
 * Defines the central routing configuration for next-fluent.
 * Returns an independent, deeply frozen snapshot of the supported settings,
 * preserving type-safe inference for locales and pathnames.
 */
export function defineRouting<
  const Locales extends readonly string[],
  const Routes extends Pathnames<Locales>
>(config: Omit<RoutingConfig<Locales>, 'pathnames'> & { pathnames: Routes }): Immutable<Omit<RoutingConfig<Locales>, 'pathnames'> & { pathnames: Routes }>;
export function defineRouting<const Locales extends readonly string[]>(
  config: RoutingConfig<Locales>
): Immutable<RoutingConfig<Locales>>;
export function defineRouting<const Locales extends readonly string[]>(
  config: RoutingConfig<Locales>
): Immutable<RoutingConfig<Locales>> {
  const normalized = { ...config };
  if (normalized.localePrefix === undefined) normalized.localePrefix = 'always';
  normalized.cookieName ??= 'NEXT_LOCALE';
  normalized.headerName ??= 'x-next-locale';
  const snapshot = copyAndFreeze(normalized);
  // Validate the exact snapshot consumers will read, not the mutable input.
  validateI18nConfig(snapshot);
  validatePathnames(snapshot.locales, snapshot.pathnames);
  validateRouteEnvironment(snapshot.locales, snapshot.domains, snapshot.basePath);
  return snapshot;
}
