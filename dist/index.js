// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
var HTTP_QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
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
  const raw = locale.trim();
  if (!raw) return void 0;
  const normalized = raw.replaceAll("_", "-");
  try {
    const canonical = Intl.getCanonicalLocales(normalized);
    return canonical[0];
  } catch {
    return void 0;
  }
}
function normalizeLocaleTag(value) {
  return canonicalizeLocale(value);
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
function parseAcceptLanguageEntry(entry) {
  const trimmed = entry.trim();
  if (!trimmed) return void 0;
  const firstSeparator = trimmed.indexOf(";");
  const tag = (firstSeparator === -1 ? trimmed : trimmed.slice(0, firstSeparator)).trim();
  if (!tag) return void 0;
  let quality = 1;
  let paramStart = firstSeparator === -1 ? trimmed.length : firstSeparator + 1;
  while (paramStart < trimmed.length) {
    const nextSeparator = trimmed.indexOf(";", paramStart);
    const paramEnd = nextSeparator === -1 ? trimmed.length : nextSeparator;
    const param = trimmed.slice(paramStart, paramEnd).trim();
    const qParam = param.match(/^q\s*=\s*(.*)$/i);
    if (qParam) {
      const rawQuality = qParam[1].trim();
      if (!HTTP_QVALUE.test(rawQuality)) return void 0;
      quality = Number(rawQuality);
      break;
    }
    if (nextSeparator === -1) break;
    paramStart = nextSeparator + 1;
  }
  if (quality <= 0) return void 0;
  return { tag, quality };
}
function resolveAcceptLanguage(header, locales) {
  if (!header) return void 0;
  let bestLocale;
  let bestQuality = Number.NEGATIVE_INFINITY;
  let entryStart = 0;
  while (entryStart <= header.length) {
    const separator = header.indexOf(",", entryStart);
    const entryEnd = separator === -1 ? header.length : separator;
    const candidate = parseAcceptLanguageEntry(header.slice(entryStart, entryEnd));
    if (candidate && candidate.quality > bestQuality) {
      const matched = candidate.tag === "*" ? locales[0] : matchSupportedLocale(candidate.tag, locales);
      if (matched) {
        bestLocale = matched;
        bestQuality = candidate.quality;
      }
    }
    if (separator === -1) break;
    entryStart = separator + 1;
  }
  return bestLocale;
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
function withKebabKey(key) {
  return key.replaceAll(".", "-");
}
function buildKeyCandidates(namespace, key) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };
  const cleanNs = namespace?.trim();
  if (cleanNs) {
    const joined = `${cleanNs}.${key}`;
    pushCandidate(withKebabKey(joined));
    pushCandidate(joined);
    const nsHyphen = withKebabKey(cleanNs);
    if (nsHyphen !== cleanNs) {
      pushCandidate(`${nsHyphen}-${key}`);
    }
  }
  pushCandidate(withKebabKey(key));
  pushCandidate(key);
  return candidates;
}

// src/middleware.ts
function createI18nMiddleware(options) {
  validateI18nConfig(options);
  const {
    locales,
    defaultLocale: rawDefaultLocale,
    localePrefix = "always",
    cookieName = "rustok-locale",
    headerName = "x-rustok-effective-locale"
  } = options;
  const defaultLocale = matchSupportedLocale(rawDefaultLocale, locales) ?? rawDefaultLocale;
  return async function middleware(request) {
    let NextResponse;
    try {
      const nextServer = await import("next/server");
      NextResponse = nextServer.NextResponse;
    } catch {
      NextResponse = class MockNextResponse {
        static next(opts) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            request: { headers: reqHeaders },
            cookies: {
              set: (name, val) => headers.append("Set-Cookie", `${name}=${val}; Path=/`)
            }
          };
        }
        static redirect(url) {
          const headers = new Headers();
          headers.set("location", String(url));
          return {
            status: 307,
            headers,
            cookies: {
              set: (name, val) => headers.append("Set-Cookie", `${name}=${val}; Path=/`)
            }
          };
        }
      };
    }
    const { pathname, search } = request.nextUrl;
    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];
    const matchedPrefix = matchSupportedLocale(firstSegment, locales);
    const cookieLocale = matchSupportedLocale(
      request.cookies.get(cookieName)?.value || request.cookies.get("rustok-admin-locale")?.value || request.cookies.get("rustok-frontend-locale")?.value || request.cookies.get("NEXT_LOCALE")?.value,
      locales
    );
    const headerLocale = resolveAcceptLanguage(
      request.headers.get("accept-language"),
      locales
    );
    const preferredLocale = cookieLocale || headerLocale || defaultLocale;
    const createSuccessResponse = (effectiveLocale) => {
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
      const response = NextResponse.next({
        request: {
          headers: requestHeaders
        }
      });
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
    if (localePrefix === "never") {
      if (matchedPrefix) {
        const remainingPath = `/${segments.slice(1).join("/")}${search}`;
        return createRedirect(new URL(remainingPath, request.url), matchedPrefix);
      }
      return createSuccessResponse(preferredLocale);
    }
    if (localePrefix === "as-needed") {
      if (matchedPrefix === defaultLocale) {
        const remainingPath = `/${segments.slice(1).join("/")}${search}`;
        return createRedirect(new URL(remainingPath, request.url), defaultLocale);
      }
      if (matchedPrefix) {
        return createSuccessResponse(matchedPrefix);
      }
      if (preferredLocale === defaultLocale) {
        return createSuccessResponse(defaultLocale);
      }
      const targetPath2 = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
      return createRedirect(new URL(targetPath2, request.url), preferredLocale);
    }
    if (matchedPrefix) {
      return createSuccessResponse(matchedPrefix);
    }
    const targetPath = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
    return createRedirect(new URL(targetPath, request.url), preferredLocale);
  };
}
var createMiddleware = createI18nMiddleware;

