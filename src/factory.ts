import type {
  Formatter,
  GetTranslationsOptions,
  I18nConfig,
  Navigation,
  Translations,
} from './types';
import { createI18nMiddleware, type NextMiddlewareRequestLike } from './middleware';
import { createFormatter } from './formatter';
import { createNavigation } from './navigation';
import { forLocale, getLocale, setRequestConfig } from './server';
import { validateI18nConfig } from './utils';

export interface I18nRuntime {
  readonly config: I18nConfig;
  readonly middleware: (request: NextMiddlewareRequestLike) => Promise<any>;
  readonly getLocale: () => Promise<string>;
  readonly getTranslations: (options?: string | GetTranslationsOptions) => Promise<Translations>;
  readonly forLocale: (
    locale: string,
    options?: string | { namespace?: string; fallbackLocale?: string; fallbackLocales?: readonly string[]; debug?: boolean }
  ) => Promise<Translations>;
  readonly getMessages: (locale?: string) => Promise<string | readonly string[]>;
  readonly getFormatter: (options?: { locale?: string; timeZone?: string }) => Promise<Formatter>;
  readonly getStaticParams: () => { locale: string }[];
  readonly navigation: Navigation<any>;
}

export function createI18n(config: I18nConfig): I18nRuntime {
  validateI18nConfig(config);

  const middlewareFn = createI18nMiddleware(config);

  if (config.loadMessages) {
    const loader = config.loadMessages;
    setRequestConfig(async ({ locale }) => {
      const target = locale ?? config.defaultLocale;
      const msgs = await loader(target);
      return {
        locale: target,
        messages: msgs,
      };
    });
  }

  const serverOptions = {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    headerName: config.headerName,
    cookieName: config.cookieName,
  };

  const navigationInstance = createNavigation({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
    pathnames: config.pathnames,
  });

  return {
    config,
    middleware: middlewareFn,
    navigation: navigationInstance,
    getLocale: () => getLocale(serverOptions),
    getTranslations: async (options?: string | GetTranslationsOptions) => {
      const explicitLocale = typeof options === 'object' && options ? options.locale : undefined;
      const locale = explicitLocale ?? (await getLocale(serverOptions));
      return forLocale(locale, options);
    },
    forLocale: (
      locale: string,
      options?: string | { namespace?: string; fallbackLocale?: string; fallbackLocales?: readonly string[]; debug?: boolean }
    ) => {
      return forLocale(locale, options);
    },
    getMessages: async (locale?: string) => {
      const targetLocale = locale ?? (await getLocale(serverOptions));
      if (config.loadMessages) {
        return config.loadMessages(targetLocale);
      }
      return '';
    },
    getFormatter: async (options?: { locale?: string; timeZone?: string }) => {
      const locale = options?.locale ?? (await getLocale(serverOptions));
      return createFormatter({ locale, timeZone: options?.timeZone });
    },
    getStaticParams: () => {
      return config.locales.map((locale) => ({ locale }));
    },
  };
}
