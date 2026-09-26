import type { Pathnames } from './types';
export interface AlternateLinksOptions {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix: 'always' | 'as-needed' | 'never';
    /** Pathname without locale prefix and without basePath (internal form). */
    pathname: string;
    /** Internal route template matched for the current request, when known. */
    internalTemplate?: string;
    pathnames?: Pathnames<any>;
    domains?: readonly {
        domain: string;
        defaultLocale: string;
        locales?: readonly string[];
    }[];
    basePath?: string;
    search?: string;
    origin: string;
}
/**
 * Builds the `Link` response header advertising localized variants of the
 * current route (`rel="alternate"; hreflang="…"`), including `x-default`.
 * Search engines use it to serve the right language in results.
 */
export declare function buildAlternateLinksHeader(options: AlternateLinksOptions): string | undefined;
