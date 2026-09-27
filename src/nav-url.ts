import type { NavigationConfig, Pathnames, UrlObject } from './types';
import { matchSupportedLocale } from './utils';
import { localizePath, rewriteLocalizedPath } from './route-engine';
import { domainLocalePrefix, domainSupportsLocale, findDomain, findLocaleDomain } from './domain-routing';
import {
  localeNeedsPrefix,
  matchLocalePrefix,
  prefixForLocale,
} from './locale-prefix';

/**
 * Pure URL helpers shared by the navigation entry (server- and client-safe)
 * and by client-only components. No React hooks and no framework imports here.
 */

const UNSAFE_HREF_SCHEME = /^(?:javascript|data|vbscript|file):/i;
const WINDOWS_UNC_PREFIX = /^\\\\/;

function hrefDiagnostic(href: string): string {
  if (href.length > 64) return `<oversized href: ${href.length} code units>`;
  // Control characters would let a rejected href rewrite the log line it is
  // reported in, so they are shown escaped.
  // eslint-disable-next-line no-control-regex -- escaping control characters is the point
  return href.replace(/[\u0000-\u001f\u007f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * What a browser sees before it resolves the scheme: ASCII tab, LF and CR are
 * removed anywhere in a URL, and C0 controls and space are stripped at the
 * edges. Testing the raw string lets `java\tscript:` through.
 */
function browserNormalizedHref(href: string): string {
  // eslint-disable-next-line no-control-regex -- tab/LF/CR are precisely what a browser discards
  const withoutDiscarded = href.replace(/[\u0009\u000a\u000d]/g, '');
  // eslint-disable-next-line no-control-regex -- C0 controls and space are stripped at the URL edges
  return withoutDiscarded.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
}

/**
 * Rejects hrefs that can execute script or hijack navigation when they come
 * from untrusted input (`javascript:`, `data:`, `vbscript:`, `file:` and
 * Windows UNC `\\host` forms that browsers normalize to protocol-relative URLs).
 */
export function assertSafeHref(href: string): void {
  const trimmed = browserNormalizedHref(href);
  if (UNSAFE_HREF_SCHEME.test(trimmed) || WINDOWS_UNC_PREFIX.test(trimmed)) {
    throw new Error(`[next-fluent] Unsafe href rejected: "${hrefDiagnostic(href)}"`);
  }
}

export function isExternalUrl(url: string): boolean {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/|\\\\)/.test(url);
}

export function formatUrlObject(urlObj: UrlObject): {
  pathname: string;
  search: string;
  hash: string;
} {
  let pathname = urlObj.pathname ?? '/';
  let embeddedSearch = '';
  let embeddedHash = '';

  const hashIdx = pathname.indexOf('#');
  if (hashIdx !== -1) {
    embeddedHash = pathname.slice(hashIdx);
    pathname = pathname.slice(0, hashIdx);
  }

  const searchIdx = pathname.indexOf('?');
  if (searchIdx !== -1) {
    embeddedSearch = pathname.slice(searchIdx);
    pathname = pathname.slice(0, searchIdx);
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }
  // eslint-disable-next-line no-control-regex -- rejecting C0 controls in a pathname is the point
  if (pathname.startsWith('//') || pathname.includes('\\') || /[\u0000-\u001f]/.test(pathname)) {
    throw new Error('[next-fluent] URL object pathname must be an internal path.');
  }

  const params = new URLSearchParams();
  if (embeddedSearch) {
    const rawEmbedded = embeddedSearch.startsWith('?') ? embeddedSearch.slice(1) : embeddedSearch;
    new URLSearchParams(rawEmbedded).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.search) {
    const rawSearch = urlObj.search.startsWith('?') ? urlObj.search.slice(1) : urlObj.search;
    new URLSearchParams(rawSearch).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.query) {
    if (typeof urlObj.query === 'string') {
      const rawQuery = urlObj.query.startsWith('?') ? urlObj.query.slice(1) : urlObj.query;
      new URLSearchParams(rawQuery).forEach((val, key) => params.append(key, val));
    } else {
      for (const [k, v] of Object.entries(urlObj.query)) {
        if (v !== undefined && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item !== undefined && item !== null) {
                params.append(k, String(item));
              }
            }
          } else {
            params.set(k, String(v));
          }
        }
      }
    }
  }

  const qs = params.toString();
  const search = qs ? `?${qs}` : '';

  let hash = urlObj.hash ?? embeddedHash ?? '';
  if (hash && !hash.startsWith('#')) {
    hash = `#${hash}`;
  }

  return { pathname, search, hash };
}

