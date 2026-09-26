import type { I18nMiddlewareOptions, LocaleCookieConfig } from './types';
import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from './utils';
import { rewriteLocalizedPath, validatePathnames, validateRouteEnvironment } from './route-engine';
import { buildAlternateLinksHeader } from './alternate-links';

/**
 * Internal request header used to recognize the second middleware pass that
 * Next.js performs after `NextResponse.rewrite()`. Only loop-prone strategies
 * consult it, so a client cannot use it to skip canonicalization.
 */
const REWRITE_SIGNAL_HEADER = 'x-next-fluent-rewrite';

function hostMatchesTrustedList(requestHost: string, list: readonly string[]): boolean {
  const hostname = requestHost.replace(/:\d+$/, '');
  for (const raw of list) {
    const entry = raw.toLowerCase();
    if (entry === requestHost || entry === hostname) return true;
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      if (hostname === base || hostname.endsWith(`.${base}`)) return true;
    }
  }
  return false;
}

export interface NextMiddlewareRequestLike {
  url: string;
  nextUrl: {
    pathname: string;
    search: string;
  };
  cookies: {
    get(name: string): { value: string } | undefined;
    set?(name: string, value: string, options?: unknown): void;
  };
  headers: {
    get(name: string): string | null;
    forEach?(callback: (value: string, key: string) => void): void;
    entries?(): IterableIterator<[string, string]>;
  };
}

interface ResolvedCookieConfig {
  name: string;
  options: Record<string, unknown>;
}

function resolveCookieConfig(
  localeCookie: boolean | LocaleCookieConfig | undefined,
  cookieName: string
): ResolvedCookieConfig | null {
  if (localeCookie === false) return null;
  const custom = typeof localeCookie === 'object' && localeCookie !== null ? localeCookie : {};
  const { name, ...rest } = custom;
  return {
    name: name ?? cookieName,
    options: {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
      ...rest,
    },
  };
}

