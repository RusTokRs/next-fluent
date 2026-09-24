import type { I18nMiddlewareOptions } from './types';
import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from './utils';

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

  const {
    locales,
    defaultLocale: rawDefaultLocale,
    localePrefix = 'always',
    cookieName = 'NEXT_LOCALE',
    headerName = 'x-next-locale',
  } = options;

  // Resolve defaultLocale to its exact spelling in `locales` so that string
  // comparisons (e.g. `matchedPrefix === defaultLocale` in as-needed mode)
  // work correctly even when defaultLocale was configured with a different
  // alias (e.g. `en_US` vs `en-US`). validateI18nConfig guarantees a match.
  const defaultLocale = matchSupportedLocale(rawDefaultLocale, locales) ?? rawDefaultLocale;

  return async function middleware(request: NextMiddlewareRequestLike) {
    let NextResponse: any;

    try {
      const nextServer: any = await import('next/server.js').catch(() => import('next/server'));
      NextResponse = nextServer.NextResponse;
    } catch {
      NextResponse = class MockNextResponse {
        static next(opts?: any) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            request: { headers: reqHeaders },
            cookies: {
              set: (name: string, val: string) => headers.append('Set-Cookie', `${name}=${val}; Path=/`),
            },
          };
        }
        static rewrite(url: URL | string, opts?: any) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            rewriteUrl: String(url),
            request: { headers: reqHeaders },
            cookies: {
              set: (name: string, val: string) => headers.append('Set-Cookie', `${name}=${val}; Path=/`),
            },
          };
        }
        static redirect(url: URL | string) {
          const headers = new Headers();
          headers.set('location', String(url));
          return {
            status: 307,
            headers,
            cookies: {
              set: (name: string, val: string) => headers.append('Set-Cookie', `${name}=${val}; Path=/`),
            },
          };
        }
      };
    }

    const { pathname, search } = request.nextUrl;
    const segments = pathname.split('/').filter(Boolean);
    const firstSegment = segments[0];
    const matchedPrefix = matchSupportedLocale(firstSegment, locales);

    const cookieLocale = matchSupportedLocale(
      request.cookies.get(cookieName)?.value ||
        request.cookies.get('NEXT_LOCALE')?.value ||
        request.cookies.get('rustok-locale')?.value,
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
      // Retain legacy header alias for backwards compatibility
      if (headerName !== 'x-rustok-effective-locale') {
        requestHeaders.set('x-rustok-effective-locale', effectiveLocale);
      }

      const response = rewritePath
        ? NextResponse.rewrite(new URL(rewritePath, request.url), {
            request: { headers: requestHeaders },
          })
        : NextResponse.next({
            request: { headers: requestHeaders },
          });

      if (!response.request) {
        response.request = { headers: requestHeaders };
      }

      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
        if (headerName !== 'x-rustok-effective-locale') {
          response.headers.set('x-rustok-effective-locale', effectiveLocale);
        }
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
        if (headerName !== 'x-rustok-effective-locale') {
          response.headers.set('x-rustok-effective-locale', targetLocale);
        }
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

    // Strategy 1: 'never' (no prefixes in URL, internal rewrite to /[locale]/...)
    if (localePrefix === 'never') {
      if (matchedPrefix) {
        const remainingPath = `/${segments.slice(1).join('/')}${search}`;
        return createRedirect(new URL(remainingPath, request.url), matchedPrefix);
      }
      const rewritePath = `/${preferredLocale}${pathname === '/' ? '' : pathname}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }

    // Strategy 2: 'as-needed' (default locale without prefix rewritten, others with prefix)
    if (localePrefix === 'as-needed') {
      if (matchedPrefix === defaultLocale) {
        // Strip default locale prefix
        const remainingPath = `/${segments.slice(1).join('/')}${search}`;
        return createRedirect(new URL(remainingPath, request.url), defaultLocale);
      }
      if (matchedPrefix) {
        // Non-default locale with prefix
        return createSuccessResponse(matchedPrefix);
      }
      // No prefix in URL:
      if (preferredLocale === defaultLocale) {
        const rewritePath = `/${defaultLocale}${pathname === '/' ? '' : pathname}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      // Preferred locale is non-default: redirect to /{preferredLocale}/path
      const targetPath = `/${preferredLocale}${pathname === '/' ? '' : pathname}${search}`;
      return createRedirect(new URL(targetPath, request.url), preferredLocale);
    }

    // Strategy 3: 'always' (default: every path requires prefix)
    if (matchedPrefix) {
      return createSuccessResponse(matchedPrefix);
    }

    const targetPath = `/${preferredLocale}${pathname === '/' ? '' : pathname}${search}`;
    return createRedirect(new URL(targetPath, request.url), preferredLocale);
  };
}

export const createMiddleware = createI18nMiddleware;
