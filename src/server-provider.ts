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
  return React.createElement(FluentProvider, {
    locale: config.locale,
    messages: config.messages,
    fallbackLocale: config.fallbackLocale,
    fallbackMessages: config.fallbackMessages,
    defaultTranslationValues,
    timeZone: config.timeZone,
    now: config.now,
    children,
  });
}
