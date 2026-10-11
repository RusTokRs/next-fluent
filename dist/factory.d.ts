import type { Formatter, GetTranslationsOptions, I18nConfig, Navigation, Translations } from './types';
import { type NextMiddlewareRequestLike } from './middleware';
import { type ForLocaleOptions } from './server';
import type { MessageSource } from './catalog';
/**
 * Options accepted by `I18nRuntime.forLocale()`: everything the server entry
 * takes, minus the instance-scoped request loader the runtime supplies itself.
 */
export type RuntimeForLocaleOptions = Omit<ForLocaleOptions, 'requestConfig'>;
export interface I18nRuntime {
    readonly config: I18nConfig;
    readonly middleware: (request: NextMiddlewareRequestLike) => Promise<any>;
    readonly getLocale: () => Promise<string>;
    readonly getTranslations: (options?: string | GetTranslationsOptions) => Promise<Translations>;
    readonly forLocale: (locale: string, options?: string | RuntimeForLocaleOptions) => Promise<Translations>;
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
