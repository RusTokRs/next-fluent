import React from 'react';
import { FluentProvider } from './client.js';
import { getRequestConfigSnapshot } from './server.js';

export interface FluentServerProviderProps {
  children: React.ReactNode;
  locale?: string;
}

/** Loads one request snapshot and forwards its serializable values to the client boundary. */
export async function FluentServerProvider({ children, locale }: FluentServerProviderProps) {
  const config = await getRequestConfigSnapshot(locale);
  const defaultTranslationValues = config.defaultTranslationValues
    ? Object.fromEntries(Object.entries(config.defaultTranslationValues).filter(([, value]) =>
        typeof value !== 'function'
      ))
    : undefined;

  const customFunctions = config.functions ? Object.keys(config.functions) : [];
  if (customFunctions.length > 0 && process.env.NODE_ENV !== 'production') {
    // A Fluent function is code, so it cannot cross the RSC boundary — nothing
    // here could forward it even in principle. Left unsaid, the result is a page
    // where `t('price')` formats on the server and renders its own key in a
    // Client Component, with an error that names the missing function but not
    // why the server had it and the client did not.
    console.warn(
      `[next-fluent] The request config defines Fluent function${customFunctions.length === 1 ? '' : 's'} ` +
        `${customFunctions.map((name) => `"${name}"`).join(', ')}, which cannot cross the Server Component ` +
        'boundary. Messages that call them will not format in Client Components. Define them on a ' +
        '`<FluentProvider functions={…}>` inside a `\'use client\'` wrapper as well.'
    );
  }

  return React.createElement(FluentProvider, {
    locale: config.locale,
    messages: config.messages,
    fallbackLocale: config.fallbackLocale,
    fallbackMessages: config.fallbackMessages,
    defaultTranslationValues,
    timeZone: config.timeZone,
    now: config.now,
    // Only serializable config crosses the RSC boundary; `onError` /
    // `getMessageFallback` must be defined in a client component.
    formats: config.formats,
    useIsolating: config.useIsolating,
    strictNamespace: config.strictNamespace,
    children,
  });
}
