import React from "react";
import { FluentProvider } from "./client.js";
import { getRequestConfigSnapshot } from "./server.js";
async function FluentServerProvider({ children, locale }) {
  const config = await getRequestConfigSnapshot(locale);
  const defaultTranslationValues = config.defaultTranslationValues ? Object.fromEntries(Object.entries(config.defaultTranslationValues).filter(
    ([, value]) => typeof value !== "function"
  )) : void 0;
  const dropped = [];
  const quote = (names) => names.map((name) => `"${name}"`).join(", ");
  const functionNames = Object.keys(config.functions ?? {});
  if (functionNames.length > 0) {
    dropped.push(`Fluent function${functionNames.length === 1 ? "" : "s"} ${quote(functionNames)}`);
  }
  const callbackValues = Object.entries(config.defaultTranslationValues ?? {}).filter(([, value]) => typeof value === "function").map(([name]) => name);
  if (callbackValues.length > 0) {
    dropped.push(`callback defaultTranslationValues ${quote(callbackValues)}`);
  }
  if (typeof config.onError === "function") dropped.push("`onError`");
  if (typeof config.getMessageFallback === "function") dropped.push("`getMessageFallback`");
  if (dropped.length > 0 && process.env.NODE_ENV !== "production") {
    const joined = dropped.length === 1 ? dropped[0] : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
    console.warn(
      `[next-fluent] <FluentServerProvider> cannot forward ${joined}: a function is code, so it cannot cross the Server Component boundary. Client Components will not format these messages the way the server does. Define them on a \`<FluentProvider \u2026>\` inside a \`'use client'\` wrapper as well.`
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
