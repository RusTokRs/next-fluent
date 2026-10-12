import React from "react";
import { FluentProvider } from "./client.js";
import { getRequestConfigSnapshot } from "./server.js";
async function FluentServerProvider({ children, locale }) {
  const config = await getRequestConfigSnapshot(locale);
  const defaultTranslationValues = config.defaultTranslationValues ? Object.fromEntries(Object.entries(config.defaultTranslationValues).filter(
    ([, value]) => typeof value !== "function"
  )) : void 0;
  const customFunctions = config.functions ? Object.keys(config.functions) : [];
  if (customFunctions.length > 0 && process.env.NODE_ENV !== "production") {
    console.warn(
      `[next-fluent] The request config defines Fluent function${customFunctions.length === 1 ? "" : "s"} ${customFunctions.map((name) => `"${name}"`).join(", ")}, which cannot cross the Server Component boundary. Messages that call them will not format in Client Components. Define them on a \`<FluentProvider functions={\u2026}>\` inside a \`'use client'\` wrapper as well.`
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
    children
  });
}
export {
  FluentServerProvider
};
