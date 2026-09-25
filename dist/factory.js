import { createI18nMiddleware } from "./middleware.js";
import { createFormatter } from "./formatter.js";
import { createNavigation } from "./navigation.js";
import { forLocale, getLocale } from "./server.js";
import { validateI18nConfig } from "./utils.js";
function createI18n(config) {
  validateI18nConfig(config);
  const middlewareFn = createI18nMiddleware(config);
  const requestConfig = config.loadMessages ? async ({ locale }) => {
    const target = locale ?? config.defaultLocale;
    const msgs = await config.loadMessages(target);
    return {
      locale: target,
      messages: msgs
    };
  } : void 0;
  const serverOptions = {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    headerName: config.headerName,
    cookieName: config.cookieName
  };
  const navigationInstance = createNavigation({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
    pathnames: config.pathnames,
    domains: config.domains,
    basePath: config.basePath
  });
  return {
    config,
    middleware: middlewareFn,
    navigation: navigationInstance,
    getLocale: () => getLocale(serverOptions),
    getTranslations: async (options) => {
      const explicitLocale = typeof options === "object" && options ? options.locale : void 0;
      const locale = explicitLocale ?? await getLocale(serverOptions);
      return forLocale(locale, typeof options === "string" ? { namespace: options, requestConfig } : { ...options, requestConfig });
    },
    forLocale: (locale, options) => {
      return forLocale(locale, typeof options === "string" ? { namespace: options, requestConfig } : { ...options, requestConfig });
    },
    getMessages: async (locale) => {
      const targetLocale = locale ?? await getLocale(serverOptions);
      if (config.loadMessages) {
        return config.loadMessages(targetLocale);
      }
      return "";
    },
    getFormatter: async (options) => {
      const locale = options?.locale ?? await getLocale(serverOptions);
      return createFormatter({ locale, timeZone: options?.timeZone });
    },
    getStaticParams: () => {
      return config.locales.map((locale) => ({ locale }));
    }
  };
}
export {
  createI18n
};
