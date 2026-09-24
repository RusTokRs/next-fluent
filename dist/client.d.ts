import React from 'react';
import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type { DefaultKey, FormattedMessageProps, Formatter, NamespaceArgs, NamespaceKeys, RichTranslationValues, Translations } from './types';
import { createFormatter } from './formatter';
export type { FormattedMessageProps };
export { createFormatter };
interface FluentContextValue {
    locale: string;
    bundle: FluentBundle | null;
    fallbackLocale?: string;
    fallbackBundle: FluentBundle | null;
    fallbackBundles?: readonly FluentBundle[];
    timeZone?: string;
    now?: Date;
    functions?: Record<string, FluentFunction>;
    defaultTranslationValues?: RichTranslationValues;
    debug?: boolean;
}
export interface FluentProviderProps {
    locale: string;
    messages: string | readonly string[] | FluentBundle;
    fallbackLocale?: string;
    fallbackMessages?: string | readonly string[] | FluentBundle;
    fallbackBundles?: FluentBundle | readonly FluentBundle[];
    timeZone?: string;
    now?: Date;
    functions?: Record<string, FluentFunction>;
    defaultTranslationValues?: RichTranslationValues;
    debug?: boolean;
    children: React.ReactNode;
}
export declare function FluentProvider({ locale, messages, fallbackLocale, fallbackMessages, fallbackBundles, timeZone, now, functions, defaultTranslationValues, debug, children, }: FluentProviderProps): React.FunctionComponentElement<React.ProviderProps<FluentContextValue>>;
export declare function useLocale(): string;
export declare function useTimeZone(): string;
export declare function useFormatter(): Formatter;
export declare function useNow(options?: {
    updateInterval?: number;
}): Date;
export declare function useTranslations<Namespace extends string>(namespace: Namespace): Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>;
export declare function useTranslations(): Translations;
export declare function FormattedMessage<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = Record<string, any>>({ id, args, values, fallback, className, as: Component, }: FormattedMessageProps<Key, ArgsMap>): React.ReactNode;
