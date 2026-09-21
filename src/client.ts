'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { FluentBundle } from '@fluent/bundle';
import type {
  FormattedMessageProps,
  Formatter,
  RichTranslationValues,
  Translations,
} from './types';
import { createFluentBundle, createTranslator } from './bundle';
import { createFormatter } from './formatter';

export type { FormattedMessageProps };
export { createFormatter };

interface FluentContextValue {
  locale: string;
  bundle: FluentBundle | null;
  fallbackLocale?: string;
  fallbackBundle: FluentBundle | null;
  fallbackBundles?: readonly FluentBundle[];
  timeZone?: string;
  defaultTranslationValues?: RichTranslationValues;
  debug?: boolean;
}

const FluentContext = createContext<FluentContextValue>({
  locale: 'en',
  bundle: null,
  fallbackBundle: null,
  debug: false,
});

export interface FluentProviderProps {
  locale: string;
  messages: string | readonly string[] | FluentBundle;
  fallbackLocale?: string;
  fallbackMessages?: string | readonly string[] | FluentBundle;
  fallbackBundles?: FluentBundle | readonly FluentBundle[];
  timeZone?: string;
  defaultTranslationValues?: RichTranslationValues;
  debug?: boolean;
  children: React.ReactNode;
}

export function FluentProvider({
  locale,
  messages,
  fallbackLocale,
  fallbackMessages,
  fallbackBundles,
  timeZone,
  defaultTranslationValues,
  debug,
  children,
}: FluentProviderProps) {
  const messagesKey =
    typeof messages === 'string'
      ? messages
      : Array.isArray(messages)
        ? messages.join('\u0000')
        : null;

  const fallbackMessagesKey =
    typeof fallbackMessages === 'string'
      ? fallbackMessages
      : Array.isArray(fallbackMessages)
        ? fallbackMessages.join('\u0000')
        : null;

  const bundle = useMemo<FluentBundle | null>(() => {
    if (!messages) return null;
    if (typeof messages === 'string' || Array.isArray(messages)) {
      return createFluentBundle(locale, messages);
    }
    return messages as FluentBundle;
  }, [locale, messagesKey ?? messages]);

  const fallbackBundle = useMemo<FluentBundle | null>(() => {
    if (!fallbackMessages) return null;
    const fLocale = fallbackLocale || 'en';
    if (typeof fallbackMessages === 'string' || Array.isArray(fallbackMessages)) {
      return createFluentBundle(fLocale, fallbackMessages);
    }
    return fallbackMessages as FluentBundle;
  }, [fallbackLocale, fallbackMessagesKey ?? fallbackMessages]);

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
      fallbackLocale,
      fallbackBundle,
      fallbackBundles: resolvedFallbackBundles,
      timeZone,
      defaultTranslationValues,
      debug,
    }),
    [
      locale,
      bundle,
      fallbackLocale,
      fallbackBundle,
      resolvedFallbackBundles,
      timeZone,
      defaultTranslationValues,
      debug,
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

export function useFormatter(): Formatter {
  const locale = useLocale();
  const timeZone = useTimeZone();
  return useMemo(() => createFormatter({ locale, timeZone }), [locale, timeZone]);
}

export function useNow(options?: { updateInterval?: number }): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  const interval = options?.updateInterval;

  useEffect(() => {
    if (!interval || interval <= 0) return;
    const timer = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [interval]);

  return now;
}

export function useTranslations<
  Key extends string = string,
  ArgsMap extends Record<string, any> = Record<string, any>
>(namespace?: string): Translations<Key, ArgsMap> {
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
      }) as unknown as Translations<Key, ArgsMap>,
    [
      context.bundle,
      context.fallbackBundle,
      context.fallbackBundles,
      namespace,
      context.debug,
      context.defaultTranslationValues,
    ]
  );
}

export function FormattedMessage<
  Key extends string = string,
  ArgsMap extends Record<string, any> = Record<string, any>
>({
  id,
  args,
  values,
  fallback,
  className,
  as: Component,
}: FormattedMessageProps<Key, ArgsMap>): React.ReactNode {
  const t = useTranslations<Key, ArgsMap>();

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
