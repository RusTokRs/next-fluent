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
function buildKeyCandidates(namespace, key, options) {
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
    if (options?.strictNamespace) {
      return candidates;
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
    cookieName = "NEXT_LOCALE",
    headerName = "x-next-locale"
  } = options;
  const defaultLocale = matchSupportedLocale(rawDefaultLocale, locales) ?? rawDefaultLocale;
  return async function middleware(request) {
    let NextResponse;
    try {
      const nextServer = await import("next/server.js").catch(() => import("next/server"));
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
        static rewrite(url, opts) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            rewriteUrl: String(url),
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
      request.cookies.get(cookieName)?.value || (cookieName !== "NEXT_LOCALE" ? request.cookies.get("NEXT_LOCALE")?.value : void 0),
      locales
    );
    const headerLocale = resolveAcceptLanguage(
      request.headers.get("accept-language"),
      locales
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
      const response = rewritePath ? NextResponse.rewrite(new URL(rewritePath, request.url), {
        request: { headers: requestHeaders }
      }) : NextResponse.next({
        request: { headers: requestHeaders }
      });
      if (!response.request) {
        response.request = { headers: requestHeaders };
      }
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
      const rewritePath = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
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
        const rewritePath = `/${defaultLocale}${pathname === "/" ? "" : pathname}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
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

// src/lru.ts
var LRUCache = class {
  constructor(maxSize) {
    this.maxSize = maxSize;
  }
  maxSize;
  map = /* @__PURE__ */ new Map();
  get(key) {
    const val = this.map.get(key);
    if (val !== void 0) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== void 0) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }
  has(key) {
    return this.map.has(key);
  }
  delete(key) {
    return this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
};

// src/formatter.ts
var MAX_CACHE_SIZE = 200;
function stringifySorted(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stringifySorted).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map(
    (k) => `${JSON.stringify(k)}:${stringifySorted(obj[k])}`
  ).join(",")}}`;
}
var dtfCache = new LRUCache(MAX_CACHE_SIZE);
var nfCache = new LRUCache(MAX_CACHE_SIZE);
var rtfCache = new LRUCache(MAX_CACHE_SIZE);
var lfCache = new LRUCache(MAX_CACHE_SIZE);
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
      const cacheKey = `${locale}::${stringifySorted(mergedOptions)}`;
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
      const cacheKey = `${locale}::${stringifySorted(nfOptions ?? {})}`;
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
      const cacheKey = `${locale}::${stringifySorted(rtfOptions ?? {})}`;
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
      const items = typeof value === "string" ? [value] : value;
      const cacheKey = `${locale}::${stringifySorted(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(items).join(", ");
        }
      }
      try {
        return formatter.format(items);
      } catch {
        return Array.from(items).join(", ");
      }
    }
  };
}

// src/navigation.ts
import React4, { forwardRef, useMemo as useMemo2 } from "react";
import NextLink from "next/link.js";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  redirect as nextRedirect,
  permanentRedirect as nextPermanentRedirect
} from "next/navigation.js";

// src/client.ts
import React3, { createContext, useContext, useEffect, useMemo, useState } from "react";

// src/bundle.ts
import React2 from "react";

// src/rich.ts
import React from "react";
var VOID_TAGS = /* @__PURE__ */ new Set([
  "br",
  "hr",
  "img",
  "input",
  "wbr"
]);
var REACT_ELEMENT_TOKEN_PREFIX = "\uE000NF_EL_";
var REACT_ELEMENT_TOKEN_SUFFIX = "_\uE001";
function createReactElementToken(key) {
  return `${REACT_ELEMENT_TOKEN_PREFIX}${key}${REACT_ELEMENT_TOKEN_SUFFIX}`;
}
var TOKEN_OR_TAG_REGEX = /(?:\u2068)?\uE000NF_EL_([a-zA-Z0-9_-]+)_\uE001(?:\u2069)?|<\/?([a-zA-Z][a-zA-Z0-9_-]*)\s*\/?>/g;
function parseRichText(text, values) {
  if (!values) {
    return text;
  }
  const hasTokens = text.includes(REACT_ELEMENT_TOKEN_PREFIX);
  const hasTags = text.includes("<");
  if (!hasTokens && !hasTags) {
    return text;
  }
  const hasInteractive = Object.keys(values).some(
    (k) => typeof values[k] === "function" || React.isValidElement(values[k])
  );
  if (!hasInteractive) {
    return text;
  }
  const root = { children: [] };
  const stack = [root];
  let lastIndex = 0;
  let match;
  TOKEN_OR_TAG_REGEX.lastIndex = 0;
  while ((match = TOKEN_OR_TAG_REGEX.exec(text)) !== null) {
    const [fullMatch, elementTokenKey, tagName] = match;
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      const textChunk = text.slice(lastIndex, matchIndex);
      stack[stack.length - 1].children.push(textChunk);
    }
    lastIndex = TOKEN_OR_TAG_REGEX.lastIndex;
    if (elementTokenKey) {
      if (Object.hasOwn(values, elementTokenKey)) {
        const val = values[elementTokenKey];
        if (React.isValidElement(val)) {
          stack[stack.length - 1].children.push(val);
        } else if (typeof val === "function") {
          stack[stack.length - 1].children.push(val(null));
        } else if (val !== void 0 && val !== null) {
          stack[stack.length - 1].children.push(String(val));
        }
      } else {
        stack[stack.length - 1].children.push(fullMatch);
      }
      continue;
    }
    if (tagName) {
      const isClose = fullMatch.startsWith("</");
      const isSelfClosing = fullMatch.endsWith("/>") || VOID_TAGS.has(tagName.toLowerCase());
      if (isSelfClosing && !isClose) {
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
var numberFormatCache = new LRUCache(200);
function getCachedNumberFormat(locale, options) {
  const cacheKey = `${locale}::${options.style}::${options.currency ?? ""}::${options.currencyDisplay ?? ""}::${options.minimumFractionDigits ?? ""}::${options.maximumFractionDigits ?? ""}`;
  let nf = numberFormatCache.get(cacheKey);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(cacheKey, nf);
  }
  return nf;
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
        return getCachedNumberFormat(locale, {
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
        return getCachedNumberFormat(locale, {
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
function fnv1a32(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function computeSourceHash(source) {
  if (typeof source === "string") {
    return `${source.length}:${fnv1a32(source)}`;
  }
  let totalLen = 0;
  let combinedHash = 2166136261;
  for (const item of source) {
    if (!item) continue;
    totalLen += item.length;
    for (let i = 0; i < item.length; i++) {
      combinedHash ^= item.charCodeAt(i);
      combinedHash = Math.imul(combinedHash, 16777619);
    }
    combinedHash ^= 31;
    combinedHash = Math.imul(combinedHash, 16777619);
  }
  return `${source.length}:${totalLen}:${(combinedHash >>> 0).toString(16).padStart(8, "0")}`;
}
var resourceCache = new LRUCache(MAX_RESOURCE_CACHE);
var bundleCache = new LRUCache(MAX_BUNDLE_CACHE);
function getOrCreateResource(source) {
  const hash = `${source.length}:${fnv1a32(source)}`;
  let res = resourceCache.get(hash);
  if (!res) {
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
    bundleCache.set(cacheKey, bundle);
  }
  return bundle;
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
  let strictNamespace;
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
      strictNamespace = opts.strictNamespace;
    }
  } else {
    namespace = maybeNamespace;
  }
  const defaultFluentArgs = {};
  if (defaultTranslationValues) {
    for (const [k, v] of Object.entries(defaultTranslationValues)) {
      if (React2.isValidElement(v)) {
        defaultFluentArgs[k] = createReactElementToken(k);
      } else if (typeof v === "string" || typeof v === "number" || v instanceof Date || typeof v === "object" && v !== null && "type" in v) {
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
    const lastDot = candidate.lastIndexOf(".");
    if (lastDot !== -1) {
      const msgId = candidate.slice(0, lastDot);
      const attrName = candidate.slice(lastDot + 1);
      const parentMsg = targetBundle.getMessage(msgId) ?? targetBundle.getMessage(withKebabKey(msgId));
      if (parentMsg?.attributes) {
        const pattern = parentMsg.attributes[attrName] ?? parentMsg.attributes[withKebabKey(attrName)];
        if (pattern) {
          const errors = [];
          const formatted = targetBundle.formatPattern(pattern, args, errors);
          if (errors.length > 0) {
            console.warn(
              `[next-fluent] Format errors for attribute "${candidate}":`,
              errors
            );
            return FORMAT_ERROR;
          }
          return formatted;
        }
      }
    }
    return null;
  };
  const tFn = (key, args) => {
    const mergedArgs = defaultTranslationValues && Object.keys(defaultFluentArgs).length > 0 ? { ...defaultFluentArgs, ...args } : args;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
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
    if (!msg) {
      const lastDot = candidate.lastIndexOf(".");
      if (lastDot !== -1) {
        const msgId = candidate.slice(0, lastDot);
        const attrName = candidate.slice(lastDot + 1);
        const parentMsg = targetBundle.getMessage(msgId) ?? targetBundle.getMessage(withKebabKey(msgId));
        if (parentMsg?.attributes) {
          const pattern = parentMsg.attributes[attrName] ?? parentMsg.attributes[withKebabKey(attrName)];
          if (pattern) {
            const errors = [];
            const formatted = targetBundle.formatPattern(pattern, void 0, errors);
            if (errors.length > 0) {
              console.warn(
                `[next-fluent] Format errors for raw attribute "${candidate}":`,
                errors
              );
              return FORMAT_ERROR;
            }
            return formatted;
          }
        }
      }
      return null;
    }
    if (msg.attributes && Object.keys(msg.attributes).length > 0) {
      const sortedAttrKeys = Object.keys(msg.attributes).sort(
        (a, b) => a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" })
      );
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
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
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
        if (React2.isValidElement(v)) {
          fluentArgs[k] = createReactElementToken(k);
        } else if (typeof v === "string" || typeof v === "number" || v instanceof Date || typeof v === "object" && v !== null && "type" in v) {
          fluentArgs[k] = v;
        }
      }
    }
    const formattedText = tFn(key, fluentArgs);
    return parseRichText(formattedText, mergedValues);
  };
  tFn.has = (key) => {
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const candidate of candidates) {
      for (const b of allBundles) {
        if (b.hasMessage(candidate)) return true;
        const lastDot = candidate.lastIndexOf(".");
        if (lastDot !== -1) {
          const msgId = candidate.slice(0, lastDot);
          const attrName = candidate.slice(lastDot + 1);
          const parentMsg = b.getMessage(msgId) ?? b.getMessage(withKebabKey(msgId));
          if (parentMsg?.attributes && (parentMsg.attributes[attrName] || parentMsg.attributes[withKebabKey(attrName)])) {
            return true;
          }
        }
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
    return React4.createElement(NextLink, {
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

// src/server.ts
import { cache } from "react";
var globalConfigFn = null;
var globalLocales = ["en"];
var globalDefaultLocale = "en";
function setRequestConfig(fn) {
  globalConfigFn = fn;
  return fn;
}
var getRequestStore = cache(() => ({
  bundles: /* @__PURE__ */ new Map()
}));
async function getLocale(options) {
  const store = getRequestStore();
  if (store.locale) {
    return store.locale;
  }
  const allowedLocales = options?.locales && options.locales.length > 0 ? options.locales : globalLocales.length > 0 ? globalLocales : void 0;
  const defLocale = options?.defaultLocale ?? globalDefaultLocale;
  const headerKey = options?.headerName ?? "x-next-locale";
  const cookieList = options?.cookieNames ?? [
    ...options?.cookieName ? [options.cookieName] : [],
    "NEXT_LOCALE"
  ];
  try {
    const { headers, cookies } = await import("next/headers.js").catch(() => import("next/headers"));
    const headerStore = await headers();
    const cookieStore = await cookies();
    const rawHeader = headerStore.get(headerKey);
    if (allowedLocales) {
      const validHeaderLocale = matchSupportedLocale(rawHeader, allowedLocales);
      if (validHeaderLocale) {
        store.locale = validHeaderLocale;
        return validHeaderLocale;
      }
    } else if (rawHeader) {
      store.locale = rawHeader;
      return rawHeader;
    }
    for (const cName of cookieList) {
      const cVal = cookieStore.get(cName)?.value;
      if (allowedLocales) {
        const validCookieLocale = matchSupportedLocale(cVal, allowedLocales);
        if (validCookieLocale) {
          store.locale = validCookieLocale;
          return validCookieLocale;
        }
      } else if (cVal) {
        store.locale = cVal;
        return cVal;
      }
    }
    const acceptLang = headerStore.get("accept-language");
    if (acceptLang && allowedLocales) {
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
async function resolveConfigFn() {
  if (globalConfigFn) return globalConfigFn;
  try {
    const mod = await import("next-fluent/config");
    const fn = mod.default ?? mod;
    if (typeof fn === "function") {
      globalConfigFn = fn;
      return fn;
    }
  } catch {
  }
  return null;
}
async function getMessages(localeArg) {
  const locale = localeArg ?? await getLocale();
  const configFn = await resolveConfigFn();
  if (configFn) {
    const res = await configFn({ locale });
    const store = getRequestStore();
    if (res.defaultTranslationValues && !store.defaultTranslationValues) {
      store.defaultTranslationValues = res.defaultTranslationValues;
    }
    if (res.timeZone && !store.timeZone) {
      store.timeZone = res.timeZone;
    }
    if (res.now && !store.now) {
      store.now = res.now;
    }
    if (res.functions && !store.functions) {
      store.functions = res.functions;
    }
    return res.messages;
  }
  return "";
}
async function forLocale(locale, options) {
  let namespace;
  let fallbackLocale;
  let fallbackLocales;
  let fallbackMessages;
  let explicitMessages;
  let defaultTranslationValues;
  let debug = false;
  let strictNamespace;
  let customFunctions;
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
    strictNamespace = options.strictNamespace;
    customFunctions = options.functions;
  }
  const store = getRequestStore();
  if (!defaultTranslationValues && store.defaultTranslationValues) {
    defaultTranslationValues = store.defaultTranslationValues;
  }
  const mergedFunctions = {
    ...store.functions,
    ...customFunctions
  };
  let bundle;
  if (explicitMessages) {
    bundle = createFluentBundle(locale, explicitMessages, { functions: mergedFunctions });
  } else {
    let cached = store.bundles.get(locale);
    if (!cached) {
      const messages = await getMessages(locale);
      cached = createFluentBundle(locale, messages, { functions: mergedFunctions });
      store.bundles.set(locale, cached);
    }
    bundle = cached;
  }
  const fallbackBundleList = [];
  if (fallbackMessages) {
    const fbLoc = fallbackLocale ?? "en";
    fallbackBundleList.push(
      createFluentBundle(fbLoc, fallbackMessages, { functions: mergedFunctions })
    );
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
        fbBundle = createFluentBundle(fbLocale, fbMessages, { functions: mergedFunctions });
        store.bundles.set(fbLocale, fbBundle);
      }
      fallbackBundleList.push(fbBundle);
    }
  }
  return createTranslator(bundle, {
    fallbackBundles: fallbackBundleList,
    namespace,
    debug,
    defaultTranslationValues,
    strictNamespace
  });
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
    localePrefix: config.localePrefix,
    pathnames: config.pathnames
  });
  return {
    config,
    middleware: middlewareFn,
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
export {
  createI18n
};
