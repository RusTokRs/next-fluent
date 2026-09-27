import type { LocalePrefixConfig, LocalePrefixMode } from './types';
import { validateLocalePrefix } from './utils';
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
export declare function normalizeLeadingSlashes(path: string): string;
export declare function normalizeLocalePrefix(locales: readonly string[], localePrefix?: LocalePrefixConfig): NormalizedLocalePrefix;
/** The URL prefix a locale is served under (`/ru`, or a configured custom one). */
export declare function prefixForLocale(locale: string, config: NormalizedLocalePrefix): string;
/** Whether a locale carries a prefix in generated URLs at all. */
export declare function localeNeedsPrefix(locale: string, defaultLocale: string, mode: LocalePrefixMode): boolean;
/** Match longest prefixes first and return the locale plus the unprefixed path. */
export declare function matchLocalePrefix(pathname: string, locales: readonly string[], config: NormalizedLocalePrefix): LocalePrefixMatch | null;
