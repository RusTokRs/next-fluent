import { matchSupportedLocale } from "./utils.js";
import { localizePath, rewriteLocalizedPath } from "./route-engine.js";
import {
  localeNeedsPrefix,
  matchLocalePrefix,
  normalizeLocalePrefix,
  prefixForLocale
} from "./locale-prefix.js";
const UNSAFE_HREF_SCHEME = /^(?:javascript|data|vbscript|file):/i;
const WINDOWS_UNC_PREFIX = /^\\\\/;
function hrefDiagnostic(href) {
  if (href.length > 64) return `<oversized href: ${href.length} code units>`;
  return href.replace(/[\u0000-\u001f\u007f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function browserNormalizedHref(href) {
  const withoutDiscarded = href.replace(/[\u0009\u000a\u000d]/g, "");
  return withoutDiscarded.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}
function assertSafeHref(href) {
  const trimmed = browserNormalizedHref(href);
  if (UNSAFE_HREF_SCHEME.test(trimmed) || WINDOWS_UNC_PREFIX.test(trimmed)) {
    throw new Error(`[next-fluent] Unsafe href rejected: "${hrefDiagnostic(href)}"`);
  }
}
function isExternalUrl(url) {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/|\\\\)/.test(url);
}
function formatUrlObject(urlObj) {
  let pathname = urlObj.pathname ?? "/";
  let embeddedSearch = "";
  let embeddedHash = "";
  const hashIdx = pathname.indexOf("#");
  if (hashIdx !== -1) {
    embeddedHash = pathname.slice(hashIdx);
    pathname = pathname.slice(0, hashIdx);
  }
  const searchIdx = pathname.indexOf("?");
  if (searchIdx !== -1) {
    embeddedSearch = pathname.slice(searchIdx);
    pathname = pathname.slice(0, searchIdx);
  }
  if (!pathname.startsWith("/")) {
    pathname = `/${pathname}`;
  }
  if (pathname.startsWith("//") || pathname.includes("\\") || /[\u0000-\u001f]/.test(pathname)) {
    throw new Error("[next-fluent] URL object pathname must be an internal path.");
  }
  const params = new URLSearchParams();
  if (embeddedSearch) {
    const rawEmbedded = embeddedSearch.startsWith("?") ? embeddedSearch.slice(1) : embeddedSearch;
    new URLSearchParams(rawEmbedded).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.search) {
    const rawSearch = urlObj.search.startsWith("?") ? urlObj.search.slice(1) : urlObj.search;
    new URLSearchParams(rawSearch).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.query) {
    if (typeof urlObj.query === "string") {
      const rawQuery = urlObj.query.startsWith("?") ? urlObj.query.slice(1) : urlObj.query;
      new URLSearchParams(rawQuery).forEach((val, key) => params.append(key, val));
    } else {
      for (const [k, v] of Object.entries(urlObj.query)) {
        if (v !== void 0 && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item !== void 0 && item !== null) {
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
  const search = qs ? `?${qs}` : "";
  let hash = urlObj.hash ?? embeddedHash ?? "";
  if (hash && !hash.startsWith("#")) {
    hash = `#${hash}`;
  }
  return { pathname, search, hash };
}
function resolveLocalizedPathname(options, config) {
  const { href, locale: explicitLocale } = options;
  const { locales, defaultLocale, pathnames, domains, basePath = "" } = config;
  const prefixConfig = normalizeLocalePrefix(locales, config.localePrefix);
  const localePrefix = prefixConfig.mode;
  let rawPathname = "";
  let search = "";
  let hash = "";
  let objectQuery;
  if (typeof href === "string") {
    assertSafeHref(href);
    if (isExternalUrl(href) || href.startsWith("#")) {
      return href;
    }
    const hashIndex = href.indexOf("#");
    const pathAndSearch = hashIndex !== -1 ? href.slice(0, hashIndex) : href;
    hash = hashIndex !== -1 ? href.slice(hashIndex) : "";
    const searchIndex = pathAndSearch.indexOf("?");
    rawPathname = searchIndex !== -1 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch;
    search = searchIndex !== -1 ? pathAndSearch.slice(searchIndex) : "";
  } else if (href && typeof href === "object") {
    if (href.href && isExternalUrl(href.href)) {
      assertSafeHref(href.href);
      return href.href;
    }
    const parts = formatUrlObject(href);
    rawPathname = parts.pathname;
    search = parts.search;
    hash = parts.hash;
    objectQuery = href.query && typeof href.query === "object" ? href.query : void 0;
  } else {
    return "/";
  }
  rawPathname = rawPathname.replace(/\\+/g, "/");
  if (!rawPathname.startsWith("/")) {
    rawPathname = `/${rawPathname}`;
  }
  if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
    rawPathname = rawPathname.slice(basePath.length) || "/";
  }
  let cleanPathname = rawPathname;
  let sourceLocale;
  const prefixMatch = matchLocalePrefix(rawPathname, locales, prefixConfig);
  if (prefixMatch) {
    sourceLocale = prefixMatch.locale;
    cleanPathname = prefixMatch.rest;
  }
  const hasTrailingSlash = rawPathname.length > 1 && rawPathname.endsWith("/") && cleanPathname !== "/";
  const lookupKey = cleanPathname.length > 1 && cleanPathname.endsWith("/") ? cleanPathname.slice(0, -1) : cleanPathname;
  const resolvedDefaultLocale = matchSupportedLocale(defaultLocale, locales) ?? defaultLocale;
  const resolvedLocale = explicitLocale ? matchSupportedLocale(explicitLocale, locales) ?? resolvedDefaultLocale : resolvedDefaultLocale;
  const localized = localizePath(
    lookupKey,
    sourceLocale ?? resolvedLocale,
    resolvedLocale,
    pathnames,
    objectQuery,
    locales
  );
  let mappedPathname = localized.pathname;
  if (localized.consumed.length && search) {
    const params = new URLSearchParams(search.slice(1));
    for (const name of localized.consumed) params.delete(name);
    const remaining = params.toString();
    search = remaining ? `?${remaining}` : "";
  }
  if (hasTrailingSlash && mappedPathname !== "/" && !mappedPathname.endsWith("/")) {
    mappedPathname = `${mappedPathname}/`;
  }
  const prefix = localeNeedsPrefix(resolvedLocale, resolvedDefaultLocale, localePrefix) ? prefixForLocale(resolvedLocale, prefixConfig) : "";
  const finalPath = prefix ? mappedPathname === "/" ? prefix : `${prefix}${mappedPathname.startsWith("/") ? mappedPathname : `/${mappedPathname}`}` : mappedPathname;
  const withBasePath = `${basePath}${finalPath === "/" && basePath ? "" : finalPath}${search}${hash}`;
  const targetDomain = domains?.find((entry) => {
    const supported = entry.locales ?? [entry.defaultLocale];
    return supported.some((locale) => matchSupportedLocale(resolvedLocale, [locale]));
  });
  if (targetDomain && targetDomain.domain.toLowerCase() !== options.domain?.toLowerCase()) {
    return `https://${targetDomain.domain}${withBasePath}`;
  }
  return withBasePath;
}
function switchLocaleHref(target, explicitLocale, config) {
  const { locales, basePath = "" } = config;
  const prefixConfig = normalizeLocalePrefix(locales, config.localePrefix);
  const localePrefix = prefixConfig.mode;
  if (!explicitLocale || isExternalUrl(target) || target.startsWith("#")) {
    return target;
  }
  const locale = matchSupportedLocale(explicitLocale, locales);
  if (!locale) return target;
  if (localePrefix === "always") {
    return target;
  }
  const url = new URL(target, "https://next-fluent.invalid");
  const route = basePath && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) ? url.pathname.slice(basePath.length) || "/" : url.pathname;
  if (localePrefix === "as-needed") {
    if (matchLocalePrefix(route, locales, prefixConfig)) {
      return target;
    }
  }
  return `${basePath}${prefixForLocale(locale, prefixConfig)}${route === "/" ? "" : route}${url.search}${url.hash}`;
}
function rewriteToInternalPath(pathname, locale, locales, pathnames) {
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
export {
  assertSafeHref,
  formatUrlObject,
  isExternalUrl,
  resolveLocalizedPathname,
  rewriteToInternalPath,
  switchLocaleHref
};
