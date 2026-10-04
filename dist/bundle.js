import { FluentNumber, FluentType } from "@fluent/bundle";
import React from "react";
import { buildKeyCandidates, canonicalizeLocale, withKebabKey } from "./utils.js";
import { toFluentSource } from "./catalog.js";
import {
  parseRichText,
  stripRichText,
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
import {
  FluentErrorCode,
  FluentError,
  createErrorReporter
} from "./errors.js";
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
  return getCachedFluentBundle(canonicalLocale, toFluentSource(ftlSource), options);
}
function stripBidiIsolates(value) {
  return value.replace(/[\u2068\u2069]/g, "");
}
function buildFluentArgs(values) {
  const args = {};
  const rejected = [];
  if (!values) return { args, rejected };
  for (const [k, v] of Object.entries(values)) {
    if (React.isValidElement(v)) {
      args[k] = createReactElementToken(k);
      continue;
    }
    if (v === null || v === void 0) {
      rejected.push(k);
      continue;
    }
    if (typeof v === "string" || typeof v === "number" || v instanceof Date) {
      args[k] = v;
      continue;
    }
    if (typeof v === "boolean") {
      args[k] = String(v);
      continue;
    }
    if (typeof v === "bigint") {
      const digits = v.toString();
      args[k] = Number.isFinite(Number(digits)) ? new FluentNumber(digits) : digits;
      continue;
    }
    if (v instanceof FluentType || typeof v === "object" && "value" in v && typeof v.valueOf === "function") {
      args[k] = v;
      continue;
    }
    rejected.push(k);
  }
  return { args, rejected };
}
function createTranslator(bundle, namespaceOrFallbackOrOpts, maybeNamespace) {
  const allBundles = [];
  if (bundle) allBundles.push(bundle);
  let namespace;
  let debug = false;
  let defaultTranslationValues;
  let strictNamespace;
  let onError;
  let getMessageFallback;
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
      onError = opts.onError;
      getMessageFallback = opts.getMessageFallback;
    }
  } else {
    namespace = maybeNamespace;
  }
  const report = createErrorReporter({ onError, getMessageFallback, debug });
  const defaults = buildFluentArgs(defaultTranslationValues);
  const bundleLocale = (targetBundle) => targetBundle.locales?.[0];
  const formatCandidate = (targetBundle, candidate, args) => {
    const msg = targetBundle.getMessage(candidate);
    if (msg?.value) {
      const errors = [];
      const formatted = targetBundle.formatPattern(msg.value, args, errors);
      if (errors.length > 0) return { kind: "error", errors };
      return { kind: "ok", value: formatted };
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
          if (errors.length > 0) return { kind: "error", errors };
          return { kind: "ok", value: formatted };
        }
      }
    }
    return { kind: "missing" };
  };
  const formatKey = (key, args, rejectedArgs) => {
    const mergedArgs = Object.keys(defaults.args).length > 0 || Object.keys(args ?? {}).length > 0 ? { ...defaults.args, ...args } : void 0;
    const rejected = defaults.rejected.length > 0 || rejectedArgs.length > 0 ? [...defaults.rejected, ...rejectedArgs] : void 0;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const formatted = formatCandidate(b, candidate, mergedArgs);
        if (formatted.kind === "error") {
          const details = rejected ? {
            code: FluentErrorCode.INVALID_ARGUMENT,
            key,
            namespace,
            locale: bundleLocale(b),
            cause: { unsupportedArguments: rejected, errors: formatted.errors }
          } : {
            code: FluentErrorCode.FORMATTING_ERROR,
            key,
            namespace,
            locale: bundleLocale(b),
            cause: formatted.errors
          };
          return report(details);
        }
        if (formatted.kind === "ok") return formatted.value;
      }
    }
    return report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
  };
  const tFn = ((key, args) => {
    const built = buildFluentArgs(args);
    const formatted = formatKey(key, built.args, built.rejected);
    if (formatted.includes(REACT_ELEMENT_TOKEN_PREFIX)) {
      const fallbackKey = namespace ? `${namespace}.${key}` : key;
      throw new FluentError({
        code: FluentErrorCode.UNSUPPORTED_VALUE,
        key,
        namespace,
        message: `[next-fluent] Message "${fallbackKey}" interpolates a React element. Use t.rich() or <FormattedMessage> for rich content.`
      });
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
      return Object.keys(msg.attributes).map(
        (attrKey) => formatRawPattern(targetBundle, msg.attributes[attrKey], args)
      );
    }
    return null;
  };
  tFn.raw = ((key, args) => {
    const built = buildFluentArgs(args);
    const mergedArgs = Object.keys(defaults.args).length > 0 || Object.keys(built.args).length > 0 ? { ...defaults.args, ...built.args } : void 0;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const res = getRawValue(b, candidate, mergedArgs);
        if (res !== null && res !== void 0) return res;
      }
    }
    return report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
  });
  tFn.rich = (key, values) => {
    const mergedValues = defaultTranslationValues || values ? { ...defaultTranslationValues ?? {}, ...values ?? {} } : void 0;
    const built = buildFluentArgs(mergedValues);
    const formattedText = formatKey(key, built.args, built.rejected);
    return parseRichText(formattedText, mergedValues);
  };
  tFn.attrs = ((key, args) => {
    const built = buildFluentArgs(args);
    const mergedArgs = Object.keys(defaults.args).length > 0 || Object.keys(built.args).length > 0 ? { ...defaults.args, ...built.args } : void 0;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const msg = b.getMessage(candidate) ?? b.getMessage(withKebabKey(candidate));
        if (!msg?.attributes || Object.keys(msg.attributes).length === 0) continue;
        const result = {};
        const errors = [];
        for (const [attrKey, pattern] of Object.entries(msg.attributes)) {
          result[attrKey] = stripBidiIsolates(
            b.formatPattern(pattern, mergedArgs, errors)
          );
        }
        if (errors.length > 0) {
          report(
            built.rejected.length > 0 ? {
              code: FluentErrorCode.INVALID_ARGUMENT,
              key,
              namespace,
              locale: bundleLocale(b),
              cause: { unsupportedArguments: built.rejected, errors }
            } : {
              code: FluentErrorCode.FORMATTING_ERROR,
              key,
              namespace,
              locale: bundleLocale(b),
              cause: errors
            }
          );
          return {};
        }
        return result;
      }
    }
    report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
    return {};
  });
  tFn.plain = ((key, args) => {
    const built = buildFluentArgs(args);
    return stripRichText(formatKey(key, built.args, built.rejected));
  });
  tFn.has = (key) => {
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const candidate of candidates) {
      for (const b of allBundles) {
        const message = b.getMessage(candidate);
        if (message?.value != null) return true;
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
  FluentError,
  FluentErrorCode,
  LRUCache,
  clearBundleCache,
  clearFunctionsCache,
  createFluentBundle,
  createTranslator,
  getBundleCacheStats,
  getCachedFluentBundle
};
