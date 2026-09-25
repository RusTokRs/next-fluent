import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from "./utils.js";
import { rewriteLocalizedPath, validatePathnames, validateRouteEnvironment } from "./route-engine.js";
function hostMatchesTrustedList(requestHost, list) {
  const hostname = requestHost.replace(/:\d+$/, "");
  for (const raw of list) {
    const entry = raw.toLowerCase();
    if (entry === requestHost || entry === hostname) return true;
    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      if (hostname === base || hostname.endsWith(`.${base}`)) return true;
    }
  }
  return false;
}
function createI18nMiddleware(options) {
  validateI18nConfig(options);
  validatePathnames(options.locales, options.pathnames);
  validateRouteEnvironment(options.locales, options.domains, options.basePath);
  const {
    locales: allLocales,
    defaultLocale: rawDefaultLocale,
    localePrefix = "always",
    cookieName = "NEXT_LOCALE",
    headerName = "x-next-locale",
    pathnames,
    domains,
    basePath = "",
    trustedHosts
  } = options;
  const configuredDefaultLocale = matchSupportedLocale(rawDefaultLocale, allLocales) ?? rawDefaultLocale;
  return async function middleware(request) {
    const { NextResponse } = await import("next/server.js").catch(() => import("next/server"));
    const { pathname: rawPathname, search } = request.nextUrl;
    const requestOrigin = new URL(request.url);
    const directHost = request.headers.get("host");
    const forwardedHost = request.headers.get("x-forwarded-host");
    const trustedForwardedHost = forwardedHost && (forwardedHost.toLowerCase() === directHost?.toLowerCase() || domains?.some((item) => item.domain.toLowerCase() === forwardedHost.toLowerCase()) || /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(forwardedHost));
    const rawHost = trustedForwardedHost ? forwardedHost : directHost;
    if (rawHost && /^[^\s/?#@\\]+$/.test(rawHost)) {
      try {
        const parsedHost = new URL(`${requestOrigin.protocol}//${rawHost}`);
        if (parsedHost.host === rawHost.toLowerCase()) requestOrigin.host = parsedHost.host;
      } catch {
      }
    }
    const requestHost = requestOrigin.host.toLowerCase();
    if (trustedHosts && trustedHosts.length > 0 && !hostMatchesTrustedList(requestHost, trustedHosts)) {
      return new NextResponse(null, { status: 421 });
    }
    const requestUrl = (path) => new URL(path, requestOrigin);
    const domain = domains?.find((item) => item.domain.toLowerCase() === requestHost);
    const locales = domain ? domain.locales ?? [domain.defaultLocale] : allLocales;
    const defaultLocale = matchSupportedLocale(
      domain?.defaultLocale ?? configuredDefaultLocale,
      locales
    ) ?? configuredDefaultLocale;
    const hasBasePath = Boolean(basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`)));
    const pathname = hasBasePath ? rawPathname.slice(basePath.length) || "/" : rawPathname;
    const withBasePath = (path) => hasBasePath ? `${basePath}${path}` : path;
    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];
    const matchedPrefix = matchSupportedLocale(firstSegment, locales);
    const pathnameWithoutPrefix = matchedPrefix && firstSegment ? pathname.slice(firstSegment.length + 1) || "/" : pathname;
    const internalPath = (locale, externalPath) => rewriteLocalizedPath(externalPath, locale, pathnames);
    const cookieLocale = matchSupportedLocale(
      request.cookies.get(cookieName)?.value || (cookieName !== "NEXT_LOCALE" ? request.cookies.get("NEXT_LOCALE")?.value : void 0),
      locales
    );
    const headerLocale = resolveAcceptLanguage(
      request.headers.get("accept-language"),
      locales,
      defaultLocale
    );
    const preferredLocale = cookieLocale || headerLocale || defaultLocale;
    const createSuccessResponse = (effectiveLocale, rewritePath) => {
      const requestHeaders = new Headers();
      if (request.headers) {
        if (typeof request.headers.forEach === "function") {
          request.headers.forEach((val, key) => requestHeaders.set(key, val));
        } else if (typeof request.headers.entries === "function") {
          for (const [key, val] of request.headers.entries()) {
            requestHeaders.set(key, val);
          }
        }
      }
      requestHeaders.set(headerName, effectiveLocale);
      if (rewritePath) {
        requestHeaders.set("x-next-fluent-rewrite", requestUrl(withBasePath(rewritePath)).pathname);
      }
      const response = rewritePath ? NextResponse.rewrite(requestUrl(withBasePath(rewritePath)), {
        request: { headers: requestHeaders }
      }) : NextResponse.next({
        request: { headers: requestHeaders }
      });
      response.request ??= { headers: requestHeaders };
      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, effectiveLocale, {
          path: "/",
          maxAge: 31536e3,
          sameSite: "lax"
        });
      }
      return response;
    };
    const createRedirect = (targetUrl, targetLocale) => {
      const response = NextResponse.redirect(targetUrl);
      if (response.headers?.set) {
        response.headers.set(headerName, targetLocale);
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, targetLocale, {
          path: "/",
          maxAge: 31536e3,
          sameSite: "lax"
        });
      }
      return response;
    };
    const globalPrefix = matchSupportedLocale(firstSegment, allLocales);
    if (domain && globalPrefix && !matchSupportedLocale(globalPrefix, locales)) {
      const targetDomain = domains?.find(
        (item) => (item.locales ?? [item.defaultLocale]).some((locale) => matchSupportedLocale(globalPrefix, [locale]))
      );
      if (targetDomain) {
        const targetUrl = new URL(requestOrigin);
        targetUrl.host = targetDomain.domain;
        return createRedirect(targetUrl, globalPrefix);
      }
    }
    if (request.headers.get("x-next-fluent-rewrite") === rawPathname && matchedPrefix) {
      return createSuccessResponse(matchedPrefix);
    }
    if (localePrefix === "never") {
      if (matchedPrefix) {
        const rest = segments.slice(1).join("/");
        const remainingPath = rest ? `/${rest}${search}` : `/${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), matchedPrefix);
      }
      const route = internalPath(preferredLocale, pathname);
      const rewritePath = `/${preferredLocale}${route === "/" ? "" : route}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }
    if (localePrefix === "as-needed") {
      if (matchedPrefix === defaultLocale) {
        const rest = segments.slice(1).join("/");
        const remainingPath = rest ? `/${rest}${search}` : `/${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), defaultLocale);
      }
      if (matchedPrefix) {
        const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
        const rewritePath = route === pathnameWithoutPrefix ? void 0 : `/${matchedPrefix}${route === "/" ? "" : route}${search}`;
        return createSuccessResponse(matchedPrefix, rewritePath);
      }
      if (preferredLocale === defaultLocale) {
        const route = internalPath(defaultLocale, pathname);
        const rewritePath = `/${defaultLocale}${route === "/" ? "" : route}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      const targetPath2 = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
      return createRedirect(requestUrl(withBasePath(targetPath2)), preferredLocale);
    }
    if (matchedPrefix) {
      const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
      const rewritePath = route === pathnameWithoutPrefix ? void 0 : `/${matchedPrefix}${route === "/" ? "" : route}${search}`;
      return createSuccessResponse(matchedPrefix, rewritePath);
    }
    const targetPath = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
    return createRedirect(requestUrl(withBasePath(targetPath)), preferredLocale);
  };
}
const createMiddleware = createI18nMiddleware;
export {
  createI18nMiddleware,
  createMiddleware
};
