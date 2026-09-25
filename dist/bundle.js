import React from "react";
import { buildKeyCandidates, canonicalizeLocale, withKebabKey } from "./utils.js";
import {
  parseRichText,
  createReactElementToken,
  REACT_ELEMENT_TOKEN_PREFIX
} from "./rich.js";
import {
  getCachedFluentBundle,
  clearBundleCache as clearInternalBundleCache,
  getBundleCacheStats,
  LRUCache
} from "./cache.js";
import { clearFunctionsCache } from "./functions.js";
function clearBundleCache() {
  clearInternalBundleCache();
  clearFunctionsCache();
}
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
const FORMAT_ERROR = /* @__PURE__ */ Symbol("format-error");
function stripBidiIsolates(value) {
  return value.replace(/[\u2068\u2069]/g, "");
}
function buildFluentArgs(values) {
  const fluentArgs = {};
  if (!values) return fluentArgs;
  for (const [k, v] of Object.entries(values)) {
    if (React.isValidElement(v)) {
      fluentArgs[k] = createReactElementToken(k);
    } else if (typeof v === "string" || typeof v === "number" || v instanceof Date || typeof v === "object" && v !== null && "type" in v) {
      fluentArgs[k] = v;
    }
  }
  return fluentArgs;
}
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
  const defaultFluentArgs = buildFluentArgs(defaultTranslationValues);
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
  const formatKey = (key, args) => {
    const mergedArgs = Object.keys(defaultFluentArgs).length > 0 ? { ...defaultFluentArgs, ...args } : args;
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
  const tFn = ((key, args) => {
    const formatted = formatKey(key, buildFluentArgs(args));
    if (formatted.includes(REACT_ELEMENT_TOKEN_PREFIX)) {
      const fallbackKey = namespace ? `${namespace}.${key}` : key;
      throw new Error(
        `[next-fluent] Message "${fallbackKey}" interpolates a React element. Use t.rich() or <FormattedMessage> for rich content.`
      );
    }
    return formatted;
  });
  const formatRawPattern = (targetBundle, pattern, args) => {
    const formatted = targetBundle.formatPattern(pattern, args, []);
    return stripBidiIsolates(formatted);
  };
  const getRawValue = (targetBundle, candidate, args) => {
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
            return formatRawPattern(targetBundle, pattern, args);
          }
        }
      }
      return null;
    }
    if (msg.value) {
      const rawText = formatRawPattern(targetBundle, msg.value, args);
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
    if (msg.attributes && Object.keys(msg.attributes).length > 0) {
      const sortedAttrKeys = Object.keys(msg.attributes).sort(
        (a, b) => a.localeCompare(b, void 0, { numeric: true, sensitivity: "base" })
      );
      return sortedAttrKeys.map(
        (attrKey) => formatRawPattern(targetBundle, msg.attributes[attrKey], args)
      );
    }
    return null;
  };
  tFn.raw = ((key, args) => {
    const mergedArgs = buildFluentArgs(args);
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    const fallbackKey = namespace ? `${namespace}.${key}` : key;
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const res = getRawValue(b, candidate, mergedArgs);
        if (res !== null && res !== void 0) return res;
      }
    }
    if (debug) {
      console.warn(`[next-fluent] Missing raw translation for key "${fallbackKey}"`);
      return `[MISSING: ${fallbackKey}]`;
    }
    return fallbackKey;
  });
  tFn.rich = (key, values) => {
    const mergedValues = defaultTranslationValues || values ? { ...defaultTranslationValues ?? {}, ...values ?? {} } : void 0;
    const formattedText = formatKey(key, buildFluentArgs(mergedValues));
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
export {
  LRUCache,
  clearBundleCache,
  clearFunctionsCache,
  createFluentBundle,
  createTranslator,
  getBundleCacheStats,
  getCachedFluentBundle
};