export function resolveLocalizedPathname(
  options: { href: string | UrlObject; locale?: string; domain?: string; forcePrefix?: boolean },
  config: NavigationConfig
): string {
  const { href, locale: explicitLocale } = options;
  const { locales, defaultLocale, pathnames, domains, basePath = '' } = config;
  const sourceDomain = findDomain(domains, options.domain);
  const fallbackLocale = matchSupportedLocale(sourceDomain?.defaultLocale ?? defaultLocale, locales) ?? defaultLocale;
  const resolvedLocale = matchSupportedLocale(explicitLocale, locales) ?? fallbackLocale;
  const targetDomain = findLocaleDomain(domains, resolvedLocale, options.domain);
  const resolvedDefaultLocale = targetDomain?.defaultLocale ?? defaultLocale;
  const prefixConfig = domainLocalePrefix(locales, config.localePrefix, targetDomain);
  const sourcePrefixConfig = sourceDomain && sourceDomain !== targetDomain
    ? domainLocalePrefix(locales, config.localePrefix, sourceDomain)
    : prefixConfig;
  const localePrefix = prefixConfig.mode;

  let rawPathname = '';
  let search = '';
  let hash = '';
  let objectQuery: Record<string, unknown> | undefined;

  if (typeof href === 'string') {
    assertSafeHref(href);
    if (isExternalUrl(href) || href.startsWith('#')) {
      return href;
    }
    const hashIndex = href.indexOf('#');
    const pathAndSearch = hashIndex !== -1 ? href.slice(0, hashIndex) : href;
    hash = hashIndex !== -1 ? href.slice(hashIndex) : '';

    const searchIndex = pathAndSearch.indexOf('?');
    rawPathname = searchIndex !== -1 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch;
    search = searchIndex !== -1 ? pathAndSearch.slice(searchIndex) : '';
  } else if (href && typeof href === 'object') {
    if (href.href && isExternalUrl(href.href)) {
      assertSafeHref(href.href);
      return href.href;
    }
    const parts = formatUrlObject(href);
    rawPathname = parts.pathname;
    search = parts.search;
    hash = parts.hash;
    objectQuery = href.query && typeof href.query === 'object' ? href.query : undefined;
  } else {
    return '/';
  }

  // Normalize Windows backslashes in route pathname
  rawPathname = rawPathname.replace(/\\+/g, '/');

  // Ensure leading slash
  if (!rawPathname.startsWith('/')) {
    rawPathname = `/${rawPathname}`;
  }
  if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
    rawPathname = rawPathname.slice(basePath.length) || '/';
  }

  // Strip an existing locale prefix (including custom per-locale prefixes).
  let cleanPathname = rawPathname;
  let sourceLocale: string | undefined;
  const prefixMatch = matchLocalePrefix(rawPathname, locales, sourcePrefixConfig);
  if (prefixMatch) {
    sourceLocale = prefixMatch.locale;
    cleanPathname = prefixMatch.rest;
  }

  const hasTrailingSlash =
    rawPathname.length > 1 && rawPathname.endsWith('/') && cleanPathname !== '/';
  const lookupKey =
    cleanPathname.length > 1 && cleanPathname.endsWith('/')
      ? cleanPathname.slice(0, -1)
      : cleanPathname;

  // Localized pathname mapping (e.g. /about -> /about-us for 'en', /o-nas for 'ru')
  const localized = localizePath(
    lookupKey,
    sourceLocale ?? resolvedLocale,
    resolvedLocale,
    pathnames as Pathnames<any> | undefined,
    objectQuery,
    locales
  );
  let mappedPathname = localized.pathname;
  if (localized.consumed.length && search) {
    const params = new URLSearchParams(search.slice(1));
    for (const name of localized.consumed) params.delete(name);
    const remaining = params.toString();
    search = remaining ? `?${remaining}` : '';
  }

  if (hasTrailingSlash && mappedPathname !== '/' && !mappedPathname.endsWith('/')) {
    mappedPathname = `${mappedPathname}/`;
  }

  // `forcePrefix` opts the caller into an explicit prefix for the default
  // locale too. It is ignored in `never` mode: prefixed URLs do not exist
  // there, so emitting one would only be stripped again by the middleware.
  const wantsPrefix =
    localePrefix !== 'never' &&
    (options.forcePrefix === true ||
      localeNeedsPrefix(resolvedLocale, resolvedDefaultLocale, localePrefix));
  const prefix = wantsPrefix ? prefixForLocale(resolvedLocale, prefixConfig) : '';

  const finalPath = prefix
    ? mappedPathname === '/'
      ? prefix
      : `${prefix}${mappedPathname.startsWith('/') ? mappedPathname : `/${mappedPathname}`}`
    : mappedPathname;

  const withBasePath = `${basePath}${finalPath === '/' && basePath ? '' : finalPath}${search}${hash}`;
  if (targetDomain && targetDomain.domain.toLowerCase() !== options.domain?.toLowerCase()) {
    return `https://${targetDomain.domain}${withBasePath}`;
  }
  return withBasePath;
}

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
export function switchLocaleHref(
  target: string,
  explicitLocale: string | undefined,
  config: NavigationConfig
): string {
  const { locales, basePath = '' } = config;
  if (!explicitLocale || target.startsWith('#')) return target;
  const locale = matchSupportedLocale(explicitLocale, locales);
  if (!locale) return target;
  const absolute = isExternalUrl(target);
  const url = new URL(target, 'https://next-fluent.invalid');
  const domain = absolute ? findDomain(config.domains, url.host) : findLocaleDomain(config.domains, locale);
  // Canonical URLs generated for a configured multi-locale domain still need
  // a switch signal. Unrelated external links and single-locale hosts do not.
  if (absolute && (!domain?.locales || domain.locales.length < 2 ||
    !domainSupportsLocale(domain, locale) || !/^https?:$/.test(url.protocol))) return target;
  const prefixConfig = domainLocalePrefix(locales, config.localePrefix, domain);
  const localePrefix = prefixConfig.mode;
  if (localePrefix === 'always') return target;

  const route =
    basePath && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
      ? url.pathname.slice(basePath.length) || '/'
      : url.pathname;

  if (localePrefix === 'as-needed') {
    // A prefixed canonical href (switch to a non-default locale) is already
    // unambiguous — return it as is. Only prefix-less canonical hrefs need the
    // temporary signal URL so that middleware can update the locale cookie.
    if (matchLocalePrefix(route, locales, prefixConfig)) {
      return target;
    }
  }

  const switched = `${basePath}${prefixForLocale(locale, prefixConfig)}${route === '/' ? '' : route}${url.search}${url.hash}`;
  return absolute ? `${url.origin}${switched}` : switched;
}

/**
 * Rewrites a public pathname to its canonical internal form for a locale,
 * falling back to any configured locale's external template. Used by
 * `usePathname` so a provider/URL locale mismatch does not leak external
 * slugs into application code.
 */
export function rewriteToInternalPath(
  pathname: string,
  locale: string,
  locales: readonly string[],
  pathnames?: Pathnames<any>
): string {
  if (!pathnames) return pathname;
  const internal = rewriteLocalizedPath(pathname, locale, pathnames);
  if (internal !== pathname) return internal;
  for (const candidate of locales) {
    if (matchSupportedLocale(candidate, [locale])) continue;
    const alt = rewriteLocalizedPath(pathname, candidate, pathnames);
    if (alt !== pathname) return alt;
  }
  return pathname;
}