// src/formatter.ts
var MAX_CACHE_SIZE = 200;
function createBoundedCache() {
  const map = /* @__PURE__ */ new Map();
  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      if (!map.has(key) && map.size >= MAX_CACHE_SIZE) {
        const firstKey = map.keys().next().value;
        if (firstKey !== void 0) {
          map.delete(firstKey);
        }
      }
      map.set(key, value);
    },
    clear() {
      map.clear();
    }
  };
}
var dtfCache = createBoundedCache();
var nfCache = createBoundedCache();
var rtfCache = createBoundedCache();
var lfCache = createBoundedCache();
function clearFormatterCache() {
  dtfCache.clear();
  nfCache.clear();
  rtfCache.clear();
  lfCache.clear();
}
function createFormatter(optionsOrLocale) {
  const options = typeof optionsOrLocale === "string" ? { locale: optionsOrLocale } : optionsOrLocale;
  const rawLocale = options.locale || "en";
  const locale = canonicalizeLocale(rawLocale) || rawLocale;
  const timeZone = options.timeZone;
  return {
    locale,
    timeZone,
    dateTime(value, dtfOptions) {
      const date = value instanceof Date ? value : new Date(typeof value === "number" || typeof value === "string" ? value : NaN);
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      const mergedOptions = {
        ...timeZone && !dtfOptions?.timeZone ? { timeZone } : {},
        ...dtfOptions
      };
      const cacheKey = `${locale}::${JSON.stringify(mergedOptions)}`;
      let formatter = dtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.DateTimeFormat(locale, mergedOptions);
          dtfCache.set(cacheKey, formatter);
        } catch {
          return date.toISOString();
        }
      }
      try {
        return formatter.format(date);
      } catch {
        return date.toISOString();
      }
    },
    number(value, nfOptions) {
      const cacheKey = `${locale}::${JSON.stringify(nfOptions ?? {})}`;
      let formatter = nfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.NumberFormat(locale, nfOptions);
          nfCache.set(cacheKey, formatter);
        } catch {
          return String(value);
        }
      }
      try {
        return formatter.format(value);
      } catch {
        return String(value);
      }
    },
    relativeTime(value, unit, rtfOptions) {
      const cacheKey = `${locale}::${JSON.stringify(rtfOptions ?? {})}`;
      let formatter = rtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.RelativeTimeFormat(locale, rtfOptions);
          rtfCache.set(cacheKey, formatter);
        } catch {
          return `${value} ${unit}`;
        }
      }
      try {
        return formatter.format(value, unit);
      } catch {
        return `${value} ${unit}`;
      }
    },
    list(value, lfOptions) {
      if (!value || typeof value[Symbol.iterator] !== "function") {
        return String(value ?? "");
      }
      const cacheKey = `${locale}::${JSON.stringify(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(value).join(", ");
        }
      }
      try {
        return formatter.format(value);
      } catch {
        return Array.from(value).join(", ");
      }
    }
  };
}

// src/navigation.ts
import React3, { forwardRef, useMemo as useMemo2 } from "react";

// src/client.ts
import React2, { createContext, useContext, useEffect, useMemo, useState } from "react";

// src/rich.ts
import React from "react";
function parseRichText(text, values) {
  if (!values || !text.includes("<")) {
    return text;
  }
  const hasInteractiveTags = Object.keys(values).some(
    (k) => typeof values[k] === "function" || React.isValidElement(values[k])
  );
  if (!hasInteractiveTags) {
    return text;
  }
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)\s*\/?>/g;
  const root = { children: [] };
  const stack = [root];
  let lastIndex = 0;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const [fullMatch, tagName] = match;
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      const textChunk = text.slice(lastIndex, matchIndex);
      stack[stack.length - 1].children.push(textChunk);
    }
    lastIndex = tagRegex.lastIndex;
    const isClose = fullMatch.startsWith("</");
    const isSelfClosing = fullMatch.endsWith("/>");
    if (isSelfClosing) {
      if (Object.hasOwn(values, tagName)) {
        const renderFnOrEl = values[tagName];
        if (typeof renderFnOrEl === "function") {
          stack[stack.length - 1].children.push(renderFnOrEl(null));
        } else if (React.isValidElement(renderFnOrEl)) {
          stack[stack.length - 1].children.push(renderFnOrEl);
        } else {
          stack[stack.length - 1].children.push(fullMatch);
        }
      } else {
        stack[stack.length - 1].children.push(fullMatch);
      }
    } else if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tagName) {
        const finishedNode = stack.pop();
        const renderFnOrEl = Object.hasOwn(values, tagName) ? values[tagName] : void 0;
        const innerChildren = finishedNode.children.length === 1 ? finishedNode.children[0] : React.createElement(React.Fragment, null, ...finishedNode.children);
        if (typeof renderFnOrEl === "function") {
          stack[stack.length - 1].children.push(renderFnOrEl(innerChildren));
        } else if (React.isValidElement(renderFnOrEl)) {
          stack[stack.length - 1].children.push(
            React.cloneElement(renderFnOrEl, void 0, innerChildren)
          );
        } else {
          stack[stack.length - 1].children.push(
            `<${tagName}>`,
            innerChildren,
            `</${tagName}>`
          );
        }
      } else {
        stack[stack.length - 1].children.push(fullMatch);
      }
    } else {
      if (Object.hasOwn(values, tagName)) {
        stack.push({ tag: tagName, children: [] });
      } else {
        stack[stack.length - 1].children.push(fullMatch);
      }
    }
  }
  if (lastIndex < text.length) {
    stack[stack.length - 1].children.push(text.slice(lastIndex));
  }
  while (stack.length > 1) {
    const unclosed = stack.pop();
    stack[stack.length - 1].children.push(
      `<${unclosed.tag}>`,
      ...unclosed.children
    );
  }
  if (root.children.length === 0) return "";
  if (root.children.length === 1) return root.children[0];
  return React.createElement(React.Fragment, null, ...root.children);
}

// src/cache.ts
import { FluentBundle, FluentResource } from "@fluent/bundle";

// src/functions.ts
function unwrapFluentValue(val) {
  if (val && typeof val === "object" && typeof val.valueOf === "function") {
    return val.valueOf();
  }
  return val;
}
function createDefaultFunctions(locale) {
  return {
    CURRENCY: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? "");
      }
      const currency = String(unwrapFluentValue(named.currency) || "USD");
      const currencyDisplay = named.currencyDisplay ? String(unwrapFluentValue(named.currencyDisplay)) : void 0;
      const minFraction = named.minimumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.minimumFractionDigits)) : void 0;
      const maxFraction = named.maximumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.maximumFractionDigits)) : void 0;
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          currencyDisplay,
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction
        }).format(num);
      } catch {
        return `${num} ${currency}`;
      }
    },
    PERCENT: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? "");
      }
      const minFraction = named.minimumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.minimumFractionDigits)) : void 0;
      const maxFraction = named.maximumFractionDigits !== void 0 ? Number(unwrapFluentValue(named.maximumFractionDigits)) : void 0;
      try {
        return new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction
        }).format(num);
      } catch {
        return `${num * 100}%`;
      }
    }
  };
}

// src/cache.ts
var MAX_RESOURCE_CACHE = 1e3;
var MAX_BUNDLE_CACHE = 500;
function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = hash * prime & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
function computeSourceHash(source) {
  if (typeof source === "string") {
    return `${source.length}:${fnv1a64(source)}`;
  }
  const joined = source.join("\0");
  return `${source.length}:${joined.length}:${fnv1a64(joined)}`;
}
var resourceCache = /* @__PURE__ */ new Map();
var bundleCache = /* @__PURE__ */ new Map();
function getOrCreateResource(source) {
  const hash = `${source.length}:${fnv1a64(source)}`;
  let res = resourceCache.get(hash);
  if (!res) {
    if (resourceCache.size >= MAX_RESOURCE_CACHE) {
      const keys = Array.from(resourceCache.keys()).slice(0, Math.floor(MAX_RESOURCE_CACHE * 0.2));
      for (const k of keys) resourceCache.delete(k);
    }
    res = new FluentResource(source);
    resourceCache.set(hash, res);
  }
  return res;
}
function getCachedFluentBundle(locale, ftlSource, options = {}) {
  const useIsolating = options.useIsolating ?? true;
  const hasCustomFunctions = options.functions && Object.keys(options.functions).length > 0;
  const sourceHash = computeSourceHash(ftlSource);
  const cacheKey = `${locale}:iso=${useIsolating}:${sourceHash}`;
  if (!hasCustomFunctions && !options.disableCache) {
    const cached = bundleCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const defaultFunctions = createDefaultFunctions(locale);
  const bundle = new FluentBundle(locale, {
    useIsolating,
    functions: {
      ...defaultFunctions,
      ...options.functions
    }
  });
  const sources = Array.isArray(ftlSource) ? ftlSource : [ftlSource];
  for (const src of sources) {
    if (!src || typeof src !== "string") continue;
    const resource = options.disableCache ? new FluentResource(src) : getOrCreateResource(src);
    const errors = bundle.addResource(resource, { allowOverrides: true });
    if (errors && errors.length > 0) {
      console.warn(`[next-fluent] Warnings adding FTL resource for locale ${locale}:`, errors);
    }
  }
  if (!hasCustomFunctions && !options.disableCache) {
    if (bundleCache.size >= MAX_BUNDLE_CACHE) {
      const keys = Array.from(bundleCache.keys()).slice(0, Math.floor(MAX_BUNDLE_CACHE * 0.2));
      for (const k of keys) bundleCache.delete(k);
    }
    bundleCache.set(cacheKey, bundle);
  }
  return bundle;
}
function clearBundleCache() {
  resourceCache.clear();
  bundleCache.clear();
}
function getBundleCacheStats() {
  return {
    resourceCount: resourceCache.size,
    bundleCount: bundleCache.size
  };
}

// src/bundle.ts
function fluentBundleLocaleDiagnostic(locale) {
  if (typeof locale !== "string") {
    const kind = locale === null ? "null" : typeof locale;
    return `<non-string locale: ${kind}>`;
  }
  if (locale.length > 64) {
    return `<oversized locale: ${locale.length} code units>`;
  }
  return locale;
}
function createFluentBundle(locale, ftlSource, options = {}) {
  const canonicalLocale = canonicalizeLocale(locale);
  if (!canonicalLocale) {
    throw new Error(
      `[next-fluent] Invalid Fluent bundle locale: "${fluentBundleLocaleDiagnostic(locale)}"`
    );
  }
  return getCachedFluentBundle(canonicalLocale, ftlSource, options);
}
var FORMAT_ERROR = /* @__PURE__ */ Symbol("format-error");
function createTranslator(bundle, namespaceOrFallbackOrOpts, maybeNamespace) {
  const allBundles = [];
  if (bundle) allBundles.push(bundle);
  let namespace;
  let debug = false;
  let defaultTranslationValues;
  if (typeof namespaceOrFallbackOrOpts === "string") {
    namespace = namespaceOrFallbackOrOpts;
  } else if (namespaceOrFallbackOrOpts && typeof namespaceOrFallbackOrOpts === "object") {
    if ("locales" in namespaceOrFallbackOrOpts) {
      const fb = namespaceOrFallbackOrOpts;
      if (!allBundles.includes(fb)) allBundles.push(fb);
      namespace = maybeNamespace;
    } else {
      const opts = namespaceOrFallbackOrOpts;
      if (opts.fallbackBundle && !allBundles.includes(opts.fallbackBundle)) {
        allBundles.push(opts.fallbackBundle);
      }
      if (opts.fallbackBundles) {
        const list = Array.isArray(opts.fallbackBundles) ? opts.fallbackBundles : [opts.fallbackBundles];
        for (const fb of list) {
          if (fb && !allBundles.includes(fb)) allBundles.push(fb);
        }
      }
      namespace = opts.namespace ?? maybeNamespace;
      debug = opts.debug ?? false;
      defaultTranslationValues = opts.defaultTranslationValues;
    }
  } else {
    namespace = maybeNamespace;
  }
  const defaultFluentArgs = {};
  if (defaultTranslationValues) {
    for (const [k, v] of Object.entries(defaultTranslationValues)) {
      if (typeof v === "string" || typeof v === "number" || v instanceof Date || typeof v === "object" && v !== null && "type" in v) {
        defaultFluentArgs[k] = v;
      }
    }
  }
  const formatCandidate = (targetBundle, candidate, args) => {
    const msg = targetBundle.getMessage(candidate);
    if (msg?.value) {
      const errors = [];
      const formatted = targetBundle.formatPattern(msg.value, args, errors);
      if (errors.length > 0) {
        console.warn(`[next-fluent] Format errors for key "${candidate}":`, errors);
        return FORMAT_ERROR;
      }
      return formatted;
    }
    return null;
  };
  const tFn = (key, args) => {
    const mergedArgs = defaultTranslationValues && Object.keys(defaultFluentArgs).length > 0 ? { ...defaultFluentArgs, ...args } : args;
    const candidates = buildKeyCandidates(namespace, key);
    const fallbackKey = namespace ? `${namespace}.${key}` : key;
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const formatted = formatCandidate(b, candidate, mergedArgs);
        if (formatted === FORMAT_ERROR) return fallbackKey;
        if (formatted !== null) return formatted;
      }
    }
    if (debug) {
      console.warn(`[next-fluent] Missing translation for key "${fallbackKey}"`);
      return `[MISSING: ${fallbackKey}]`;
    }
    return fallbackKey;
  };
  const getRawValue = (targetBundle, candidate) => {
    const msg = targetBundle.getMessage(candidate);
    if (!msg) return null;
    if (msg.attributes && Object.keys(msg.attributes).length > 0) {
      const sortedAttrKeys = Object.keys(msg.attributes).sort((a, b) => {
        const numA = Number.parseInt(a.replace(/\D+/g, ""), 10);
        const numB = Number.parseInt(b.replace(/\D+/g, ""), 10);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });
      const values = [];
      for (const attrKey of sortedAttrKeys) {
        const pattern = msg.attributes[attrKey];
        const errors = [];
        const formatted = targetBundle.formatPattern(pattern, void 0, errors);
        if (errors.length > 0) {
          console.warn(
            `[next-fluent] Format errors for raw attribute "${candidate}.${attrKey}":`,
            errors
          );
          return FORMAT_ERROR;
        }
        values.push(formatted);
      }
      return values;
    }
    if (msg.value) {
      const errors = [];
      const rawText = targetBundle.formatPattern(msg.value, void 0, errors);
      if (errors.length > 0) {
        console.warn(`[next-fluent] Format errors for raw key "${candidate}":`, errors);
        return FORMAT_ERROR;
      }
      const trimmed = rawText.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map(String);
          }
        } catch {
        }
      }
      return rawText;
    }
    return null;
  };
  tFn.raw = (key) => {
    const candidates = buildKeyCandidates(namespace, key);
    const fallbackKey = namespace ? `${namespace}.${key}` : key;
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const res = getRawValue(b, candidate);
        if (res === FORMAT_ERROR) return fallbackKey;
        if (res !== null) return res;
      }
    }
    if (debug) {
      console.warn(`[next-fluent] Missing raw translation for key "${fallbackKey}"`);
      return `[MISSING: ${fallbackKey}]`;
    }
    return fallbackKey;
  };
  tFn.rich = (key, values) => {
    const mergedValues = defaultTranslationValues || values ? { ...defaultTranslationValues ?? {}, ...values ?? {} } : void 0;
    const fluentArgs = {};
    if (mergedValues) {
      for (const [k, v] of Object.entries(mergedValues)) {
        if (typeof v === "string" || typeof v === "number" || v instanceof Date || typeof v === "object" && v !== null && "type" in v) {
          fluentArgs[k] = v;
        }
      }
    }
    const formattedText = tFn(key, fluentArgs);
    return parseRichText(formattedText, mergedValues);
  };
  tFn.has = (key) => {
    const candidates = buildKeyCandidates(namespace, key);
    for (const candidate of candidates) {
      for (const b of allBundles) {
        if (b.hasMessage(candidate)) return true;
      }
    }
    return false;
  };
  return tFn;
}

// src/client.ts
var FluentContext = createContext({
  locale: "en",
  bundle: null,
  fallbackBundle: null,
  debug: false
});
function FluentProvider({
  locale,
  messages,
  fallbackLocale,
  fallbackMessages,
  fallbackBundles,
  timeZone,
  defaultTranslationValues,
  debug,
  children
}) {
  const messagesKey = typeof messages === "string" ? messages : Array.isArray(messages) ? messages.join("\0") : null;
  const fallbackMessagesKey = typeof fallbackMessages === "string" ? fallbackMessages : Array.isArray(fallbackMessages) ? fallbackMessages.join("\0") : null;
  const bundle = useMemo(() => {
    if (!messages) return null;
    if (typeof messages === "string" || Array.isArray(messages)) {
      return createFluentBundle(locale, messages);
    }
    return messages;
  }, [locale, messagesKey ?? messages]);
  const fallbackBundle = useMemo(() => {
    if (!fallbackMessages) return null;
    const fLocale = fallbackLocale || "en";
    if (typeof fallbackMessages === "string" || Array.isArray(fallbackMessages)) {
      return createFluentBundle(fLocale, fallbackMessages);
    }
    return fallbackMessages;
  }, [fallbackLocale, fallbackMessagesKey ?? fallbackMessages]);
  const resolvedFallbackBundles = useMemo(() => {
    if (fallbackBundles) {
      return Array.isArray(fallbackBundles) ? fallbackBundles : [fallbackBundles];
    }
    if (fallbackBundle) {
      return [fallbackBundle];
    }
    return void 0;
  }, [fallbackBundles, fallbackBundle]);
  const value = useMemo(
    () => ({
      locale,
      bundle,
      fallbackLocale,
      fallbackBundle,
      fallbackBundles: resolvedFallbackBundles,
      timeZone,
      defaultTranslationValues,
      debug
    }),
    [
      locale,
      bundle,
      fallbackLocale,
      fallbackBundle,
      resolvedFallbackBundles,
      timeZone,
      defaultTranslationValues,
      debug
    ]
  );
  return React2.createElement(FluentContext.Provider, { value }, children);
}
function useLocale() {
  const context = useContext(FluentContext);
  return context.locale;
}
function useTimeZone() {
  const context = useContext(FluentContext);
  if (context.timeZone) {
    return context.timeZone;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function useFormatter() {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useMemo(() => createFormatter({ locale, timeZone }), [locale, timeZone]);
}
function useNow(options) {
  const [now, setNow] = useState(() => /* @__PURE__ */ new Date());
  const interval = options?.updateInterval;
  useEffect(() => {
    if (!interval || interval <= 0) return;
    const timer = setInterval(() => setNow(/* @__PURE__ */ new Date()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
function useTranslations(namespace) {
  const context = useContext(FluentContext);
  return useMemo(
    () => createTranslator(context.bundle, {
      fallbackBundles: context.fallbackBundles ?? (context.fallbackBundle ? [context.fallbackBundle] : null),
      namespace,
      debug: context.debug,
      defaultTranslationValues: context.defaultTranslationValues
    }),
    [
      context.bundle,
      context.fallbackBundle,
      context.fallbackBundles,
      namespace,
      context.debug,
      context.defaultTranslationValues
    ]
  );
}
function FormattedMessage({
  id,
  args,
  values,
  fallback,
  className,
  as: Component
}) {
  const t = useTranslations();
  if (!t.has(id)) {
    if (fallback !== void 0) return fallback;
  }
  const combinedValues = {
    ...args,
    ...values
  };
  const content = t.rich(id, combinedValues);
  if (Component) {
    return React2.createElement(Component, { className }, content);
  }
  if (className) {
    return React2.createElement("span", { className }, content);
  }
  return content;
}

// src/navigation.ts
var NextLink = "a";
var useNextPathname = () => "";
var useNextRouter = () => ({
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
});
var nextRedirect = (url) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
};
var nextPermanentRedirect = (url) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
};
try {
  const linkMod = await import("next/link.js").catch(() => import("next/link"));
  NextLink = linkMod.default ?? linkMod;
} catch {
}
try {
  const navMod = await import("next/navigation.js").catch(() => import("next/navigation"));
  useNextPathname = navMod.usePathname ?? useNextPathname;
  useNextRouter = navMod.useRouter ?? useNextRouter;
  nextRedirect = navMod.redirect ?? nextRedirect;
  nextPermanentRedirect = navMod.permanentRedirect ?? nextPermanentRedirect;
} catch {
}
function isExternalUrl(url) {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/|\\\\)/.test(url);
}
function formatUrlObject(urlObj) {
  let pathname = urlObj.pathname ?? "/";
  if (!pathname.startsWith("/")) {
    pathname = `/${pathname}`;
  }
  let search = urlObj.search ?? "";
  if (search && !search.startsWith("?")) {
    search = `?${search}`;
  } else if (!search && urlObj.query) {
    if (typeof urlObj.query === "string") {
      search = urlObj.query.startsWith("?") ? urlObj.query : `?${urlObj.query}`;
    } else {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(urlObj.query)) {
        if (v !== void 0 && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) {
              params.append(k, String(item));
            }
          } else {
            params.set(k, String(v));
          }
        }
      }
      const qs = params.toString();
      search = qs ? `?${qs}` : "";
    }
  }
  let hash = urlObj.hash ?? "";
  if (hash && !hash.startsWith("#")) {
    hash = `#${hash}`;
  }
  return { pathname, search, hash };
}
function resolveLocalizedPathname(options, config) {
  const { href, locale: explicitLocale } = options;
  const { locales, defaultLocale, localePrefix = "always" } = config;
  let rawPathname = "";
  let search = "";
  let hash = "";
  if (typeof href === "string") {
    if (isExternalUrl(href)) {
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
  const resolvedLocale = explicitLocale ? matchSupportedLocale(explicitLocale, locales) ?? defaultLocale : defaultLocale;
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
  const finalPath = prefix ? cleanPathname === "/" ? prefix : `${prefix}${cleanPathname}` : cleanPathname;
  return `${finalPath}${search}${hash}`;
}
function createNavigation(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix
  });
  const { locales, defaultLocale } = config;
  const ResolvedNextLink = NextLink?.default ?? NextLink;
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
    return React3.createElement(ResolvedNextLink, {
      ...rest,
      href: localizedHref,
      ref
    });
  });
  Link.displayName = "I18nLink";
  function usePathname() {
    const rawPathname = useNextPathname();
    if (!rawPathname) return rawPathname;
    const segments = rawPathname.split("/").filter(Boolean);
    if (segments.length === 0) return "/";
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join("/");
      return rest ? `/${rest}` : "/";
    }
    return rawPathname;
  }
  function useRouter() {
    const router = useNextRouter();
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

// src/server.ts
import { cache } from "react";
var globalConfigFn = null;
var globalLocales = ["en", "ru"];
var globalDefaultLocale = "en";
function configureServerI18n(config) {
  if (config.locales && config.locales.length > 0) {
    globalLocales = config.locales;
  }
  if (config.defaultLocale) {
    globalDefaultLocale = config.defaultLocale;
  }
}
function setRequestConfig(fn) {
  globalConfigFn = fn;
  return fn;
}
var getRequestStore = cache(() => ({
  bundles: /* @__PURE__ */ new Map()
}));
function setRequestLocale(locale) {
  getRequestStore().locale = locale;
}
async function getLocale(options) {
  const store = getRequestStore();
  if (store.locale) {
    return store.locale;
  }
  const allowedLocales = options?.locales ?? globalLocales;
  const defLocale = options?.defaultLocale ?? globalDefaultLocale;
  const headerKey = options?.headerName ?? "x-rustok-effective-locale";
  const cookieList = options?.cookieNames ?? [
    "rustok-locale",
    "rustok-admin-locale",
    "rustok-frontend-locale",
    "NEXT_LOCALE"
  ];
  try {
    const { headers, cookies } = await import("next/headers");
    const headerStore = await headers();
    const cookieStore = await cookies();
    const rawHeader = headerStore.get(headerKey);
    const validHeaderLocale = matchSupportedLocale(rawHeader, allowedLocales);
    if (validHeaderLocale) {
      store.locale = validHeaderLocale;
      return validHeaderLocale;
    }
    for (const cName of cookieList) {
      const cVal = cookieStore.get(cName)?.value;
      const validCookieLocale = matchSupportedLocale(cVal, allowedLocales);
      if (validCookieLocale) {
        store.locale = validCookieLocale;
        return validCookieLocale;
      }
    }
    const acceptLang = headerStore.get("accept-language");
    if (acceptLang) {
      const resolved = resolveAcceptLanguage(acceptLang, allowedLocales);
      if (resolved) {
        store.locale = resolved;
        return resolved;
      }
    }
  } catch {
  }
  store.locale = defLocale;
  return defLocale;
}
async function getMessages(localeArg) {
  const locale = localeArg ?? await getLocale();
  if (globalConfigFn) {
    const res = await globalConfigFn({ locale });
    const store = getRequestStore();
    if (res.defaultTranslationValues && !store.defaultTranslationValues) {
      store.defaultTranslationValues = res.defaultTranslationValues;
    }
    if (res.timeZone && !store.timeZone) {
      store.timeZone = res.timeZone;
    }
    return res.messages;
  }
  return "";
}
function getTimeZone() {
  const store = getRequestStore();
  if (store.timeZone) return store.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function getNow() {
  return /* @__PURE__ */ new Date();
}
async function getFormatter(options) {
  const locale = options?.locale ?? await getLocale();
  const store = getRequestStore();
  const timeZone = options?.timeZone ?? store.timeZone ?? getTimeZone();
  return createFormatter({ locale, timeZone });
}
function getStaticParams(locales) {
  const list = locales && locales.length > 0 ? locales : globalLocales;
  return list.map((locale) => ({ locale }));
}
async function forLocale(locale, options) {
  let namespace;
  let fallbackLocale;
  let fallbackLocales;
  let fallbackMessages;
  let explicitMessages;
  let defaultTranslationValues;
  let debug = false;
  if (typeof options === "string") {
    namespace = options;
  } else if (options) {
    namespace = options.namespace;
    fallbackLocale = options.fallbackLocale;
    fallbackLocales = options.fallbackLocales;
    fallbackMessages = options.fallbackMessages;
    explicitMessages = options.messages;
    defaultTranslationValues = options.defaultTranslationValues;
    debug = options.debug ?? false;
  }
  const store = getRequestStore();
  if (!defaultTranslationValues && store.defaultTranslationValues) {
    defaultTranslationValues = store.defaultTranslationValues;
  }
  let bundle;
  if (explicitMessages) {
    bundle = createFluentBundle(locale, explicitMessages);
  } else {
    let cached = store.bundles.get(locale);
    if (!cached) {
      const messages = await getMessages(locale);
      cached = createFluentBundle(locale, messages);
      store.bundles.set(locale, cached);
    }
    bundle = cached;
  }
  const fallbackBundleList = [];
  if (fallbackMessages) {
    const fbLoc = fallbackLocale ?? "en";
    fallbackBundleList.push(createFluentBundle(fbLoc, fallbackMessages));
  }
  const fallbacksToLoad = /* @__PURE__ */ new Set();
  if (fallbackLocale && fallbackLocale !== locale && !fallbackMessages) {
    fallbacksToLoad.add(fallbackLocale);
  }
  if (fallbackLocales) {
    for (const fb of fallbackLocales) {
      if (fb && fb !== locale) fallbacksToLoad.add(fb);
    }
  }
  if (fallbacksToLoad.size > 0) {
    for (const fbLocale of fallbacksToLoad) {
      let fbBundle = store.bundles.get(fbLocale);
      if (!fbBundle) {
        const fbMessages = await getMessages(fbLocale);
        fbBundle = createFluentBundle(fbLocale, fbMessages);
        store.bundles.set(fbLocale, fbBundle);
      }
      fallbackBundleList.push(fbBundle);
    }
  }
  return createTranslator(bundle, {
    fallbackBundles: fallbackBundleList,
    namespace,
    debug,
    defaultTranslationValues
  });
}
async function getTranslations(options) {
  const explicitLocale = typeof options === "object" && options ? options.locale : void 0;
  const locale = explicitLocale ?? await getLocale();
  return forLocale(locale, options);
}

// src/factory.ts
function createI18n(config) {
  validateI18nConfig(config);
  const middlewareFn = createI18nMiddleware(config);
  if (config.loadMessages) {
    const loader = config.loadMessages;
    setRequestConfig(async ({ locale }) => {
      const target = locale ?? config.defaultLocale;
      const msgs = await loader(target);
      return {
        locale: target,
        messages: msgs
      };
    });
  }
  const serverOptions = {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    headerName: config.headerName
  };
  const navigationInstance = createNavigation({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix
  });
  return {
    config,
    middleware: middlewareFn,
    proxy: middlewareFn,
    navigation: navigationInstance,
    getLocale: () => getLocale(serverOptions),
    getTranslations: async (options) => {
      const explicitLocale = typeof options === "object" && options ? options.locale : void 0;
      const locale = explicitLocale ?? await getLocale(serverOptions);
      return forLocale(locale, options);
    },
    forLocale: (locale, options) => {
      return forLocale(locale, options);
    },
    getMessages: async (locale) => {
      const targetLocale = locale ?? await getLocale(serverOptions);
      if (config.loadMessages) {
        return config.loadMessages(targetLocale);
      }
      return "";
    },
    getFormatter: async (options) => {
      const locale = options?.locale ?? await getLocale(serverOptions);
      return createFormatter({ locale, timeZone: options?.timeZone });
    },
    getStaticParams: () => {
      return config.locales.map((locale) => ({ locale }));
    }
  };
}

// src/pseudo.ts
var CHAR_MAP = {
  a: "\xE5",
  b: "\u0180",
  c: "\xE7",
  d: "\xF0",
  e: "\xE9",
  f: "\u0192",
  g: "\u011D",
  h: "\u0125",
  i: "\xEE",
  j: "\u0135",
  k: "\u045C",
  l: "\u013C",
  m: "\u0271",
  n: "\xF1",
  o: "\xF6",
  p: "\xFE",
  q: "q",
  r: "\u0155",
  s: "\u0161",
  t: "\u0163",
  u: "\xFB",
  v: "\u1E7D",
  w: "\u0175",
  x: "\u04B3",
  y: "\xFD",
  z: "\u017E",
  A: "\xC5",
  B: "\u0181",
  C: "\xC7",
  D: "\xD0",
  E: "\xC9",
  F: "\u0191",
  G: "\u011C",
  H: "\u0124",
  I: "\xCE",
  J: "\u0134",
  K: "\u040C",
  L: "\u013B",
  M: "\u1E40",
  N: "\xD1",
  O: "\xD6",
  P: "\xDE",
  Q: "Q",
  R: "\u0154",
  S: "\u0160",
  T: "\u0162",
  U: "\xDB",
  V: "\u1E7C",
  W: "\u0174",
  X: "\u04B2",
  Y: "\xDD",
  Z: "\u017D"
};
function pseudoLocalizeText(text, options = {}) {
  if (!text) return "";
  const prefix = options.prefix ?? "[";
  const suffix = options.suffix ?? "]";
  const elongate = options.elongate ?? true;
  const tokenRegex = /(\{[^}]*\}|<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>)/g;
  const parts = text.split(tokenRegex);
  const transformedParts = parts.map((part) => {
    if (part.startsWith("{") && part.endsWith("}")) {
      return part;
    }
    if (part.startsWith("<") && part.endsWith(">")) {
      return part;
    }
    let res = "";
    for (const ch of part) {
      const mapped = CHAR_MAP[ch] || ch;
      res += mapped;
      if (elongate && "aeiouAEIOU".includes(ch)) {
        res += mapped;
      }
    }
    return res;
  });
  return `${prefix}${transformedParts.join("")}${suffix}`;
}
function pseudoLocalizeFtl(ftlContent, options = {}) {
  const lines = ftlContent.split(/\r?\n/);
  const resultLines = [];
  const selectOpenRegex = /^\{\s*\$[a-zA-Z][a-zA-Z0-9_-]*\s*->/;
  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) {
      resultLines.push(line);
      continue;
    }
    const msgMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*\s*=\s*)(.*)$/);
    if (msgMatch) {
      const [, prefix, value] = msgMatch;
      const trimmedValue = value.trim();
      if (trimmedValue && !selectOpenRegex.test(trimmedValue)) {
        resultLines.push(`${prefix}${pseudoLocalizeText(value, options)}`);
      } else {
        resultLines.push(line);
      }
      continue;
    }
    const attrMatch = line.match(/^(\s+\.[a-zA-Z][a-zA-Z0-9_-]*\s*=\s*)(.*)$/);
    if (attrMatch) {
      const [, prefix, value] = attrMatch;
      const trimmedValue = value.trim();
      if (trimmedValue && !selectOpenRegex.test(trimmedValue)) {
        resultLines.push(`${prefix}${pseudoLocalizeText(value, options)}`);
      } else {
        resultLines.push(line);
      }
      continue;
    }
    const variantMatch = line.match(/^(\s*\*?\[[a-zA-Z0-9_-]+\]\s*)(.*)$/);
    if (variantMatch) {
      const [, prefix, value] = variantMatch;
      if (value.trim()) {
        resultLines.push(`${prefix}${pseudoLocalizeText(value, options)}`);
      } else {
        resultLines.push(line);
      }
      continue;
    }
    if (/^\s*\}\s*$/.test(line)) {
      resultLines.push(line);
      continue;
    }
    if (/^\s+/.test(line) && selectOpenRegex.test(line.trim())) {
      resultLines.push(line);
      continue;
    }
    if (/^\s+/.test(line) && line.trim()) {
      const indentMatch = line.match(/^(\s+)(.*)$/);
      if (indentMatch) {
        const [, indent, text] = indentMatch;
        resultLines.push(`${indent}${pseudoLocalizeText(text, options)}`);
        continue;
      }
    }
    resultLines.push(line);
  }
  return resultLines.join("\n");
}

