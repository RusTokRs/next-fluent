"use client";
"use client";

// src/navigation.ts
import React2, { forwardRef, useMemo as useMemo2 } from "react";
import NextLink from "next/link.js";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  redirect as nextRedirect,
  permanentRedirect as nextPermanentRedirect
} from "next/navigation.js";

// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
function localeDiagnosticValue(locale) {
  if (typeof locale !== "string") {
    const kind = locale === null ? "null" : typeof locale;
    return `<non-string locale: ${kind}>`;
  }
  if (locale.length > MAX_LOCALE_TAG_LENGTH) {
    return `<oversized locale: ${locale.length} code units>`;
  }
  return locale;
}
function canonicalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return void 0;
  if (locale.length > MAX_LOCALE_TAG_LENGTH) return void 0;
  let raw = locale.trim();
  if (!raw) return void 0;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).trim();
    if (!raw) return void 0;
  }
  const normalized = raw.replaceAll("_", "-");
  try {
    const canonical = Intl.getCanonicalLocales(normalized);
    return canonical[0];
  } catch {
    return void 0;
  }
}
function localeLookupCandidates(canonical) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (candidate && !candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) {
      candidates.push(candidate);
    }
  };
  pushCandidate(canonical);
  try {
    const locale = new Intl.Locale(canonical);
    pushCandidate(locale.baseName);
    const core = [locale.language, locale.script, locale.region].filter((part) => Boolean(part)).join("-");
    pushCandidate(core);
    if (locale.region) {
      pushCandidate([locale.language, locale.script].filter(Boolean).join("-"));
    }
    if (locale.script || locale.region) {
      pushCandidate(locale.language);
    }
  } catch {
  }
  return candidates;
}
function matchSupportedLocale(value, locales) {
  if (!value) return void 0;
  const canonical = canonicalizeLocale(value);
  if (!canonical) return void 0;
  for (const candidate of localeLookupCandidates(canonical)) {
    const normalizedCandidate = candidate.toLowerCase();
    const matched = locales.find((loc) => {
      const locCanonical = canonicalizeLocale(loc);
      return locCanonical?.toLowerCase() === normalizedCandidate;
    });
    if (matched) return matched;
  }
  return void 0;
}
function validateI18nConfig(options) {
  if (!options || !Array.isArray(options.locales) || options.locales.length === 0) {
    throw new Error('[next-fluent] "locales" must be a non-empty array.');
  }
  const canonicalLocales = /* @__PURE__ */ new Set();
  for (const loc of options.locales) {
    const canonical = canonicalizeLocale(loc);
    if (!canonical) {
      throw new Error(
        `[next-fluent] Invalid locale tag in "locales": "${localeDiagnosticValue(loc)}"`
      );
    }
    const identity = canonical.toLowerCase();
    if (canonicalLocales.has(identity)) {
      throw new Error(
        `[next-fluent] Duplicate locale identity in "locales": "${canonical}"`
      );
    }
    canonicalLocales.add(identity);
  }
  const defaultCanonical = canonicalizeLocale(options.defaultLocale);
  if (!defaultCanonical) {
    throw new Error(
      `[next-fluent] Invalid "defaultLocale": "${localeDiagnosticValue(options.defaultLocale)}"`
    );
  }
  if (!canonicalLocales.has(defaultCanonical.toLowerCase())) {
    throw new Error(
      `[next-fluent] "defaultLocale" ("${options.defaultLocale}") must be included in "locales" [${options.locales.join(", ")}].`
    );
  }
}