export function createI18nMiddleware(options: I18nMiddlewareOptions) {
  validateI18nConfig(options);
  validatePathnames(options.locales, options.pathnames);
  validateRouteEnvironment(options.locales, options.domains, options.basePath);

  const {
    locales: allLocales,
    defaultLocale: rawDefaultLocale,
    localePrefix = 'always',
    cookieName = 'NEXT_LOCALE',
    headerName = 'x-next-locale',
    pathnames,
    domains,
    basePath = '',
    trustedHosts,
    localeDetection = true,
    alternateLinks = true,
  } = options;

  const cookieConfig = resolveCookieConfig(options.localeCookie, cookieName);

  // Resolve defaultLocale to its exact spelling in `locales` so that string
  // comparisons (e.g. `matchedPrefix === defaultLocale` in as-needed mode)
  // work correctly even when defaultLocale was configured with a different
  // alias (e.g. `en_US` vs `en-US`). validateI18nConfig guarantees a match.
  const configuredDefaultLocale = matchSupportedLocale(rawDefaultLocale, allLocales) ?? rawDefaultLocale;

  return async function middleware(request: NextMiddlewareRequestLike) {
    const { NextResponse } = await import('next/server.js').catch(() => import('next/server'));

    const { pathname: rawPathname, search } = request.nextUrl;
    const requestOrigin = new URL(request.url);
    const directHost = request.headers.get('host');
    const forwardedHost = request.headers.get('x-forwarded-host');
    const trustedForwardedHost = forwardedHost && (
      forwardedHost.toLowerCase() === directHost?.toLowerCase() ||
      domains?.some((item) => item.domain.toLowerCase() === forwardedHost.toLowerCase()) ||
      /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(forwardedHost)
    );
    const rawHost = trustedForwardedHost ? forwardedHost : directHost;
    if (rawHost && /^[^\s/?#@\\]+$/.test(rawHost)) {
      try {
        const parsedHost = new URL(`${requestOrigin.protocol}//${rawHost}`);
        if (parsedHost.host === rawHost.toLowerCase()) requestOrigin.host = parsedHost.host;
      } catch { /* Keep NextRequest's origin for an invalid Host header. */ }
    }
    const requestHost = requestOrigin.host.toLowerCase();
    if (trustedHosts && trustedHosts.length > 0 && !hostMatchesTrustedList(requestHost, trustedHosts)) {
      // Misdirected/foreign Host: never emit redirects that a poisoned cache
      // could replay on the real origin.
      return new NextResponse(null, { status: 421 });
    }
    const requestUrl = (path: string) => new URL(path, requestOrigin);
    const domain = domains?.find((item) => item.domain.toLowerCase() === requestHost);
    const locales = domain ? domain.locales ?? [domain.defaultLocale] : allLocales;
    const defaultLocale = matchSupportedLocale(
      domain?.defaultLocale ?? configuredDefaultLocale,
      locales
    ) ?? configuredDefaultLocale;
    const hasBasePath = Boolean(basePath && (
      rawPathname === basePath || rawPathname.startsWith(`${basePath}/`)
    ));
    const pathname = hasBasePath ? rawPathname.slice(basePath.length) || '/' : rawPathname;
    const withBasePath = (path: string) => hasBasePath ? `${basePath}${path}` : path;
    const segments = pathname.split('/').filter(Boolean);
    const firstSegment = segments[0];
    const matchedPrefix = matchSupportedLocale(firstSegment, locales);
    const pathnameWithoutPrefix = matchedPrefix && firstSegment
      ? pathname.slice(firstSegment.length + 1) || '/'
      : pathname;

    /**
     * Maps a public pathname to its internal route for a locale. Slugs of
     * *other* locales are resolved too, so `/ru/about-us` (the `en` slug) still
     * reaches `app/[locale]/about` instead of 404-ing.
     */
    const internalPath = (locale: string, externalPath: string) => {
      const direct = rewriteLocalizedPath(externalPath, locale, pathnames);
      if (direct !== externalPath) return direct;
      for (const candidate of allLocales) {
        if (matchSupportedLocale(candidate, [locale])) continue;
        const alt = rewriteLocalizedPath(externalPath, candidate, pathnames);
        if (alt !== externalPath) return alt;
      }
      return externalPath;
    };

    const cookieLocale = localeDetection
      ? matchSupportedLocale(
          request.cookies.get(cookieConfig?.name ?? cookieName)?.value ||
            (cookieName !== 'NEXT_LOCALE' ? request.cookies.get('NEXT_LOCALE')?.value : undefined),
          locales
        )
      : undefined;

    const headerLocale = localeDetection
      ? resolveAcceptLanguage(request.headers.get('accept-language'), locales, defaultLocale)
      : undefined;

    const preferredLocale = cookieLocale || headerLocale || defaultLocale;

    /**
     * Writing `Set-Cookie` on every response makes pages uncacheable for
     * browsers and CDNs, so it is limited to document requests where the
     * stored locale would actually change.
     */
    const cookieValue = (effectiveLocale: string): string | null => {
      if (!cookieConfig) return null;
      const dest = request.headers.get('sec-fetch-dest');
      if (dest && dest !== 'document') return null;
      const current = request.cookies.get(cookieConfig.name)?.value;
      if (current === effectiveLocale) return null;
      if (current === undefined && headerLocale === effectiveLocale) return null;
      return effectiveLocale;
    };

    const createSuccessResponse = (effectiveLocale: string, rewritePath?: string) => {
      const requestHeaders = new Headers();
      if (request.headers) {
        if (typeof request.headers.forEach === 'function') {
          request.headers.forEach((val, key) => requestHeaders.set(key, val));
        } else if (typeof request.headers.entries === 'function') {
          for (const [key, val] of request.headers.entries()) {
            requestHeaders.set(key, val);
          }
        }
      }
      requestHeaders.set(headerName, effectiveLocale);
      if (rewritePath) {
        requestHeaders.set(
          REWRITE_SIGNAL_HEADER,
          requestUrl(withBasePath(rewritePath)).pathname
        );
      } else {
        // Never forward a client-supplied signal to the application.
        requestHeaders.delete(REWRITE_SIGNAL_HEADER);
      }

      const response = rewritePath
        ? NextResponse.rewrite(requestUrl(withBasePath(rewritePath)), {
            request: { headers: requestHeaders },
          })
        : NextResponse.next({
            request: { headers: requestHeaders },
          });

      // Expose the forwarded headers to callers that compose this middleware.
      (response as any).request ??= { headers: requestHeaders };

      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
        if (alternateLinks && localePrefix !== 'never') {
          const header = buildAlternateLinksHeader({
            locales,
            defaultLocale,
            localePrefix,
            pathname: pathnameWithoutPrefix,
            pathnames,
            domains,
            basePath: hasBasePath ? basePath : '',
            search,
            origin: requestOrigin.origin,
          });
          if (header) response.headers.set('Link', header);
        }
      }
      const cookie = cookieValue(effectiveLocale);
      if (cookie !== null && response.cookies?.set) {
        response.cookies.set(cookieConfig!.name, cookie, cookieConfig!.options);
      }
      return response;
    };

    const createRedirect = (targetUrl: URL | string, targetLocale: string) => {
      // Next.js re-parses the Location header of middleware responses and
      // requires it to be absolute. Cross-domain targets are built exclusively
      // from the trusted `domains` config; same-host targets derive from the
      // request origin. Host-header injection is mitigated by `trustedHosts`.
      const response = NextResponse.redirect(targetUrl);
      if (response.headers?.set) {
        response.headers.set(headerName, targetLocale);
      }
      const cookie = cookieValue(targetLocale);
      if (cookie !== null && response.cookies?.set) {
        response.cookies.set(cookieConfig!.name, cookie, cookieConfig!.options);
      }
      return response;
    };

    const globalPrefix = matchSupportedLocale(firstSegment, allLocales);
    if (domain && globalPrefix && !matchSupportedLocale(globalPrefix, locales)) {
      const targetDomain = domains?.find((item) =>
        (item.locales ?? [item.defaultLocale]).some((locale) => matchSupportedLocale(globalPrefix, [locale]))
      );
      if (targetDomain) {
        const targetUrl = new URL(requestOrigin);
        targetUrl.host = targetDomain.domain;
        return createRedirect(targetUrl, globalPrefix);
      }
    }

    /**
     * Next.js invokes middleware again for the rewritten internal pathname.
     * Only the strategies that would otherwise canonicalize their own rewrite
     * target (and loop) consult the signal header — everywhere else the second
     * pass is already idempotent, so a spoofed header has no effect.
     */
    const isRewriteSignal =
      matchedPrefix !== undefined &&
      request.headers.get(REWRITE_SIGNAL_HEADER) === rawPathname;

    // Strategy 1: 'never' (no prefixes in URL, internal rewrite to /[locale]/... )
    if (localePrefix === 'never') {
      if (isRewriteSignal) {
        return createSuccessResponse(matchedPrefix!);
      }
      if (matchedPrefix) {
        const rest = segments.slice(1).join('/');
        const remainingPath = rest ? `/${rest}${search}` : `/${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), matchedPrefix);
      }
      const route = internalPath(preferredLocale, pathname);
      const rewritePath = `/${preferredLocale}${route === '/' ? '' : route}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }

    // Strategy 2: 'as-needed' (default locale without prefix rewritten, others with prefix)
    if (localePrefix === 'as-needed') {
      if (matchedPrefix === defaultLocale) {
        // A second pass over our own `/defaultLocale/...` rewrite must not be
        // canonicalized back, otherwise the browser loops forever.
        if (isRewriteSignal) {
          return createSuccessResponse(matchedPrefix);
        }
        // Strip default locale prefix
        const rest = segments.slice(1).join('/');
        const remainingPath = rest ? `/${rest}${search}` : `/${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), defaultLocale);
      }
      if (matchedPrefix) {
        // Non-default locale with prefix
        const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
        const rewritePath = route === pathnameWithoutPrefix
          ? undefined
          : `/${matchedPrefix}${route === '/' ? '' : route}${search}`;
        return createSuccessResponse(matchedPrefix, rewritePath);
      }
      // No prefix in URL:
      if (preferredLocale === defaultLocale) {
        const route = internalPath(defaultLocale, pathname);
        const rewritePath = `/${defaultLocale}${route === '/' ? '' : route}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      // Preferred locale is non-default: redirect to /{preferredLocale}/path
      const targetPath = `/${preferredLocale}${pathname === '/' ? '' : pathname}${search}`;
      return createRedirect(requestUrl(withBasePath(targetPath)), preferredLocale);
    }

    // Strategy 3: 'always' (default: every path requires prefix)
    if (matchedPrefix) {
      const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
      const rewritePath = route === pathnameWithoutPrefix
        ? undefined
        : `/${matchedPrefix}${route === '/' ? '' : route}${search}`;
      return createSuccessResponse(matchedPrefix, rewritePath);
    }

    const targetPath = `/${preferredLocale}${pathname === '/' ? '' : pathname}${search}`;
    return createRedirect(requestUrl(withBasePath(targetPath)), preferredLocale);
  };
}

export const createMiddleware = createI18nMiddleware;
