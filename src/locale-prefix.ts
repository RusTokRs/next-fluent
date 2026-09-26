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

function canonicalKey(locales: readonly string[], locale: string): string | undefined {
  return matchSupportedLocale(locale, locales);
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

  const prefixes: Record<string, string> = {};
  for (const locale of locales) {
    const custom = raw ? Object.entries(raw).find(([key]) => canonicalKey(locales, key) === locale) : undefined;
    prefixes[locale] = custom?.[1] ?? `/${locale}`;
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
 * Matches a pathname against the configured prefixes, longest first so that
 * `/en-us` wins over `/en`. Returns the locale and the remaining path.
 */
export function matchLocalePrefix(
  pathname: string,
  locales: readonly string[],
  config: NormalizedLocalePrefix
): LocalePrefixMatch | null {
  const entries = locales
    .map((locale) => ({ locale, prefix: prefixForLocale(locale, config) }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { locale, prefix } of entries) {
    if (pathname === prefix) return { locale, rest: '/' };
    if (pathname.startsWith(`${prefix}/`)) {
      return { locale, rest: normalizeLeadingSlashes(pathname.slice(prefix.length)) || '/' };
    }
  }
  return null;
}
