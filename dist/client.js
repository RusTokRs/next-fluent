"use client";
"use client";

// src/client.ts
import React3, { createContext, useContext, useEffect, useMemo, useState } from "react";

// src/bundle.ts
import React2 from "react";

// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
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
    combinedHash ^= 0;
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
      }
    }
    return false;
  };
  return tFn;
}

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
      const cacheKey = `${locale}::${stringifySorted(lfOptions ?? {})}`;
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
  now,
  functions,
  defaultTranslationValues,
  debug,
  children
}) {
  const messagesKey = typeof messages === "string" ? messages : Array.isArray(messages) ? messages.join("\0") : null;
  const fallbackMessagesKey = typeof fallbackMessages === "string" ? fallbackMessages : Array.isArray(fallbackMessages) ? fallbackMessages.join("\0") : null;
  const bundle = useMemo(() => {
    if (!messages) return null;
    if (typeof messages === "string" || Array.isArray(messages)) {
      return createFluentBundle(locale, messages, { functions });
    }
    return messages;
  }, [locale, messagesKey ?? messages, functions]);
  const fallbackBundle = useMemo(() => {
    if (!fallbackMessages) return null;
    const fLocale = fallbackLocale || "en";
    if (typeof fallbackMessages === "string" || Array.isArray(fallbackMessages)) {
      return createFluentBundle(fLocale, fallbackMessages, { functions });
    }
    return fallbackMessages;
  }, [fallbackLocale, fallbackMessagesKey ?? fallbackMessages, functions]);
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
      now,
      functions,
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
      now,
      functions,
      defaultTranslationValues,
      debug
    ]
  );
  return React3.createElement(FluentContext.Provider, { value }, children);
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
  const context = useContext(FluentContext);
  const initialDate = context.now ?? /* @__PURE__ */ new Date();
  const [now, setNow] = useState(() => initialDate);
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
    return React3.createElement(Component, { className }, content);
  }
  if (className) {
    return React3.createElement("span", { className }, content);
  }
  return content;
}
export {
  FluentProvider,
  FormattedMessage,
  createFormatter,
  useFormatter,
  useLocale,
  useNow,
  useTimeZone,
  useTranslations
};
