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
  const { locales, defaultLocale, localePrefix = "always", pathnames } = config;
  let rawPathname = "";
  let search = "";
  let hash = "";
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
  } else {
    return "/";
  }
  rawPathname = rawPathname.replace(/\\+/g, "/");
  if (!rawPathname.startsWith("/")) {
    rawPathname = `/${rawPathname}`;
  }
  const segments = rawPathname.split("/").filter(Boolean);
  let cleanPathname = rawPathname;
  if (segments.length > 0) {
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join("/");
      cleanPathname = rest ? `/${rest}` : "/";
    }
  }
  const hasTrailingSlash = rawPathname.length > 1 && rawPathname.endsWith("/") && cleanPathname !== "/";
  const lookupKey = cleanPathname.length > 1 && cleanPathname.endsWith("/") ? cleanPathname.slice(0, -1) : cleanPathname;
  const resolvedLocale = explicitLocale ? matchSupportedLocale(explicitLocale, locales) ?? defaultLocale : defaultLocale;
  let mappedPathname = cleanPathname;
  const pathnamesTarget = pathnames?.[lookupKey] ?? pathnames?.[cleanPathname];
  if (pathnamesTarget) {
    if (typeof pathnamesTarget === "string") {
      mappedPathname = pathnamesTarget;
    } else if (typeof pathnamesTarget === "object") {
      mappedPathname = pathnamesTarget[resolvedLocale] ?? lookupKey;
    }
  }
  if (hasTrailingSlash && mappedPathname !== "/" && !mappedPathname.endsWith("/")) {
    mappedPathname = `${mappedPathname}/`;
  }
  let prefix = "";
  if (localePrefix === "never") {
    prefix = "";
  } else if (localePrefix === "as-needed") {
    if (resolvedLocale !== defaultLocale) {
      prefix = `/${resolvedLocale}`;
    }
  } else {
    prefix = `/${resolvedLocale}`;
  }
  const finalPath = prefix ? mappedPathname === "/" ? prefix : `${prefix}${mappedPathname.startsWith("/") ? mappedPathname : `/${mappedPathname}`}` : mappedPathname;
  return `${finalPath}${search}${hash}`;
}
function createNavigation(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix
  });
  const { locales, defaultLocale, pathnames } = config;
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
    const localizedHref = getPathname({ href, locale: targetLocale });
    return React2.createElement(NextLink, {
      ...rest,
      href: localizedHref,
      ref
    });
  });
  Link.displayName = "I18nLink";
  function usePathname() {
    let rawPathname = "";
    try {
      rawPathname = useNextPathname() || "";
    } catch {
      return "";
    }
    if (!rawPathname) return rawPathname;
    const segments = rawPathname.split("/").filter(Boolean);
    if (segments.length === 0) return "/";
    let cleanPathname = rawPathname;
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join("/");
      cleanPathname = rest ? `/${rest}` : "/";
    }
    const lookupKey = cleanPathname.length > 1 && cleanPathname.endsWith("/") ? cleanPathname.slice(0, -1) : cleanPathname;
    if (pathnames) {
      for (const [canonical, mapping] of Object.entries(pathnames)) {
        if (typeof mapping === "string") {
          if (mapping === cleanPathname || mapping === lookupKey) return canonical;
        } else if (mapping && typeof mapping === "object") {
          for (const localized of Object.values(mapping)) {
            if (localized === cleanPathname || localized === lookupKey) return canonical;
          }
        }
      }
    }
    return cleanPathname;
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
          const target = getPathname({ href, locale: targetLocale });
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.push(target, routerOptions);
        },
        replace(href, options) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = getPathname({ href, locale: targetLocale });
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.replace(target, routerOptions);
        },
        prefetch(href, options) {
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
