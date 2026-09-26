import React from "react";
import { FluentProvider } from "./client.js";
import { getRequestConfigSnapshot } from "./server.js";
async function FluentServerProvider({ children, locale }) {
  const config = await getRequestConfigSnapshot(locale);
  const defaultTranslationValues = config.defaultTranslationValues ? Object.fromEntries(Object.entries(config.defaultTranslationValues).filter(
    ([, value]) => typeof value !== "function"
  )) : void 0;
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
    children
  });
}
export {
  FluentServerProvider
};
