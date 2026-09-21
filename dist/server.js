// src/server.ts
import { cache } from "react";

// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
var HTTP_QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
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

// src/server.ts
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
function getRequestConfig() {
  return globalConfigFn;
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
export {
  configureServerI18n,
  forLocale,
  getFormatter,
  getLocale,
  getMessages,
  getNow,
  getRequestConfig,
  getRequestStore,
  getStaticParams,
  getTimeZone,
  getTranslations,
  setRequestConfig,
  setRequestLocale
};
