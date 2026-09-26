import type { Formatter, GetTranslationsOptions, I18nConfig, Navigation, Translations } from './types';
import { type NextMiddlewareRequestLike } from './middleware';
import type { MessageSource } from './catalog';
export interface I18nRuntime {
    readonly config: I18nConfig;
    readonly middleware: (request: NextMiddlewareRequestLike) => Promise<any>;
    readonly getLocale: () => Promise<string>;
    readonly getTranslations: (options?: string | GetTranslationsOptions) => Promise<Translations>;
    readonly forLocale: (locale: string, options?: string | {
        namespace?: string;
        fallbackLocale?: string;
        fallbackLocales?: readonly string[];
        debug?: boolean;
    }) => Promise<Translations>;
    readonly getMessages: (locale?: string) => Promise<MessageSource>;
    readonly getFormatter: (options?: {
        locale?: string;
        timeZone?: string;
    }) => Promise<Formatter>;
    readonly getStaticParams: () => {
        locale: string;
    }[];
    readonly navigation: Navigation<any>;
}
export declare function createI18n(config: I18nConfig): I18nRuntime;
