import { cache } from 'react';
import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type {
  DefaultKey,
  Formatter,
  FluentMessages,
  GetTranslationsOptions,
  RequestConfigFn,
  RequestConfigResult,
  RichTranslationValues,
  Translations,
  NamespaceArgs,
  NamespaceKeys,
} from './types';
import { createFluentBundle, createTranslator } from './bundle';
import { createFormatter } from './formatter';
import { canonicalizeLocale, matchSupportedLocale, resolveAcceptLanguage } from './utils';

let globalConfigFn: RequestConfigFn | null = null;
let globalLocales: readonly string[] = ['en'];
let globalDefaultLocale: string = 'en';
let globalLocalesConfigured = false;

export interface ServerI18nOptions {
  locales?: readonly string[];
  defaultLocale?: string;
  cookieName?: string;
  cookieNames?: readonly string[];
  headerName?: string;
}

export function configureServerI18n(config: {
  locales?: readonly string[];
  defaultLocale?: string;
}): void {
  if (config.locales && config.locales.length > 0) {
    globalLocales = config.locales;
    globalLocalesConfigured = true;
  }
  if (config.defaultLocale) {
    globalDefaultLocale = config.defaultLocale;
  }
}

export function setRequestConfig(fn: RequestConfigFn): RequestConfigFn {
  globalConfigFn = fn;
  return fn;
}

export function getRequestConfig(): RequestConfigFn | null {
  return globalConfigFn;
}

interface RequestStore {
  locale?: string;
  timeZone?: string;
  now?: Date;
  defaultTranslationValues?: RichTranslationValues;
  functions?: Record<string, FluentFunction>;
  bundles: Map<string, FluentBundle>;
  configs: Map<string, Promise<RequestConfigResult>>;
}

export const getRequestStore = cache((): RequestStore => ({
  bundles: new Map(),
  configs: new Map(),
}));

export function setRequestLocale(locale: string, locales?: readonly string[]): void {
  const canonical = canonicalizeLocale(locale);
  if (!canonical) throw new Error('[next-fluent] Invalid request locale.');
  const allowed = locales ?? (globalLocalesConfigured ? globalLocales : undefined);
  const matched = allowed ? matchSupportedLocale(canonical, allowed) : canonical;
  if (!matched) throw new Error(`[next-fluent] Unsupported request locale: ${canonical}`);
  getRequestStore().locale = matched;
}

export async function getLocale(options?: ServerI18nOptions): Promise<string> {
  const store = getRequestStore();
  if (store.locale) {
    const allowed = options?.locales ?? globalLocales;
    const matched = matchSupportedLocale(store.locale, allowed);
    if (matched) return matched;
    if (options?.locales) throw new Error(`[next-fluent] Unsupported request locale: ${store.locale}`);
    return store.locale;
  }

  const allowedLocales =
    options?.locales && options.locales.length > 0
      ? options.locales
      : globalLocalesConfigured && globalLocales.length > 0
        ? globalLocales
        : undefined;

  const defLocale = options?.defaultLocale ?? globalDefaultLocale;
  const headerKey = options?.headerName ?? 'x-next-locale';
  const cookieList = options?.cookieNames ?? [
    ...(options?.cookieName ? [options.cookieName] : []),
    'NEXT_LOCALE',
  ];

  try {
    const { headers, cookies }: any = await import('next/headers.js').catch(() => import('next/headers'));
    const headerStore = await headers();
    const cookieStore = await cookies();

    // 1. Primary effective header with allow-list validation
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

    // 2. Cookies with allow-list validation
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

    // 3. Accept-Language with allow-list negotiation
    const acceptLang = headerStore.get('accept-language');
    if (acceptLang && allowedLocales) {
      const resolved = resolveAcceptLanguage(acceptLang, allowedLocales);
      if (resolved) {
        store.locale = resolved;
        return resolved;
      }
    }
  } catch {
    // Outside request context (e.g. build time or static export)
  }

  store.locale = defLocale;
  return defLocale;
}

