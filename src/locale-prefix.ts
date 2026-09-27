import type { LocalePrefixConfig, LocalePrefixMode } from './types';
import { matchSupportedLocale, validateLocalePrefix } from './utils';

export { validateLocalePrefix };

/**
 * Per-locale prefix support: `localePrefix` may be a bare mode or
 * `{ mode, prefixes: { 'en-US': '/usa' } }`, matching the next-intl shape.
 */
export interface NormalizedLocalePrefix {
  mode: LocalePrefixMode;
  /** Canonical locale spelling → prefix path (always `/`-leading, no trailing `/`). */
  prefixes: Record<string, string>;
}

export interface LocalePrefixMatch {
  locale: string;
  /** Pathname without the prefix, always `/`-leading. */
  rest: string;
}

/**
 * Collapses a leading run of `/` and `\` into a single `/`.
 *
 * `new URL('//evil.example/x', origin)` is protocol-relative and resolves to
 * another host, and browsers treat `\` as `/`, so a path such as
 * `/ru//evil.example/x` must never reach a redirect target verbatim.
 */
/**
 * A leading run of two or more path separators. Both `/` and `\` act as
 * separators to the URL parser, so `//host` and `/\host` are protocol-relative
 * and resolve to another origin.
 */
const LEADING_SLASH_RUN = /^[/\\]{2,}/;

export function normalizeLeadingSlashes(path: string): string {
  if (!LEADING_SLASH_RUN.test(path)) return path;
  return `/${path.replace(LEADING_SLASH_RUN, '')}`;
}

export function normalizeLocalePrefix(
  locales: readonly string[],
  localePrefix?: LocalePrefixConfig
): NormalizedLocalePrefix {
  const mode: LocalePrefixMode =
    typeof localePrefix === 'object' && localePrefix !== null
      ? (localePrefix.mode ?? 'always')
      : (localePrefix as LocalePrefixMode) ?? 'always';

  const raw =
    typeof localePrefix === 'object' && localePrefix !== null ? localePrefix.prefixes : undefined;

  // Resolve each custom key once, rather than re-enumerating the entire map
  // (and re-running locale lookup) for every configured locale. Preserve the
  // first match when several aliases resolve to the same supported locale.
  const custom = new Map<string, string | undefined>();
  for (const [key, prefix] of Object.entries(raw ?? {})) {
    const locale = matchSupportedLocale(key, locales);
    if (locale && !custom.has(locale)) custom.set(locale, prefix);
  }
  const prefixes: Record<string, string> = {};
  for (const locale of locales) {
    prefixes[locale] = custom.get(locale) ?? `/${locale}`;
  }
  return { mode, prefixes };
}

/** The URL prefix a locale is served under (`/ru`, or a configured custom one). */
export function prefixForLocale(locale: string, config: NormalizedLocalePrefix): string {
  return config.prefixes[locale] ?? `/${locale}`;
}

/** Whether a locale carries a prefix in generated URLs at all. */
export function localeNeedsPrefix(
  locale: string,
  defaultLocale: string,
  mode: LocalePrefixMode
): boolean {
  if (mode === 'never') return false;
  if (mode === 'as-needed') return !matchSupportedLocale(locale, [defaultLocale]);
  return true;
}

/**
 * Cache the sorted prefix table per live locales/config pair. Middleware reuses
 * normalized configs across requests, so it can avoid sorting and allocating
 * an O(n log n) table on every prefix match.
 *
 * Both levels must be weak: navigation creates temporary normalized configs
 * while reusing a long-lived locales array. An ordinary inner Map would retain
 * every one of those configs and its sorted table for the array's lifetime.
 */
const prefixTables = new WeakMap<
  readonly string[],
  WeakMap<NormalizedLocalePrefix, { locale: string; prefix: string }[]>
>();

function sortedPrefixEntries(
  locales: readonly string[],
  config: NormalizedLocalePrefix
): { locale: string; prefix: string }[] {
  let byConfig = prefixTables.get(locales);
  if (!byConfig) {
    byConfig = new WeakMap();
    prefixTables.set(locales, byConfig);
  }
  let entries = byConfig.get(config);
  if (!entries) {
    entries = locales
      .map((locale) => ({ locale, prefix: prefixForLocale(locale, config) }))
      .sort((a, b) => b.prefix.length - a.prefix.length);
    byConfig.set(config, entries);
  }
  return entries;
}

/** Match longest prefixes first and return the locale plus the unprefixed path. */
export function matchLocalePrefix(
  pathname: string,
  locales: readonly string[],
  config: NormalizedLocalePrefix
): LocalePrefixMatch | null {
  const entries = sortedPrefixEntries(locales, config);

  for (const { locale, prefix } of entries) {
    if (pathname === prefix) return { locale, rest: '/' };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, rest: normalizeLeadingSlashes(pathname.slice(prefix.length)) || '/' };
    }
  }
  return null;
}
