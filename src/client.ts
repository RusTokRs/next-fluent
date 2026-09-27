'use client';

import React, { createContext, forwardRef, useContext, useEffect, useMemo, useState } from 'react';
import NextLink from 'next/link.js';
import { domainLocalePrefix, findLocaleDomain } from './domain-routing';
import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type {
  DefaultKey,
  FormattedMessageProps,
  Formatter,
  Formats,
  GetMessageFallbackFn,
  NamespaceArgs,
  NamespaceKeys,
  OnErrorFn,
  RichTranslationValues,
  Translations,
} from './types';
import { createFluentBundle, createTranslator } from './bundle';
import { isJsonCatalog, jsonToFluent, type MessageSource } from './catalog';
import { createFormatter } from './formatter';
import { computeSourceHash } from './cache';
import { resolveLocalizedPathname, switchLocaleHref } from './nav-url';
import type { NavigationConfig } from './types';

export type { FormattedMessageProps };
export { createFormatter };

interface FluentContextValue {
  locale: string;
  bundle: FluentBundle | null;
  messages?: MessageSource;
  fallbackLocale?: string;
  fallbackBundle: FluentBundle | null;
  fallbackBundles?: readonly FluentBundle[];
  timeZone?: string;
  now?: Date;
  functions?: Record<string, FluentFunction>;
  defaultTranslationValues?: RichTranslationValues;
  debug?: boolean;
  strictNamespace?: boolean;
  formats?: Formats;
  onError?: OnErrorFn;
  getMessageFallback?: GetMessageFallbackFn;
}

const FluentContext = createContext<FluentContextValue>({
  locale: 'en',
  bundle: null,
  fallbackBundle: null,
  debug: false,
});

/** Stable SSR/hydration fallback so `useNow()` never causes markup mismatch. */
const STATIC_NOW = new Date(0);

export interface FluentProviderProps {
  locale: string;
  /** FTL text, an array of FTL sources, a JSON catalog, or a `FluentBundle`. */
  messages: MessageSource | FluentBundle;
  fallbackLocale?: string;
  fallbackMessages?: MessageSource | FluentBundle;
  fallbackBundles?: FluentBundle | readonly FluentBundle[];
  timeZone?: string;
  now?: Date;
  functions?: Record<string, FluentFunction>;
  defaultTranslationValues?: RichTranslationValues;
  debug?: boolean;
  /** Only resolve `namespace.key` candidates (mirrors the server option). */
  strictNamespace?: boolean;
  /** Named `Intl` presets used by `useFormatter()`. */
  formats?: Formats;
  /** Disable Fluent's bidi isolates so `t()` is safe in non-HTML sinks. */
  useIsolating?: boolean;
  /** Client-side error reporting (define inside a `'use client'` wrapper). */
  onError?: OnErrorFn;
  /** Client-side fallback rendering (define inside a `'use client'` wrapper). */
  getMessageFallback?: GetMessageFallbackFn;
  children: React.ReactNode;
}

