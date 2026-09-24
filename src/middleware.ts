import type { I18nMiddlewareOptions } from './types';
import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from './utils';
import { rewriteLocalizedPath, validatePathnames, validateRouteEnvironment } from './route-engine';

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
  } = options;

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
    const internalPath = (locale: string, externalPath: string) =>
      rewriteLocalizedPath(externalPath, locale, pathnames);

    const cookieLocale = matchSupportedLocale(
      request.cookies.get(cookieName)?.value ||
        (cookieName !== 'NEXT_LOCALE' ? request.cookies.get('NEXT_LOCALE')?.value : undefined),
      locales
    );

    const headerLocale = resolveAcceptLanguage(
      request.headers.get('accept-language'),
      locales
    );

    const preferredLocale = cookieLocale || headerLocale || defaultLocale;

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
        requestHeaders.set('x-next-fluent-rewrite', requestUrl(withBasePath(rewritePath)).pathname);
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
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, effectiveLocale, {
          path: '/',
          maxAge: 31536000,
          sameSite: 'lax',
        });
      }
      return response;
    };

    const createRedirect = (targetUrl: URL | string, targetLocale: string) => {
      const response = NextResponse.redirect(targetUrl);
      if (response.headers?.set) {
        response.headers.set(headerName, targetLocale);
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, targetLocale, {
          path: '/',
          maxAge: 31536000,
          sameSite: 'lax',
        });
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

    // Next.js may invoke middleware again for a rewritten internal pathname.
    // Keep that second pass from canonicalizing /[defaultLocale] back to /.
    if (request.headers.get('x-next-fluent-rewrite') === rawPathname && matchedPrefix) {
      return createSuccessResponse(matchedPrefix);
    }

    // Strategy 1: 'never' (no prefixes in URL, internal rewrite to /[locale]/...)
    if (localePrefix === 'never') {
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
