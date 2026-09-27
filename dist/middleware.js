import { matchSupportedLocale, resolveAcceptLanguage, validateI18nConfig } from "./utils.js";
import {
  localeNeedsPrefix,
  matchLocalePrefix,
  normalizeLeadingSlashes,
  normalizeLocalePrefix,
  prefixForLocale
} from "./locale-prefix.js";
import {
  findInternalPath,
  localizePath,
  rewriteLocalizedPath,
  validatePathnames,
  validateRouteEnvironment
} from "./route-engine.js";
import { buildAlternateLinksHeader } from "./alternate-links.js";
import { domainLocalePrefix, findLocaleDomain, replaceUrlHost } from "./domain-routing.js";
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
  const globalPrefixConfig = normalizeLocalePrefix(allLocales, options.localePrefix);
  const internalPrefixConfig = normalizeLocalePrefix(allLocales);
  const domainPrefixes = new Map(domains?.map((domain) => [
    domain,
    domainLocalePrefix(allLocales, options.localePrefix, domain)
  ]));
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
        if (parsedHost.host === rawHost.toLowerCase()) replaceUrlHost(requestOrigin, parsedHost.host);
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
    const locales = domain ? allLocales.filter((locale) => matchSupportedLocale(locale, domain.locales ?? [domain.defaultLocale])) : allLocales;
    const prefixConfig = domain && domainPrefixes.get(domain) || globalPrefixConfig;
    const localePrefix = prefixConfig.mode;
    const defaultLocale = matchSupportedLocale(
      domain?.defaultLocale ?? configuredDefaultLocale,
      locales
    ) ?? configuredDefaultLocale;
    const separatedBasePath = Boolean(basePath && request.nextUrl.basePath === basePath);
    const inlineBasePath = !separatedBasePath && Boolean(basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`)));
    const hasBasePath = inlineBasePath || separatedBasePath;
    const pathname = inlineBasePath ? rawPathname.slice(basePath.length) || "/" : rawPathname;
    const withBasePath = (path) => hasBasePath ? `${basePath}${path}` : path;
    const publicPrefixMatch = matchLocalePrefix(pathname, locales, prefixConfig);
    const internalPrefixMatch = matchLocalePrefix(pathname, locales, internalPrefixConfig);
    const prefixMatch = publicPrefixMatch ?? internalPrefixMatch;
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
    let slugLocale;
    if (pathnames && matchedPrefix === void 0) {
      const owners = locales.filter((candidate) => findInternalPath(pathname, candidate, pathnames));
      if (owners.length === 1 && owners[0] !== defaultLocale) slugLocale = owners[0];
    }
    const preferredLocale = cookieLocale || slugLocale || headerLocale || defaultLocale;
    const cookieValue = (effectiveLocale, isRedirect = false) => {
      if (!cookieConfig) return null;
      const dest = request.headers.get("sec-fetch-dest");
      if (!isRedirect && dest && dest !== "document") return null;
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
          requestUrl(rewritePath).pathname
        );
      } else {
        requestHeaders.delete(REWRITE_SIGNAL_HEADER);
      }
      const response = rewritePath ? NextResponse.rewrite(new URL(normalizeLeadingSlashes(withBasePath(rewritePath)), request.url), {
        request: { headers: requestHeaders }
      }) : NextResponse.next({
        request: { headers: requestHeaders }
      });
      response.request ??= { headers: requestHeaders };
      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
        if (alternateLinks) {
          const header = buildAlternateLinksHeader({
            locales: allLocales,
            defaultLocale: configuredDefaultLocale,
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
      const cookie = cookieValue(targetLocale, true);
      if (cookie !== null && response.cookies?.set) {
        response.cookies.set(cookieConfig.name, cookie, cookieConfig.options);
      }
      return response;
    };
    let foreignPrefix = matchLocalePrefix(pathname, allLocales, prefixConfig) ?? matchLocalePrefix(pathname, allLocales, globalPrefixConfig);
    if (domain && !matchedPrefix && !foreignPrefix) {
      for (const [candidate, prefixes] of domainPrefixes) {
        const match = matchLocalePrefix(pathname, allLocales, prefixes);
        if (candidate !== domain && match && !matchSupportedLocale(match.locale, locales)) {
          foreignPrefix = match;
          break;
        }
      }
    }
    if (domain && !matchedPrefix && foreignPrefix && !matchSupportedLocale(foreignPrefix.locale, locales)) {
      const targetLocale = foreignPrefix.locale;
      const targetDomain = findLocaleDomain(domains, targetLocale);
      if (targetDomain) {
        const targetPrefix = domainPrefixes.get(targetDomain);
        const prefix = localeNeedsPrefix(targetLocale, targetDomain.defaultLocale, targetPrefix.mode) ? prefixForLocale(targetLocale, targetPrefix) : "";
        const canonical2 = canonicalPath(targetLocale, foreignPrefix.rest);
        const targetUrl = new URL(requestOrigin);
        replaceUrlHost(targetUrl, targetDomain.domain);
        targetUrl.pathname = withBasePath(`${prefix}${canonical2 === "/" && prefix ? "" : canonical2}`);
        return createRedirect(targetUrl, targetLocale);
      }
    }
    const secFetchDest = request.headers.get("sec-fetch-dest");
    const isDocumentNavigation = secFetchDest === null || secFetchDest === "document";
    const isInternalTarget = (locale, withoutPrefix, canonical2) => internalPrefixMatch?.locale === locale && (canonical2 !== withoutPrefix || prefixForLocale(locale, prefixConfig) !== `/${locale}`) && internalPath(locale, canonical2) === withoutPrefix;
    const isRewriteSignal = matchedPrefix !== void 0 && request.headers.get(REWRITE_SIGNAL_HEADER) === pathname;
    if (localePrefix === "never") {
      if (isRewriteSignal) {
        return createSuccessResponse(matchedPrefix);
      }
      if (matchedPrefix) {
        if (!isDocumentNavigation) {
          const canonical2 = canonicalPath(matchedPrefix, pathnameWithoutPrefix);
          if (isInternalTarget(matchedPrefix, pathnameWithoutPrefix, canonical2)) {
            return createSuccessResponse(matchedPrefix);
          }
        }
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
      const rewritePath = `/${preferredLocale}${route === "/" ? "" : route}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }
    if (localePrefix === "as-needed") {
      if (matchedPrefix === defaultLocale) {
        if (isRewriteSignal) {
          return createSuccessResponse(matchedPrefix);
        }
        const canonical2 = canonicalPath(defaultLocale, pathnameWithoutPrefix);
        if (!isDocumentNavigation && isInternalTarget(defaultLocale, pathnameWithoutPrefix, canonical2)) {
          return createSuccessResponse(defaultLocale);
        }
        const remainingPath = `${canonical2 === "/" ? "/" : canonical2}${search}`;
        return createRedirect(requestUrl(withBasePath(remainingPath)), defaultLocale);
      }
      if (matchedPrefix) {
        if (!isRewriteSignal) {
          const canonical2 = canonicalPath(matchedPrefix, pathnameWithoutPrefix);
          if (!isDocumentNavigation && isInternalTarget(matchedPrefix, pathnameWithoutPrefix, canonical2)) {
            return createSuccessResponse(matchedPrefix);
          }
          if (canonical2 !== pathnameWithoutPrefix || !publicPrefixMatch) {
            const prefix = prefixForLocale(matchedPrefix, prefixConfig);
            return createRedirect(
              requestUrl(withBasePath(`${prefix}${canonical2 === "/" ? "" : canonical2}${search}`)),
              matchedPrefix
            );
          }
        }
        const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
        const internal = `/${matchedPrefix}${route === "/" ? "" : route}`;
        const rewritePath = internal === pathname ? void 0 : `${internal}${search}`;
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
        const rewritePath = `/${defaultLocale}${route === "/" ? "" : route}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      const targetPath2 = `${prefixForLocale(preferredLocale, prefixConfig)}${pathname === "/" ? "" : pathname}${search}`;
      return createRedirect(requestUrl(withBasePath(targetPath2)), preferredLocale);
    }
    if (matchedPrefix) {
      if (!isRewriteSignal) {
        const canonical2 = canonicalPath(matchedPrefix, pathnameWithoutPrefix);
        if (!isDocumentNavigation && isInternalTarget(matchedPrefix, pathnameWithoutPrefix, canonical2)) {
          return createSuccessResponse(matchedPrefix);
        }
        if (canonical2 !== pathnameWithoutPrefix || !publicPrefixMatch) {
          const prefix = prefixForLocale(matchedPrefix, prefixConfig);
          return createRedirect(
            requestUrl(withBasePath(`${prefix}${canonical2 === "/" ? "" : canonical2}${search}`)),
            matchedPrefix
          );
        }
      }
      const route = internalPath(matchedPrefix, pathnameWithoutPrefix);
      const internal = `/${matchedPrefix}${route === "/" ? "" : route}`;
      const rewritePath = internal === pathname ? void 0 : `${internal}${search}`;
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
