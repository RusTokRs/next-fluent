import { cache } from "react";
import { createFluentBundle, createTranslator } from "./bundle.js";
import { isJsonCatalog, toFluentSource } from "./catalog.js";
import { createFormatter } from "./formatter.js";
import { canonicalizeLocale, matchSupportedLocale, resolveAcceptLanguage } from "./utils.js";
let globalConfigFn = null;
let globalLocales = ["en"];
let globalDefaultLocale = "en";
let globalLocalesConfigured = false;
function configureServerI18n(config) {
  if (config.locales && config.locales.length > 0) {
    globalLocales = config.locales;
    globalLocalesConfigured = true;
  }
  if (config.defaultLocale) {
    globalDefaultLocale = config.defaultLocale;
  }
}
function setRequestConfig(fn) {
  globalConfigFn = fn;
  return fn;
}
function getRequestConfig() {
  return globalConfigFn;
}
const getRequestStore = cache(() => ({
  bundles: /* @__PURE__ */ new Map()
}));
function isRequestScopeActive() {
  return getRequestStore() === getRequestStore();
}
function setRequestLocale(locale, locales) {
  const canonical = canonicalizeLocale(locale);
  if (!canonical) throw new Error("[next-fluent] Invalid request locale.");
  const allowed = locales ?? (globalLocalesConfigured ? globalLocales : void 0);
  const matched = allowed ? matchSupportedLocale(canonical, allowed) : canonical;
  if (!matched) throw new Error(`[next-fluent] Unsupported request locale: ${canonical}`);
  if (!isRequestScopeActive()) {
    const message = `[next-fluent] setRequestLocale("${canonical}") was called outside a request scope, so the locale cannot be stored. Call it while rendering a page, layout, generateMetadata or generateStaticParams entry \u2014 not at module scope.`;
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      throw new Error(message);
    }
    console.warn(message);
    return;
  }
  getRequestStore().locale = matched;
}
async function getLocale(options) {
  const store = getRequestStore();
  if (store.locale) {
    const allowed = options?.locales ?? globalLocales;
    const matched = matchSupportedLocale(store.locale, allowed);
    if (matched) return matched;
    if (options?.locales) throw new Error(`[next-fluent] Unsupported request locale: ${store.locale}`);
    return store.locale;
  }
  const allowedLocales = options?.locales && options.locales.length > 0 ? options.locales : globalLocalesConfigured && globalLocales.length > 0 ? globalLocales : void 0;
  const defLocale = options?.defaultLocale ?? globalDefaultLocale;
  const headerKey = options?.headerName ?? "x-next-locale";
  const cookieList = options?.cookieNames ?? [
    ...options?.cookieName ? [options.cookieName] : [],
    "NEXT_LOCALE"
  ];
  try {
    const { headers, cookies } = await import("next/headers.js").catch(() => import("next/headers"));
    const headerStore = await headers();
    const cookieStore = await cookies();
    const rawHeader = headerStore.get(headerKey);
    if (allowedLocales) {
      const validHeaderLocale = matchSupportedLocale(rawHeader, allowedLocales);
      if (validHeaderLocale) {
        store.locale = validHeaderLocale;
        return validHeaderLocale;
      }
    } else if (rawHeader) {
      const canonical = canonicalizeLocale(rawHeader);
      if (canonical) {
        store.locale = canonical;
        return canonical;
      }
    }
    for (const cName of cookieList) {
      const cVal = cookieStore.get(cName)?.value;
      if (allowedLocales) {
        const validCookieLocale = matchSupportedLocale(cVal, allowedLocales);
        if (validCookieLocale) {
          store.locale = validCookieLocale;
          return validCookieLocale;
        }
      } else if (cVal) {
        const canonical = canonicalizeLocale(cVal);
        if (canonical) {
          store.locale = canonical;
          return canonical;
        }
      }
    }
    const acceptLang = headerStore.get("accept-language");
    if (acceptLang && allowedLocales) {
      const resolved = resolveAcceptLanguage(acceptLang, allowedLocales, defLocale);
      if (resolved) {
        store.locale = resolved;
        return resolved;
      }
    }
  } catch {
  }
  store.locale = defLocale;
  return defLocale;
}
async function resolveConfigFn() {
  if (globalConfigFn) return globalConfigFn;
  try {
    const mod = await import("next-fluent/config");
    const fn = mod.default ?? mod;
    if (typeof fn === "function") {
      globalConfigFn = fn;
      return fn;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingAlias = (/next-fluent\/config/.test(message) || message.includes("./config") && error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") && /not found|not exported|not defined|Cannot resolve|Can't resolve/i.test(message);
    if (!missingAlias) {
      throw new Error("[next-fluent] Failed to load request configuration.", { cause: error });
    }
  }
  return null;
}
const runConfigFn = cache(
  (fn, locale) => Promise.resolve().then(() => fn({ locale }))
);
async function loadConfig(locale, override) {
  const configFn = override ?? await resolveConfigFn();
  if (!configFn) return { locale, messages: "" };
  const result = await runConfigFn(configFn, locale);
  if (!result || typeof result.messages !== "string" && !Array.isArray(result.messages) && !isJsonCatalog(result.messages)) {
    throw new Error(
      "[next-fluent] Request config must return messages as FTL text, an array of FTL sources, or a JSON catalog object."
    );
  }
  if (result.locale && !canonicalizeLocale(result.locale)) {
    throw new Error("[next-fluent] Request config returned an invalid locale.");
  }
  if (!override) {
    const store = getRequestStore();
    store.defaultTranslationValues ??= result.defaultTranslationValues;
    store.timeZone ??= result.timeZone;
    store.now ??= result.now;
    store.formats ??= result.formats;
    store.useIsolating ??= result.useIsolating;
    store.onError ??= result.onError;
    store.getMessageFallback ??= result.getMessageFallback;
    store.strictNamespace ??= result.strictNamespace;
  }
  return result;
}
async function getMessages(localeArg) {
  const locale = localeArg ?? await getLocale();
  return (await loadConfig(locale)).messages;
}
async function getRequestConfigSnapshot(localeArg) {
  const requestedLocale = localeArg ?? await getLocale();
  const result = await loadConfig(requestedLocale);
  const store = getRequestStore();
  const locale = result.locale && canonicalizeLocale(result.locale) || requestedLocale;
  const timeZone = result.timeZone ?? store.timeZone ?? getTimeZone();
  const now = result.now ?? store.now ?? getNow();
  store.locale = locale;
  store.timeZone = timeZone;
  store.now = now;
  return { ...result, locale, timeZone, now };
}
function getTimeZone() {
  const store = getRequestStore();
  if (store.timeZone) return store.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function getNow() {
  const store = getRequestStore();
  store.now ??= /* @__PURE__ */ new Date();
  return store.now;
}
async function getFormatter(options) {
  const locale = options?.locale ?? await getLocale();
  const config = await loadConfig(locale);
  const store = getRequestStore();
  const timeZone = options?.timeZone ?? config.timeZone ?? store.timeZone ?? getTimeZone();
  return createFormatter({ locale, timeZone, formats: config.formats ?? store.formats });
}
function getStaticParams(locales) {
  const list = locales && locales.length > 0 ? locales : globalLocales;
  return list.map((locale) => ({ locale }));
}
async function getFormats() {
  const store = getRequestStore();
  if (store.formats) return store.formats;
  const locale = store.locale ?? globalDefaultLocale;
  const config = await loadConfig(locale);
  return config.formats ?? store.formats;
}
async function forLocale(locale, options) {
  let namespace;
  let fallbackLocale;
  let fallbackLocales;
  let fallbackMessages;
  let explicitMessages;
  let defaultTranslationValues;
  let debug = false;
  let strictNamespace;
  let customFunctions;
  let requestConfig;
  let useIsolating;
  let onError;
  let getMessageFallback;
  if (typeof options === "string") {
    namespace = options;
  } else if (options) {
    namespace = options.namespace;
    fallbackLocale = options.fallbackLocale;
    fallbackLocales = options.fallbackLocales;
    fallbackMessages = options.fallbackMessages;
    explicitMessages = options.messages;
    defaultTranslationValues = options.defaultTranslationValues;
    debug = options.debug ?? false;
    strictNamespace = options.strictNamespace;
    customFunctions = options.functions;
    requestConfig = options.requestConfig;
    useIsolating = options.useIsolating;
    onError = options.onError;
    getMessageFallback = options.getMessageFallback;
  }
  const store = getRequestStore();
  const config = explicitMessages !== void 0 ? void 0 : await loadConfig(locale, requestConfig);
  const effectiveLocale = config?.locale ?? locale;
  fallbackLocale ??= config?.fallbackLocale;
  fallbackMessages ??= config?.fallbackMessages;
  defaultTranslationValues ??= config?.defaultTranslationValues ?? store.defaultTranslationValues;
  strictNamespace ??= config?.strictNamespace ?? store.strictNamespace;
  useIsolating ??= config?.useIsolating ?? store.useIsolating;
  onError ??= config?.onError ?? store.onError;
  getMessageFallback ??= config?.getMessageFallback ?? store.getMessageFallback;
  const mergedFunctions = {
    ...config?.functions,
    ...customFunctions
  };
  const bundleSlot = `${effectiveLocale}|iso=${useIsolating ?? true}`;
  const bundleOptions = { functions: mergedFunctions, useIsolating };
  let bundle;
  if (explicitMessages !== void 0) {
    bundle = createFluentBundle(effectiveLocale, toFluentSource(explicitMessages), bundleOptions);
  } else {
    const hasCustomFuncs = Boolean(requestConfig || Object.keys(mergedFunctions).length > 0);
    let cached = hasCustomFuncs ? void 0 : store.bundles.get(bundleSlot);
    if (!cached) {
      cached = createFluentBundle(effectiveLocale, toFluentSource(config?.messages ?? ""), bundleOptions);
      if (!hasCustomFuncs) {
        store.bundles.set(bundleSlot, cached);
      }
    }
    bundle = cached;
  }
  const fallbackBundleList = [];
  if (fallbackMessages) {
    const fbLoc = fallbackLocale ?? "en";
    fallbackBundleList.push(
      createFluentBundle(fbLoc, toFluentSource(fallbackMessages), bundleOptions)
    );
  }
  const fallbacksToLoad = /* @__PURE__ */ new Set();
  if (fallbackLocale && fallbackLocale !== effectiveLocale && !fallbackMessages) {
    fallbacksToLoad.add(fallbackLocale);
  }
  if (fallbackLocales) {
    for (const fb of fallbackLocales) {
      if (fb && fb !== effectiveLocale) fallbacksToLoad.add(fb);
    }
  }
  if (fallbacksToLoad.size > 0) {
    for (const fbLocale of fallbacksToLoad) {
      const hasCustomFuncs = Boolean(requestConfig || Object.keys(mergedFunctions).length > 0);
      const fbSlot = `${fbLocale}|iso=${useIsolating ?? true}`;
      let fbBundle = hasCustomFuncs ? void 0 : store.bundles.get(fbSlot);
      if (!fbBundle) {
        const fbConfig = await loadConfig(fbLocale, requestConfig);
        const resolvedFallbackLocale = fbConfig.locale ?? fbLocale;
        fbBundle = createFluentBundle(resolvedFallbackLocale, toFluentSource(fbConfig.messages), {
          functions: { ...fbConfig.functions, ...mergedFunctions },
          useIsolating
        });
        if (!hasCustomFuncs) {
          store.bundles.set(fbSlot, fbBundle);
        }
      }
      fallbackBundleList.push(fbBundle);
    }
  }
  return createTranslator(bundle, {
    fallbackBundles: fallbackBundleList,
    namespace,
    debug,
    defaultTranslationValues,
    strictNamespace,
    onError,
    getMessageFallback
  });
}
async function getTranslations(options) {
  const explicitLocale = typeof options === "object" && options ? options.locale : void 0;
  const locale = explicitLocale ?? await getLocale();
  return forLocale(locale, options);
}
export {
  configureServerI18n,
  forLocale,
  getFormats,
  getFormatter,
  getLocale,
  getMessages,
  getNow,
  getRequestConfig,
  getRequestConfigSnapshot,
  getRequestStore,
  getStaticParams,
  getTimeZone,
  getTranslations,
  setRequestConfig,
  setRequestLocale
};