// src/typegen.ts
function extractVariablesFromLine(line) {
  const lineWithoutStrings = line.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, "");
  const matches = lineWithoutStrings.matchAll(/\$([a-zA-Z][a-zA-Z0-9_-]*)/g);
  return Array.from(matches, (m) => m[1]);
}
function extractMessagesFromFtl(ftlContent) {
  const messages = [];
  const lines = ftlContent.split(/\r?\n/);
  let currentMsg = null;
  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) {
      continue;
    }
    const msgMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
    if (msgMatch) {
      const id = msgMatch[1];
      const dotId = id.replace(/-/g, ".");
      currentMsg = {
        id,
        dotId,
        attributes: [],
        variables: []
      };
      messages.push(currentMsg);
      for (const v of extractVariablesFromLine(line)) {
        if (!currentMsg.variables.includes(v)) {
          currentMsg.variables.push(v);
        }
      }
      continue;
    }
    const attrMatch = line.match(/^\s+\.([a-zA-Z][a-zA-Z0-9_-]*)\s*=/);
    if (attrMatch && currentMsg) {
      currentMsg.attributes.push(attrMatch[1]);
      for (const v of extractVariablesFromLine(line)) {
        if (!currentMsg.variables.includes(v)) {
          currentMsg.variables.push(v);
        }
      }
      continue;
    }
    if (currentMsg) {
      for (const v of extractVariablesFromLine(line)) {
        if (!currentMsg.variables.includes(v)) {
          currentMsg.variables.push(v);
        }
      }
    }
  }
  return messages;
}
function generateTypeDeclarations(ftlContents) {
  const contents = Array.isArray(ftlContents) ? ftlContents : [ftlContents];
  const allMessages = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const content of contents) {
    const extracted = extractMessagesFromFtl(content);
    for (const msg of extracted) {
      if (seenIds.has(msg.id)) {
        const idx = allMessages.findIndex((m) => m.id === msg.id);
        if (idx !== -1) {
          allMessages[idx] = msg;
        }
      } else {
        seenIds.add(msg.id);
        allMessages.push(msg);
      }
    }
  }
  allMessages.sort((a, b) => a.id.localeCompare(b.id));
  const keyUnion = allMessages.flatMap((m) => [`  | '${m.id}'`, `  | '${m.dotId}'`]).join("\n");
  const argsEntries = allMessages.map((m) => {
    if (m.variables.length === 0) {
      return `  '${m.dotId}'?: Record<string, never>;
  '${m.id}'?: Record<string, never>;`;
    }
    const varsType = m.variables.map((v) => `'${v}': string | number | Date`).join("; ");
    return `  '${m.dotId}': { ${varsType} };
  '${m.id}': { ${varsType} };`;
  });
  return `// Auto-generated by next-fluent typegen. DO NOT EDIT DIRECTLY.
/* eslint-disable */

export type AppMessageKey =
${keyUnion || "  | string"};

export interface AppMessageArgs {
${argsEntries.join("\n")}
}
`;
}
export {
  FluentProvider,
  FormattedMessage,
  buildKeyCandidates,
  canonicalizeLocale,
  clearBundleCache,
  clearFormatterCache,
  configureServerI18n,
  createDefaultFunctions,
  createFluentBundle,
  createFormatter,
  createI18n,
  createI18nMiddleware,
  createMiddleware,
  createNavigation,
  createTranslator,
  extractMessagesFromFtl,
  forLocale,
  formatUrlObject,
  generateTypeDeclarations,
  getBundleCacheStats,
  getCachedFluentBundle,
  getFormatter,
  getLocale,
  getNow,
  getStaticParams,
  getTimeZone,
  getTranslations,
  matchSupportedLocale,
  normalizeLocaleTag,
  parseRichText,
  pseudoLocalizeFtl,
  pseudoLocalizeText,
  resolveAcceptLanguage,
  resolveLocalizedPathname,
  setRequestConfig,
  setRequestLocale,
  unwrapFluentValue,
  useFormatter,
  useLocale,
  useNow,
  useTimeZone,
  useTranslations,
  validateI18nConfig,
  withKebabKey
};
