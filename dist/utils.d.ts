import type { LocalePrefixConfig } from './types';
export declare function canonicalizeLocale(locale?: string | null): string | undefined;
export declare function normalizeLocaleTag(value?: string | null): string | undefined;
export declare function localeLookupCandidates(canonical: string): string[];
export declare function matchSupportedLocale(value: string | null | undefined, locales: readonly string[]): string | undefined;
export declare function resolveAcceptLanguage(header: string | null | undefined, locales: readonly string[], preferred?: string): string | undefined;
export interface BaseI18nConfig {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: LocalePrefixConfig;
    cookieName?: string;
    headerName?: string;
    loadMessages?: unknown;
}
/** Throws on malformed `localePrefix` maps so misconfiguration fails at boot. */
export declare function validateLocalePrefix(locales: readonly string[], localePrefix?: LocalePrefixConfig): void;
/** Type guard for "is this value one of the configured locales". */
export declare function hasLocale(locales: readonly string[], locale: string | null | undefined): locale is string;
/** Writing direction a locale is rendered in. */
export type LocaleDirection = 'ltr' | 'rtl';
/**
 * Base direction of a locale's script: `'rtl'` for Arabic, Hebrew, Persian,
 * Urdu and the rest, `'ltr'` otherwise.
 *
 * An i18n library that cannot answer this leaves every consumer to hand-roll a
 * locale list — and the list is what breaks, silently, the first time someone
 * adds `fa`. The answer comes from `Intl.Locale`, i.e. from the same CLDR data
 * the formatters in this package already use, so it cannot drift from them.
 *
 * ```tsx
 * const locale = await getLocale();
 * <html lang={locale} dir={getLocaleDirection(locale)}>
 * ```
 *
 * Returns `'ltr'` for a tag `Intl` does not know, which is also what CLDR says
 * about an undetermined language: guessing left-to-right is the direction that
 * degrades readably rather than mirroring an entire layout by accident. A tag
 * `Intl` rejects outright cannot be asked at all, and `'ltr'` is returned
 * rather than throwing — the layout is not the place to fail over a bad tag,
 * and every entry point that validates configuration already reports it.
 */
export declare function getLocaleDirection(locale: string): LocaleDirection;
export declare function validateI18nConfig(options: BaseI18nConfig): void;
export declare function withKebabKey(key: string): string;
export interface BuildKeyCandidatesOptions {
    strictNamespace?: boolean;
}
export declare function buildKeyCandidates(namespace: string | undefined, key: string, options?: BuildKeyCandidatesOptions): string[];
