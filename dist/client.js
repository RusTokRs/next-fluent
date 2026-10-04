"use client";
import React, { createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState } from "react";
import NextLink from "next/link.js";
import { domainLocalePrefix, findLocaleDomain } from "./domain-routing.js";
import { createFluentBundle, createTranslator } from "./bundle.js";
import { isJsonCatalog, jsonToFluent } from "./catalog.js";
import { createFormatter } from "./formatter.js";
import { computeSourceHash } from "./cache.js";
import { resolveLocalizedPathname, switchLocaleHref } from "./nav-url.js";
const FluentContext = createContext({
  locale: "en",
  bundle: null,
  fallbackBundle: null,
  debug: false
});
const STATIC_NOW = /* @__PURE__ */ new Date(0);
function useStableFunctions(functions) {
  const ref = useRef(null);
  if (!functions) {
    ref.current = null;
    return void 0;
  }
  const keys = Object.keys(functions).sort();
  const current = ref.current;
  if (current && current.keys.length === keys.length && keys.every((key, index) => current.keys[index] === key && current.values[index] === functions[key])) {
    return current.stable;
  }
  const stable = { ...functions };
  ref.current = { keys, values: keys.map((key) => functions[key]), stable };
  return stable;
}
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
  strictNamespace,
  formats,
  useIsolating,
  onError,
  getMessageFallback,
  children
}) {
  const normalizedMessages = useMemo(
    () => isJsonCatalog(messages) ? jsonToFluent(messages) : messages,
    [messages]
  );
  const normalizedFallbackMessages = useMemo(
    () => isJsonCatalog(fallbackMessages) ? jsonToFluent(fallbackMessages) : fallbackMessages,
    [fallbackMessages]
  );
  const stableFunctions = useStableFunctions(functions);
  const messagesKey = useMemo(
    () => typeof normalizedMessages === "string" || Array.isArray(normalizedMessages) ? computeSourceHash(normalizedMessages) : null,
    [normalizedMessages]
  );
  const fallbackMessagesKey = useMemo(
    () => typeof normalizedFallbackMessages === "string" || Array.isArray(normalizedFallbackMessages) ? computeSourceHash(normalizedFallbackMessages) : null,
    [normalizedFallbackMessages]
  );
  const bundleIdentity = messagesKey ?? normalizedMessages;
  const fallbackBundleIdentity = fallbackMessagesKey ?? normalizedFallbackMessages;
  const bundle = useMemo(() => {
    if (!normalizedMessages) return null;
    if (typeof normalizedMessages === "string" || Array.isArray(normalizedMessages)) {
      return createFluentBundle(locale, normalizedMessages, {
        functions: stableFunctions,
        useIsolating
      });
    }
    return normalizedMessages;
  }, [locale, bundleIdentity, stableFunctions, useIsolating]);
  const fallbackBundle = useMemo(() => {
    if (!normalizedFallbackMessages) return null;
    const fLocale = fallbackLocale || "en";
    if (typeof normalizedFallbackMessages === "string" || Array.isArray(normalizedFallbackMessages)) {
      return createFluentBundle(fLocale, normalizedFallbackMessages, {
        functions: stableFunctions,
        useIsolating
      });
    }
    return normalizedFallbackMessages;
  }, [fallbackLocale, fallbackBundleIdentity, stableFunctions, useIsolating]);
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
      messages: typeof normalizedMessages === "string" || Array.isArray(normalizedMessages) ? normalizedMessages : void 0,
      fallbackLocale,
      fallbackBundle,
      fallbackBundles: resolvedFallbackBundles,
      timeZone,
      now,
      functions: stableFunctions,
      defaultTranslationValues,
      debug,
      strictNamespace,
      formats,
      onError,
      getMessageFallback
    }),
    [
      locale,
      bundle,
      normalizedMessages,
      fallbackLocale,
      fallbackBundle,
      resolvedFallbackBundles,
      timeZone,
      now,
      stableFunctions,
      defaultTranslationValues,
      debug,
      strictNamespace,
      formats,
      onError,
      getMessageFallback
    ]
  );
  return React.createElement(FluentContext.Provider, { value }, children);
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
function useMessages() {
  const context = useContext(FluentContext);
  return context.messages;
}
function useFormatter() {
  const locale = useLocale();
  const timeZone = useTimeZone();
  const context = useContext(FluentContext);
  const formats = context.formats;
  return useMemo(
    () => createFormatter({ locale, timeZone, formats }),
    [locale, timeZone, formats]
  );
}
function useNow(options) {
  const context = useContext(FluentContext);
  const contextNow = context.now;
  const [now, setNow] = useState(() => contextNow ?? STATIC_NOW);
  const interval = options?.updateInterval;
  useEffect(() => {
    if (contextNow) {
      setNow(contextNow);
    } else {
      setNow(/* @__PURE__ */ new Date());
    }
  }, [contextNow]);
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
      defaultTranslationValues: context.defaultTranslationValues,
      strictNamespace: context.strictNamespace,
      onError: context.onError,
      getMessageFallback: context.getMessageFallback
    }),
    [
      context.bundle,
      context.fallbackBundle,
      context.fallbackBundles,
      namespace,
      context.debug,
      context.defaultTranslationValues,
      context.strictNamespace,
      context.onError,
      context.getMessageFallback
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
    return React.createElement(Component, { className }, content);
  }
  if (className) {
    return React.createElement("span", { className }, content);
  }
  return content;
}
const LocalizedLink = forwardRef(
  function LocalizedLink2({ navConfig, href, locale: propLocale, forcePrefix, ...rest }, ref) {
    const currentLocale = useLocale();
    const targetLocale = propLocale ?? currentLocale ?? navConfig.defaultLocale;
    const localizedHref = switchLocaleHref(
      resolveLocalizedPathname({ href, locale: targetLocale, forcePrefix }, navConfig),
      propLocale,
      navConfig
    );
    return React.createElement(NextLink, {
      ...rest,
      href: localizedHref,
      // With an explicit locale the href can differ from the one the visitor is
      // on, and the middleware settles it with a redirect — prefetching that
      // would fetch a page nobody lands on. A forced prefix is already
      // unambiguous, so it prefetches like `always` does.
      prefetch: propLocale && !forcePrefix && domainLocalePrefix(
        navConfig.locales,
        navConfig.localePrefix,
        findLocaleDomain(navConfig.domains, targetLocale)
      ).mode !== "always" ? false : rest.prefetch,
      ref
    });
  }
);
LocalizedLink.displayName = "LocalizedLink";
export {
  FluentProvider,
  FormattedMessage,
  LocalizedLink,
  createFormatter,
  useFormatter,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  useTranslations
};
