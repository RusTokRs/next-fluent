"use client";
import React, { createContext, forwardRef, useContext, useEffect, useMemo, useState } from "react";
import NextLink from "next/link.js";
import { createFluentBundle, createTranslator } from "./bundle.js";
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
  const messagesKey = useMemo(
    () => typeof messages === "string" || Array.isArray(messages) ? computeSourceHash(messages) : null,
    [messages]
  );
  const fallbackMessagesKey = useMemo(
    () => typeof fallbackMessages === "string" || Array.isArray(fallbackMessages) ? computeSourceHash(fallbackMessages) : null,
    [fallbackMessages]
  );
  const bundleIdentity = messagesKey ?? messages;
  const fallbackBundleIdentity = fallbackMessagesKey ?? fallbackMessages;
  const bundle = useMemo(() => {
    if (!messages) return null;
    if (typeof messages === "string" || Array.isArray(messages)) {
      return createFluentBundle(locale, messages, { functions, useIsolating });
    }
    return messages;
  }, [locale, bundleIdentity, functions, useIsolating]);
  const fallbackBundle = useMemo(() => {
    if (!fallbackMessages) return null;
    const fLocale = fallbackLocale || "en";
    if (typeof fallbackMessages === "string" || Array.isArray(fallbackMessages)) {
      return createFluentBundle(fLocale, fallbackMessages, { functions, useIsolating });
    }
    return fallbackMessages;
  }, [fallbackLocale, fallbackBundleIdentity, functions, useIsolating]);
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
      messages: typeof messages === "string" || Array.isArray(messages) ? messages : void 0,
      fallbackLocale,
      fallbackBundle,
      fallbackBundles: resolvedFallbackBundles,
      timeZone,
      now,
      functions,
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
      messages,
      fallbackLocale,
      fallbackBundle,
      resolvedFallbackBundles,
      timeZone,
      now,
      functions,
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
  function LocalizedLink2({ navConfig, href, locale: propLocale, ...rest }, ref) {
    const currentLocale = useLocale();
    const targetLocale = propLocale ?? currentLocale ?? navConfig.defaultLocale;
    const localizedHref = switchLocaleHref(
      resolveLocalizedPathname({ href, locale: targetLocale }, navConfig),
      propLocale,
      navConfig
    );
    return React.createElement(NextLink, {
      ...rest,
      href: localizedHref,
      prefetch: propLocale && navConfig.localePrefix !== "always" ? false : rest.prefetch,
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