// src/route-engine.ts
function segments(path) {
  return path.split("/").filter(Boolean);
}
function parameter(segment) {
  let match = /^\[\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]\]$/.exec(segment);
  if (match) return { name: match[1], kind: "optional" };
  match = /^\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  if (match) return { name: match[1], kind: "many" };
  match = /^\[([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  return match ? { name: match[1], kind: "one" } : null;
}
function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
function matchTemplate(template, pathname) {
  const pattern = segments(template);
  const actual = segments(pathname);
  const params = {};
  let index = 0;
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    const variable = parameter(part);
    if (variable?.kind === "many" || variable?.kind === "optional") {
      if (i !== pattern.length - 1) return null;
      const rest = actual.slice(index).map(decode);
      if (variable.kind === "many" && rest.length === 0) return null;
      params[variable.name] = rest;
      index = actual.length;
      break;
    }
    if (index >= actual.length) return null;
    if (variable) params[variable.name] = decode(actual[index]);
    else if (decode(part) !== decode(actual[index])) return null;
    index++;
  }
  return index === actual.length ? params : null;
}
function specificity(template) {
  return segments(template).reduce((score, part) => score + (parameter(part) ? 0 : 10), 0);
}
function externalTemplate(internal, locale, pathnames) {
  const mapped = pathnames?.[internal];
  return typeof mapped === "string" ? mapped : mapped?.[locale] ?? internal;
}
function findInternalPath(pathname, locale, pathnames) {
  if (!pathnames) return null;
  const entries = Object.keys(pathnames).sort((a, b) => specificity(b) - specificity(a));
  for (const internal of entries) {
    const external = externalTemplate(internal, locale, pathnames);
    const params = matchTemplate(external, pathname);
    if (params) return { template: internal, params };
  }
  for (const internal of entries) {
    const params = matchTemplate(internal, pathname);
    if (params) return { template: internal, params };
  }
  return null;
}
function renderTemplate(template, params) {
  const result = [];
  for (const part of segments(template)) {
    const variable = parameter(part);
    if (!variable) {
      result.push(part);
      continue;
    }
    const value = params[variable.name];
    if (value === void 0) {
      if (variable.kind === "optional") continue;
      throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
    }
    if (variable.kind === "one") {
      if (Array.isArray(value)) throw new Error(`[next-fluent] Expected one route parameter: ${variable.name}`);
      result.push(encodeURIComponent(value));
    } else {
      const list = Array.isArray(value) ? value : [value];
      if (variable.kind === "many" && list.length === 0) {
        throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
      }
      result.push(...list.map(encodeURIComponent));
    }
  }
  return `/${result.join("/")}`;
}
function localizePath(pathname, sourceLocale, targetLocale, pathnames, query, locales) {
  const match = findInternalPath(pathname, sourceLocale, pathnames) ?? findInternalPath(pathname, targetLocale, pathnames) ?? locales?.map((locale) => findInternalPath(pathname, locale, pathnames)).find(Boolean);
  if (!match) return { pathname, consumed: [] };
  const params = { ...match.params };
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== void 0 && value !== null) {
      params[name] = Array.isArray(value) ? value.map(String) : String(value);
    }
  }
  const target = externalTemplate(match.template, targetLocale, pathnames);
  return { pathname: renderTemplate(target, params), consumed: Object.keys(match.params).concat(
    segments(target).flatMap((part) => {
      const value = parameter(part);
      return value ? [value.name] : [];
    })
  ) };
}
function rewriteLocalizedPath(pathname, locale, pathnames) {
  const match = findInternalPath(pathname, locale, pathnames);
  if (!match) return pathname;
  const result = renderTemplate(match.template, match.params);
  return pathname.length > 1 && pathname.endsWith("/") && !result.endsWith("/") ? `${result}/` : result;
}
function validatePathnames(locales, pathnames) {
  if (!pathnames) return;
  for (const locale of locales) {
    const seen = /* @__PURE__ */ new Set();
    for (const internal of Object.keys(pathnames)) {
      const external = externalTemplate(internal, locale, pathnames);
      if (!internal.startsWith("/") || !external.startsWith("/") || external.startsWith("//")) {
        throw new Error("[next-fluent] Pathnames must be internal absolute paths.");
      }
      const key = external.toLowerCase();
      if (seen.has(key)) throw new Error(`[next-fluent] Duplicate pathname for ${locale}: ${external}`);
      seen.add(key);
      const internalParams = segments(internal).flatMap((part) => {
        const value = parameter(part);
        return value ? [value.name] : [];
      }).sort();
      const externalParams = segments(external).flatMap((part) => {
        const value = parameter(part);
        return value ? [value.name] : [];
      }).sort();
      if (internalParams.join() !== externalParams.join()) {
        throw new Error(`[next-fluent] Route parameters differ for ${internal} (${locale}).`);
      }
    }
  }
}
function validateRouteEnvironment(locales, domains, basePath) {
  if (basePath !== void 0 && (basePath !== "" && (!basePath.startsWith("/") || basePath.startsWith("//") || basePath.endsWith("/") || /[?#\\]/.test(basePath)))) {
    throw new Error("[next-fluent] basePath must be an absolute path without a trailing slash.");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const entry of domains ?? []) {
    let url;
    try {
      url = new URL(`https://${entry.domain}`);
    } catch {
      throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`);
    }
    if (url.host !== entry.domain || url.pathname !== "/" || !url.hostname) {
      throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`);
    }
    const name = entry.domain.toLowerCase();
    if (seen.has(name)) throw new Error(`[next-fluent] Duplicate domain: ${entry.domain}`);
    seen.add(name);
    const domainLocales = entry.locales ?? [entry.defaultLocale];
    if (!matchSupportedLocale(entry.defaultLocale, domainLocales)) {
      throw new Error(`[next-fluent] Domain defaultLocale must be in its locales: ${entry.domain}`);
    }
    for (const locale of domainLocales) {
      if (!matchSupportedLocale(locale, locales)) {
        throw new Error(`[next-fluent] Unsupported domain locale: ${locale}`);
      }
    }
  }
}

// src/client.ts
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
var FluentContext = createContext({
  locale: "en",
  bundle: null,
  fallbackBundle: null,
  debug: false
});
function useLocale() {
  const context = useContext(FluentContext);
  return context.locale;
}

// src/navigation.ts
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
  const { locales, defaultLocale, localePrefix = "always", pathnames, domains, basePath = "" } = config;
  let rawPathname = "";
  let search = "";
  let hash = "";
  let objectQuery;
  if (typeof href === "string") {
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
  const segments2 = rawPathname.split("/").filter(Boolean);
  let cleanPathname = rawPathname;
  let sourceLocale;
  if (segments2.length > 0) {
    const first = segments2[0];
    sourceLocale = matchSupportedLocale(first, locales);
    if (sourceLocale) {
      const rest = segments2.slice(1).join("/");
      cleanPathname = rest ? `/${rest}` : "/";
    }
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
  let prefix = "";
  if (localePrefix === "never") {
    prefix = "";
  } else if (localePrefix === "as-needed") {
    if (resolvedLocale !== resolvedDefaultLocale) {
      prefix = `/${resolvedLocale}`;
    }
  } else {
    prefix = `/${resolvedLocale}`;
  }
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
function createNavigation(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix
  });
  validatePathnames(config.locales, config.pathnames);
  validateRouteEnvironment(config.locales, config.domains, config.basePath);
  const { locales, defaultLocale, pathnames, basePath = "" } = config;
  const switchLocaleHref = (target, explicitLocale) => {
    if (!explicitLocale || config.localePrefix === "always" || isExternalUrl(target) || target.startsWith("#")) {
      return target;
    }
    const locale = matchSupportedLocale(explicitLocale, locales);
    if (!locale) return target;
    const url = new URL(target, "https://next-fluent.invalid");
    const route = basePath && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) ? url.pathname.slice(basePath.length) || "/" : url.pathname;
    return `${basePath}/${locale}${route === "/" ? "" : route}${url.search}${url.hash}`;
  };
  const getPathname = (options) => {
    return resolveLocalizedPathname(options, config);
  };
  const Link = forwardRef((props, ref) => {
    const { href, locale: propLocale, ...rest } = props;
    let currentLocale;
    try {
      currentLocale = useLocale();
    } catch {
    }
    const targetLocale = propLocale ?? currentLocale ?? defaultLocale;
    const localizedHref = switchLocaleHref(
      getPathname({ href, locale: targetLocale }),
      propLocale
    );
    return React2.createElement(NextLink, {
      ...rest,
      href: localizedHref,
      prefetch: propLocale && config.localePrefix !== "always" ? false : rest.prefetch,
      ref
    });
  });
  Link.displayName = "I18nLink";
  function usePathname() {
    const currentLocale = useLocale();
    let rawPathname = "";
    try {
      rawPathname = useNextPathname() || "";
    } catch {
      return "";
    }
    if (!rawPathname) return rawPathname;
    if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
      rawPathname = rawPathname.slice(basePath.length) || "/";
    }
    const segments2 = rawPathname.split("/").filter(Boolean);
    if (segments2.length === 0) return "/";
    let cleanPathname = rawPathname;
    const first = segments2[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments2.slice(1).join("/");
      cleanPathname = rest ? `/${rest}` : "/";
    }
    const lookupKey = cleanPathname.length > 1 && cleanPathname.endsWith("/") ? cleanPathname.slice(0, -1) : cleanPathname;
    const internal = rewriteLocalizedPath(lookupKey, currentLocale, pathnames);
    return cleanPathname.endsWith("/") && internal !== "/" ? `${internal}/` : internal;
  }
  function useRouter() {
    let router;
    try {
      router = useNextRouter();
    } catch {
      router = {
        push: () => {
        },
        replace: () => {
        },
        prefetch: () => {
        },
        back: () => {
        },
        forward: () => {
        },
        refresh: () => {
        }
      };
    }
    let currentLocale;
    try {
      currentLocale = useLocale();
    } catch {
    }
    return useMemo2(
      () => ({
        ...router,
        push(href, options) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(getPathname({ href, locale: targetLocale }), options?.locale);
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.push(target, routerOptions);
        },
        replace(href, options) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(getPathname({ href, locale: targetLocale }), options?.locale);
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.replace(target, routerOptions);
        },
        prefetch(href, options) {
          if (options?.locale && config.localePrefix !== "always") return;
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = getPathname({ href, locale: targetLocale });
          return router.prefetch(target);
        },
        back() {
          return router.back();
        },
        forward() {
          return router.forward();
        },
        refresh() {
          return router.refresh();
        }
      }),
      [router, currentLocale]
    );
  }
  function redirect(url, options) {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextRedirect(target, options?.type);
  }
  function permanentRedirect(url, options) {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextPermanentRedirect(target, options?.type);
  }
  return {
    Link,
    usePathname,
    useRouter,
    redirect,
    permanentRedirect,
    getPathname
  };
}
export {
  createNavigation,
  formatUrlObject,
  resolveLocalizedPathname
};
