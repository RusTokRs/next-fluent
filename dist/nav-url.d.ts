import type { NavigationConfig, Pathnames, UrlObject } from './types';
/**
 * Rejects hrefs that can execute script or hijack navigation when they come
 * from untrusted input (`javascript:`, `data:`, `vbscript:`, `file:` and
 * Windows UNC `\\host` forms that browsers normalize to protocol-relative URLs).
 */
export declare function assertSafeHref(href: string): void;
export declare function isExternalUrl(url: string): boolean;
export declare function formatUrlObject(urlObj: UrlObject): {
    pathname: string;
    search: string;
    hash: string;
};
export declare function resolveLocalizedPathname(options: {
    href: string | UrlObject;
    locale?: string;
    domain?: string;
}, config: NavigationConfig): string;
/**
 * Builds the href for an explicit locale switch.
 *
 * `resolveLocalizedPathname` already returns the canonical href of the target
 * locale (prefixed for 'always' and for non-default locales in 'as-needed').
 * When that canonical href is prefix-less, the middleware cannot tell an
 * explicit switch from an ordinary visit; in that case a temporary *signal*
 * URL `/{locale}/...` is used, which the middleware canonicalizes with a
 * redirect while persisting the locale cookie.
 */
export declare function switchLocaleHref(target: string, explicitLocale: string | undefined, config: NavigationConfig): string;
/**
 * Rewrites a public pathname to its canonical internal form for a locale,
 * falling back to any configured locale's external template. Used by
 * `usePathname` so a provider/URL locale mismatch does not leak external
 * slugs into application code.
 */
export declare function rewriteToInternalPath(pathname: string, locale: string, locales: readonly string[], pathnames?: Pathnames<any>): string;
