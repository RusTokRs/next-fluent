import React from 'react';
import type { FluentBundle, FluentFunction } from '@fluent/bundle';
import type { DefaultKey, FormattedMessageProps, Formatter, Formats, GetMessageFallbackFn, NamespaceArgs, NamespaceKeys, OnErrorFn, RichTranslationValues, Translations } from './types';
import { createFormatter } from './formatter';
export type { FormattedMessageProps };
export { createFormatter };
interface FluentContextValue {
    locale: string;
    bundle: FluentBundle | null;
    messages?: string | readonly string[];
    fallbackLocale?: string;
    fallbackBundle: FluentBundle | null;
    fallbackBundles?: readonly FluentBundle[];
    timeZone?: string;
    now?: Date;
    functions?: Record<string, FluentFunction>;
    defaultTranslationValues?: RichTranslationValues;
    debug?: boolean;
    strictNamespace?: boolean;
    formats?: Formats;
    onError?: OnErrorFn;
    getMessageFallback?: GetMessageFallbackFn;
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
    /** Only resolve `namespace.key` candidates (mirrors the server option). */
    strictNamespace?: boolean;
    /** Named `Intl` presets used by `useFormatter()`. */
    formats?: Formats;
    /** Disable Fluent's bidi isolates so `t()` is safe in non-HTML sinks. */
    useIsolating?: boolean;
    /** Client-side error reporting (define inside a `'use client'` wrapper). */
    onError?: OnErrorFn;
    /** Client-side fallback rendering (define inside a `'use client'` wrapper). */
    getMessageFallback?: GetMessageFallbackFn;
    children: React.ReactNode;
}
export declare function FluentProvider({ locale, messages, fallbackLocale, fallbackMessages, fallbackBundles, timeZone, now, functions, defaultTranslationValues, debug, strictNamespace, formats, useIsolating, onError, getMessageFallback, children, }: FluentProviderProps): React.FunctionComponentElement<React.ProviderProps<FluentContextValue>>;
export declare function useLocale(): string;
export declare function useTimeZone(): string;
/** Raw catalog (FTL text) provided to the current `FluentProvider`. */
export declare function useMessages(): string | readonly string[] | undefined;
export declare function useFormatter(): Formatter;
export declare function useNow(options?: {
    updateInterval?: number;
}): Date;
export declare function useTranslations<Namespace extends string>(namespace: Namespace): Translations<NamespaceKeys<Namespace>, NamespaceArgs<Namespace>>;
export declare function useTranslations(): Translations;
export declare function FormattedMessage<Key extends string = DefaultKey, ArgsMap extends Record<string, any> = Record<string, any>>({ id, args, values, fallback, className, as: Component, }: FormattedMessageProps<Key, ArgsMap>): React.ReactNode;
/**
 * Locale-aware link body. It lives in the client entry so that `createNavigation`
 * can expose a hook-free wrapper that Server Components may render.
 */
export declare const LocalizedLink: React.ForwardRefExoticComponent<Omit<any, "ref"> & React.RefAttributes<HTMLAnchorElement>>;