async function resolveConfigFn(): Promise<RequestConfigFn | null> {
  if (globalConfigFn) return globalConfigFn;

  try {
    // Dynamically attempt to load plugin-aliased configuration if present
    // @ts-expect-error Virtual alias created by next-fluent plugin
    const mod = await import('next-fluent/config');
    const fn = mod.default ?? mod;
    if (typeof fn === 'function') {
      globalConfigFn = fn;
      return fn;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingAlias = (
      /next-fluent\/config/.test(message) ||
      (message.includes('./config') && (error as { code?: string })?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
    ) && /not found|not exported|not defined|Cannot resolve|Can't resolve/i.test(message);
    if (!missingAlias) {
      throw new Error('[next-fluent] Failed to load request configuration.', { cause: error });
    }
  }

  return null;
}

async function loadConfig(locale: string, override?: RequestConfigFn): Promise<RequestConfigResult> {
  const configFn = override ?? await resolveConfigFn();
  if (!configFn) return { locale, messages: '' };
  const store = getRequestStore();
  let pending = override ? undefined : store.configs.get(locale);
  if (!pending) {
    pending = Promise.resolve().then(() => configFn({ locale }));
    if (!override) store.configs.set(locale, pending);
  }
  let result: RequestConfigResult;
  try {
    result = await pending;
  } catch (error) {
    if (!override) store.configs.delete(locale);
    throw error;
  }
  if (!result || !Array.isArray(result.messages) && typeof result.messages !== 'string') {
    throw new Error('[next-fluent] Request config must return messages as FTL text or an array.');
  }
  if (result.locale && !canonicalizeLocale(result.locale)) {
    throw new Error('[next-fluent] Request config returned an invalid locale.');
  }
  store.defaultTranslationValues ??= result.defaultTranslationValues;
  store.timeZone ??= result.timeZone;
  store.now ??= result.now;
  store.functions ??= result.functions;
  return result;
}

export async function getMessages(localeArg?: string): Promise<string | readonly string[]> {
  const locale = localeArg ?? (await getLocale());
  return (await loadConfig(locale)).messages;
}

export async function getRequestConfigSnapshot(localeArg?: string): Promise<RequestConfigResult & {
  locale: string;
  timeZone: string;
  now: Date;
}> {
  const requestedLocale = localeArg ?? (await getLocale());
  const result = await loadConfig(requestedLocale);
  const store = getRequestStore();
  const locale = result.locale ?? requestedLocale;
  const timeZone = result.timeZone ?? store.timeZone ?? getTimeZone();
  const now = result.now ?? store.now ?? getNow();
  store.locale = locale;
  store.timeZone = timeZone;
  store.now = now;
  return { ...result, locale, timeZone, now };
}

export function getTimeZone(): string {
  const store = getRequestStore();
  if (store.timeZone) return store.timeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function getNow(): Date {
  const store = getRequestStore();
  store.now ??= new Date();
  return store.now;
}

export async function getFormatter(options?: {
  locale?: string;
  timeZone?: string;
}): Promise<Formatter> {
  const locale = options?.locale ?? (await getLocale());
  if (!options?.timeZone) await loadConfig(locale);
  const store = getRequestStore();
  const timeZone = options?.timeZone ?? store.timeZone ?? getTimeZone();
  return createFormatter({ locale, timeZone });
}

export function getStaticParams(locales?: readonly string[]): { locale: string }[] {
  const list = locales && locales.length > 0 ? locales : globalLocales;
  return list.map((locale) => ({ locale }));
}

export interface ForLocaleOptions {
  messages?: string | readonly string[];
  fallbackLocale?: string;
  fallbackLocales?: readonly string[];
  fallbackMessages?: string | readonly string[];
  defaultTranslationValues?: RichTranslationValues;
  namespace?: string;
  debug?: boolean;
  strictNamespace?: boolean;
  functions?: Record<string, FluentFunction>;
  /** Instance-scoped request loader used by createI18n. */
  requestConfig?: RequestConfigFn;
}

export function forLocale<Namespace extends string>(
  locale: string,
  namespace: Namespace
): Promise<Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>>;
export function forLocale<
  Key extends string = DefaultKey,
  ArgsMap extends Record<string, any> = FluentMessages
>(
  locale: string,
  options?: string | ForLocaleOptions
): Promise<Translations<Key, ArgsMap>>;
export async function forLocale(
  locale: string,
  options?: string | ForLocaleOptions
): Promise<Translations> {
  let namespace: string | undefined;
  let fallbackLocale: string | undefined;
  let fallbackLocales: readonly string[] | undefined;
  let fallbackMessages: string | readonly string[] | undefined;
  let explicitMessages: string | readonly string[] | undefined;
  let defaultTranslationValues: RichTranslationValues | undefined;
  let debug = false;
  let strictNamespace: boolean | undefined;
  let customFunctions: Record<string, FluentFunction> | undefined;
  let requestConfig: RequestConfigFn | undefined;

  if (typeof options === 'string') {
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
  }

  const store = getRequestStore();
  const config = explicitMessages !== undefined
    ? undefined
    : await loadConfig(locale, requestConfig);
  const effectiveLocale = config?.locale ?? locale;
  fallbackLocale ??= config?.fallbackLocale;
  fallbackMessages ??= config?.fallbackMessages;
  defaultTranslationValues ??= config?.defaultTranslationValues ?? store.defaultTranslationValues;
  const mergedFunctions = {
    ...config?.functions,
    ...store.functions,
    ...customFunctions,
  };

  let bundle: FluentBundle;
  if (explicitMessages !== undefined) {
    bundle = createFluentBundle(effectiveLocale, explicitMessages, { functions: mergedFunctions });
  } else {
    const hasCustomFuncs = Boolean(requestConfig || Object.keys(mergedFunctions).length > 0);
    let cached = hasCustomFuncs ? undefined : store.bundles.get(effectiveLocale);
    if (!cached) {
      cached = createFluentBundle(effectiveLocale, config?.messages ?? '', { functions: mergedFunctions });
      if (!hasCustomFuncs) {
        store.bundles.set(effectiveLocale, cached);
      }
    }
    bundle = cached;
  }

  const fallbackBundleList: FluentBundle[] = [];

  // 1. Explicit fallback messages
  if (fallbackMessages) {
    const fbLoc = fallbackLocale ?? 'en';
    fallbackBundleList.push(
      createFluentBundle(fbLoc, fallbackMessages, { functions: mergedFunctions })
    );
  }

  // 2. Fallback locales from request/config
  const fallbacksToLoad = new Set<string>();
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
      let fbBundle = hasCustomFuncs ? undefined : store.bundles.get(fbLocale);
      if (!fbBundle) {
        const fbConfig = await loadConfig(fbLocale, requestConfig);
        const resolvedFallbackLocale = fbConfig.locale ?? fbLocale;
        fbBundle = createFluentBundle(resolvedFallbackLocale, fbConfig.messages, {
          functions: { ...fbConfig.functions, ...mergedFunctions },
        });
        if (!hasCustomFuncs) {
          store.bundles.set(fbLocale, fbBundle);
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
  }) as Translations;
}

export function getTranslations<Namespace extends string>(
  namespace: Namespace
): Promise<Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>>;
export function getTranslations<
  Key extends string = DefaultKey,
  ArgsMap extends Record<string, any> = FluentMessages
>(
  options?: string | ({ locale?: string } & GetTranslationsOptions)
): Promise<Translations<Key, ArgsMap>>;
export async function getTranslations(
  options?: string | ({ locale?: string } & GetTranslationsOptions)
): Promise<Translations> {
  const explicitLocale = typeof options === 'object' && options ? options.locale : undefined;
  const locale = explicitLocale ?? (await getLocale());
  return forLocale(locale, options);
}
