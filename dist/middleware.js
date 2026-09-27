import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from "./utils.js";
import {
  matchLocalePrefix,
  normalizeLeadingSlashes,
  normalizeLocalePrefix,
  prefixForLocale
} from "./locale-prefix.js";
import {
  localizePath,
  rewriteLocalizedPath,
  validatePathnames,
  validateRouteEnvironment
} from "./route-engine.js";
import { buildAlternateLinksHeader } from "./alternate-links.js";
const REWRITE_SIGNAL_HEADER = "x-next-fluent-rewrite";
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
function resolveCookieConfig(localeCookie, cookieName) {
  if (localeCookie === false) return null;
  const custom = typeof localeCookie === "object" && localeCookie !== null ? localeCookie : {};
  const { name, ...rest } = custom;
  return {
    name: name ?? cookieName,
    options: {
      path: "/",
      maxAge: 31536e3,
      sameSite: "lax",
      ...rest
    }
  };
}
function createI18nMiddleware(options) {
  validateI18nConfig(options);
  validatePathnames(options.locales, options.pathnames);
  validateRouteEnvironment(options.locales, options.domains, options.basePath);
  const {
    locales: allLocales,
    defaultLocale: rawDefaultLocale,
    cookieName = "NEXT_LOCALE",
    headerName = "x-next-locale",
    pathnames,
    domains,
    basePath = "",
    trustedHosts,
    localeDetection = true,
    alternateLinks = true
  } = options;
  const cookieConfig = resolveCookieConfig(options.localeCookie, cookieName);
  const prefixConfig = normalizeLocalePrefix(allLocales, options.localePrefix);
  const localePrefix = prefixConfig.mode;
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
    const requestUrl = (path) => {
      const url = new URL(normalizeLeadingSlashes(path), requestOrigin);
      return url.origin === requestOrigin.origin ? url : new URL("/", requestOrigin);
    };
    const domain = domains?.find((item) => item.domain.toLowerCase() === requestHost);
    const locales = domain ? domain.locales ?? [domain.defaultLocale] : allLocales;
    const defaultLocale = matchSupportedLocale(
      domain?.defaultLocale ?? configuredDefaultLocale,
      locales
    ) ?? configuredDefaultLocale;
    const hasBasePath = Boolean(basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`)));
    const pathname = hasBasePath ? rawPathname.slice(basePath.length) || "/" : rawPathname;
    const withBasePath = (path) => hasBasePath ? `${basePath}${path}` : path;
    const prefixMatch = matchLocalePrefix(pathname, locales, prefixConfig);
    const matchedPrefix = prefixMatch?.locale;
    const pathnameWithoutPrefix = prefixMatch ? prefixMatch.rest : pathname;
    const internalPath = (locale, externalPath) => {
      const direct = rewriteLocalizedPath(externalPath, locale, pathnames);
      if (direct !== externalPath) return direct;
      for (const candidate of allLocales) {
        if (matchSupportedLocale(candidate, [locale])) continue;
        const alt = rewriteLocalizedPath(externalPath, candidate, pathnames);
        if (alt !== externalPath) return alt;
      }
      return externalPath;
    };
    const canonicalPath = (locale, externalPath) => pathnames ? localizePath(externalPath, locale, locale, pathnames, void 0, allLocales).pathname : externalPath;
    const cookieLocale = localeDetection ? matchSupportedLocale(
      request.cookies.get(cookieConfig?.name ?? cookieName)?.value || (cookieName !== "NEXT_LOCALE" ? request.cookies.get("NEXT_LOCALE")?.value : void 0),
      locales
    ) : void 0;
    const headerLocale = localeDetection ? resolveAcceptLanguage(request.headers.get("accept-language"), locales, defaultLocale) : void 0;
    const preferredLocale = cookieLocale || headerLocale || defaultLocale;
    const cookieValue = (effectiveLocale) => {
      if (!cookieConfig) return null;
      const dest = request.headers.get("sec-fetch-dest");
      if (dest && dest !== "document") return null;
      const current = request.cookies.get(cookieConfig.name)?.value;
      if (current === effectiveLocale) return null;
      if (current === void 0 && headerLocale === effectiveLocale) return null;
      return effectiveLocale;
    };
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
        requestHeaders.set(
          REWRITE_SIGNAL_HEADER,
          requestUrl(withBasePath(rewritePath)).pathname
        );
      } else {
        requestHeaders.delete(REWRITE_SIGNAL_HEADER);
      }
      const response = rewritePath ? NextResponse.rewrite(requestUrl(withBasePath(rewritePath)), {
        request: { headers: requestHeaders }
      }) : NextResponse.next({
        request: { headers: requestHeaders }
      });
      response.request ??= { headers: requestHeaders };
      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
        if (alternateLinks && localePrefix !== "never") {
          const header = buildAlternateLinksHeader({
            locales,
            defaultLocale,
            localePrefix: options.localePrefix,
            pathname: pathnameWithoutPrefix,
            pathnames,
            domains,
            basePath: hasBasePath ? basePath : "",
            search,
            origin: requestOrigin.origin
          });
          if (header) response.headers.set("Link", header);
        }
      }
      const cookie = cookieValue(effectiveLocale);
      if (cookie !== null && response.cookies?.set) {
        response.cookies.set(cookieConfig.name, cookie, cookieConfig.options);
      }
      return response;
    };
    const createRedirect = (targetUrl, targetLocale) => {
      const response = NextResponse.redirect(targetUrl);
      if (response.headers?.set) {
        response.headers.set(headerName, targetLocale);
      }
      const cookie = cookieValue(targetLocale);
      if (cookie !== null && response.cookies?.set) {
        response.cookies.set(cookieConfig.name, cookie, cookieConfig.options);
      }
      return response;
    };
    const globalPrefix = matchLocalePrefix(pathname, allLocales, prefixConfig)?.locale;
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
    const isRewriteSignal = matchedPrefix !== void 0 && request.headers.get(REWRITE_SIGNAL_HEADER) === rawPathname;
    if (localePrefix === "never") {
      if (isRewriteSignal) {
        return createSuccessResponse(matchedPrefix);
      }
      if (matchedPrefix) {
        const remainingPath = `${pathnameWithoutPrefix === "/" ? "/" : pathnameWithoutPrefix}${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), matchedPrefix);
      }
      if (!isRewriteSignal) {
        const canonical2 = canonicalPath(preferredLocale, pathname);
        if (canonical2 !== pathname) {
          return createRedirect(
            requestUrl(withBasePath(`${canonical2 === "/" ? "" : canonical2}${search}`)),
            preferredLocale
          );
        }
      }
      const route = internalPath(preferredLocale, pathname);
      const rewritePath = `${prefixForLocale(preferredLocale, prefixConfig)}${route === "/" ? "" : route}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }
    if (localePrefix === "as-needed") {
      if (matchedPrefix === defaultLocale) {
        if (isRewriteSignal) {
          return createSuccessResponse(matchedPrefix);
        }
        const canonical2 = canonicalPath(defaultLocale, pathnameWithoutPrefix);
        const remainingPath = `${canonical2 === "/" ? "/" : canonical2}${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), defaultLocale);
      }
      if (matchedPrefix) {
        if (!isRewriteSignal) {
          const canonical2 = canonicalPath(matchedPrefix, pathnameWithoutPrefix);
          if (canonical2 !== pathnameWithoutPrefix) {
            const prefix = prefixForLocale(matchedPrefix, prefixConfig);
            return createRedirect(
              requestUrl(withBasePath(`${prefix}${canonical2 === "/" ? "" : canonical2}${search}`)),
              matchedPrefix
            );
          }
        }
        const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
        const rewritePath = route === pathnameWithoutPrefix ? void 0 : `${prefixForLocale(matchedPrefix, prefixConfig)}${route === "/" ? "" : route}${search}`;
        return createSuccessResponse(matchedPrefix, rewritePath);
      }
      if (preferredLocale === defaultLocale) {
        if (!isRewriteSignal) {
          const canonical2 = canonicalPath(defaultLocale, pathname);
          if (canonical2 !== pathname) {
            return createRedirect(
              requestUrl(withBasePath(`${canonical2 === "/" ? "" : canonical2}${search}`)),
              defaultLocale
            );
          }
        }
        const route = internalPath(defaultLocale, pathname);
        const rewritePath = `${prefixForLocale(defaultLocale, prefixConfig)}${route === "/" ? "" : route}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      const targetPath2 = `${prefixForLocale(preferredLocale, prefixConfig)}${pathname === "/" ? "" : pathname}${search}`;
      return createRedirect(requestUrl(withBasePath(targetPath2)), preferredLocale);
    }
    if (matchedPrefix) {
      if (!isRewriteSignal) {
        const canonical2 = canonicalPath(matchedPrefix, pathnameWithoutPrefix);
        if (canonical2 !== pathnameWithoutPrefix) {
          const prefix = prefixForLocale(matchedPrefix, prefixConfig);
          return createRedirect(
            requestUrl(withBasePath(`${prefix}${canonical2 === "/" ? "" : canonical2}${search}`)),
            matchedPrefix
          );
        }
      }
      const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
      const rewritePath = route === pathnameWithoutPrefix ? void 0 : `${prefixForLocale(matchedPrefix, prefixConfig)}${route === "/" ? "" : route}${search}`;
      return createSuccessResponse(matchedPrefix, rewritePath);
    }
    const canonical = canonicalPath(preferredLocale, pathname);
    const targetPath = `${prefixForLocale(preferredLocale, prefixConfig)}${canonical === "/" ? "" : canonical}${search}`;
    return createRedirect(requestUrl(withBasePath(targetPath)), preferredLocale);
  };
}
const createMiddleware = createI18nMiddleware;
export {
  createI18nMiddleware,
  createMiddleware
};