export function FluentProvider({
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
  children,
}: FluentProviderProps) {
  // JSON catalogs are converted once per payload change; everything else passes
  // through untouched (including pre-built bundles).
  const normalizedMessages = useMemo(
    () => (isJsonCatalog(messages) ? jsonToFluent(messages) : messages),
    [messages]
  );
  const normalizedFallbackMessages = useMemo(
    () => (isJsonCatalog(fallbackMessages) ? jsonToFluent(fallbackMessages) : fallbackMessages),
    [fallbackMessages]
  );

  // The hash is derived from `normalizedMessages`; the raw prop is only checked
  // for its shape, which cannot change without the normalized value changing.
  const messagesKey = useMemo(
    () =>
      typeof normalizedMessages === 'string' || Array.isArray(normalizedMessages)
        ? computeSourceHash(normalizedMessages as string | readonly string[])
        : null,
    [normalizedMessages]
  );

  const fallbackMessagesKey = useMemo(
    () =>
      typeof normalizedFallbackMessages === 'string' || Array.isArray(normalizedFallbackMessages)
        ? computeSourceHash(normalizedFallbackMessages as string | readonly string[])
        : null,
    [normalizedFallbackMessages]
  );

  // Bundles are keyed by a content hash, so an equal-but-new string reference
  // does not rebuild the catalog on every render.
  const bundleIdentity = messagesKey ?? normalizedMessages;
  const fallbackBundleIdentity = fallbackMessagesKey ?? normalizedFallbackMessages;

  const bundle = useMemo<FluentBundle | null>(() => {
    if (!normalizedMessages) return null;
    if (typeof normalizedMessages === 'string' || Array.isArray(normalizedMessages)) {
      return createFluentBundle(locale, normalizedMessages as string | readonly string[], { functions, useIsolating });
    }
    return normalizedMessages as FluentBundle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, bundleIdentity, functions, useIsolating]);

  const fallbackBundle = useMemo<FluentBundle | null>(() => {
    if (!normalizedFallbackMessages) return null;
    const fLocale = fallbackLocale || 'en';
    if (typeof normalizedFallbackMessages === 'string' || Array.isArray(normalizedFallbackMessages)) {
      return createFluentBundle(fLocale, normalizedFallbackMessages as string | readonly string[], { functions, useIsolating });
    }
    return normalizedFallbackMessages as FluentBundle;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackLocale, fallbackBundleIdentity, functions, useIsolating]);

  const resolvedFallbackBundles = useMemo<readonly FluentBundle[] | undefined>(() => {
    if (fallbackBundles) {
      return Array.isArray(fallbackBundles) ? fallbackBundles : [fallbackBundles];
    }
    if (fallbackBundle) {
      return [fallbackBundle];
    }
    return undefined;
  }, [fallbackBundles, fallbackBundle]);

  const value = useMemo(
    () => ({
      locale,
      bundle,
      messages:
        typeof normalizedMessages === 'string' || Array.isArray(normalizedMessages)
          ? (normalizedMessages as string | readonly string[])
          : undefined,
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
      getMessageFallback,
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
      functions,
      defaultTranslationValues,
      debug,
      strictNamespace,
      formats,
      onError,
      getMessageFallback,
    ]
  );

  return React.createElement(FluentContext.Provider, { value }, children);
}

export function useLocale(): string {
  const context = useContext(FluentContext);
  return context.locale;
}

export function useTimeZone(): string {
  const context = useContext(FluentContext);
  if (context.timeZone) {
    return context.timeZone;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Raw catalog (FTL text) provided to the current `FluentProvider`. */
export function useMessages(): MessageSource | undefined {
  const context = useContext(FluentContext);
  return context.messages;
}

export function useFormatter(): Formatter {
  const locale = useLocale();
  const timeZone = useTimeZone();
  const context = useContext(FluentContext);
  const formats = context.formats;
  return useMemo(
    () => createFormatter({ locale, timeZone, formats }),
    [locale, timeZone, formats]
  );
}

export function useNow(options?: { updateInterval?: number }): Date {
  const context = useContext(FluentContext);
  const contextNow = context.now;
  // A fixed, server/client-stable instant keeps hydration consistent. Without
  // a provider-supplied `now`, the live clock starts ticking after mount.
  const [now, setNow] = useState<Date>(() => contextNow ?? STATIC_NOW);
  const interval = options?.updateInterval;

  useEffect(() => {
    if (contextNow) {
      setNow(contextNow);
    } else {
      setNow(new Date());
    }
  }, [contextNow]);

  useEffect(() => {
    if (!interval || interval <= 0) return;
    const timer = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [interval]);

  return now;
}

export function useTranslations<Namespace extends string>(
  namespace: Namespace
): Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>;
export function useTranslations(): Translations;
export function useTranslations(namespace?: string): Translations {
  const context = useContext(FluentContext);
  return useMemo(
    () =>
      createTranslator(context.bundle, {
        fallbackBundles:
          context.fallbackBundles ??
          (context.fallbackBundle ? [context.fallbackBundle] : null),
        namespace,
        debug: context.debug,
        defaultTranslationValues: context.defaultTranslationValues,
        strictNamespace: context.strictNamespace,
        onError: context.onError,
        getMessageFallback: context.getMessageFallback,
      }) as Translations,
    [
      context.bundle,
      context.fallbackBundle,
      context.fallbackBundles,
      namespace,
      context.debug,
      context.defaultTranslationValues,
      context.strictNamespace,
      context.onError,
      context.getMessageFallback,
    ]
  );
}

export function FormattedMessage<
  Key extends string = DefaultKey,
  ArgsMap extends Record<string, any> = Record<string, any>
>({
  id,
  args,
  values,
  fallback,
  className,
  as: Component,
}: FormattedMessageProps<Key, ArgsMap>): React.ReactNode {
  const t = useTranslations() as Translations<Key, ArgsMap>;

  if (!t.has(id)) {
    if (fallback !== undefined) return fallback;
  }

  const combinedValues: RichTranslationValues = {
    ...(args as any),
    ...values,
  };

  const content = t.rich(id, combinedValues);

  if (Component) {
    return React.createElement(Component, { className }, content);
  }

  if (className) {
    return React.createElement('span', { className }, content);
  }

  return content;
}

/**
 * Locale-aware link body. It lives in the client entry so that `createNavigation`
 * can expose a hook-free wrapper that Server Components may render.
 */
export const LocalizedLink = forwardRef<HTMLAnchorElement, any>(
  function LocalizedLink({ navConfig, href, locale: propLocale, forcePrefix, ...rest }, ref) {
    const currentLocale = useLocale();
    const targetLocale = propLocale ?? currentLocale ?? (navConfig as NavigationConfig).defaultLocale;
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
      prefetch:
        propLocale && !forcePrefix && domainLocalePrefix(
          navConfig.locales, navConfig.localePrefix, findLocaleDomain(navConfig.domains, targetLocale)
        ).mode !== 'always'
          ? false
          : rest.prefetch,
      ref,
    });
  }
);
LocalizedLink.displayName = 'LocalizedLink';
