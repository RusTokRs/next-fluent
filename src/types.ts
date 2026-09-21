import type { FluentBundle, FluentVariable } from '@fluent/bundle';
import type React from 'react';

export type { FluentBundle, FluentVariable };

export type NonEmptyArray<T> = readonly [T, ...T[]];

export type FluentArgs = Record<string, FluentVariable>;

export type TagRenderFn = (children: React.ReactNode) => React.ReactNode;

export type RichTranslationValues = Record<
  string,
  FluentVariable | TagRenderFn | React.ReactNode
>;

export type MessageArgsFor<K extends string, ArgsMap> =
  K extends keyof ArgsMap
    ? ArgsMap[K] extends Record<string, never> | undefined
      ? [args?: FluentArgs]
      : [args: ArgsMap[K]]
    : [args?: FluentArgs];

export interface TranslationFn<
  Key extends string = string,
  ArgsMap extends Record<string, any> = Record<string, any>
> {
  <K extends Key>(key: K, ...args: MessageArgsFor<K, ArgsMap>): string;
  raw<K extends Key>(key: K): string[] | string;
  rich<K extends Key>(key: K, values?: RichTranslationValues): React.ReactNode;
  has<K extends Key>(key: K): boolean;
}

export type Translations<
  Key extends string = string,
  ArgsMap extends Record<string, any> = Record<string, any>
> = TranslationFn<Key, ArgsMap>;

export interface FormattedMessageProps<
  Key extends string = string,
  ArgsMap extends Record<string, any> = Record<string, any>
> {
  id: Key;
  args?: Key extends keyof ArgsMap ? ArgsMap[Key] : FluentArgs;
  values?: RichTranslationValues;
  fallback?: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}

export interface FormatterOptions {
  locale: string;
  timeZone?: string;
}

export interface Formatter {
  readonly locale: string;
  readonly timeZone?: string;
  dateTime(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
  number(value: number | bigint, options?: Intl.NumberFormatOptions): string;
  relativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions
  ): string;
  list(value: Iterable<string>, options?: Intl.ListFormatOptions): string;
}

export type LocalePrefixMode = 'always' | 'as-needed' | 'never';

export interface NavigationConfig<Locales extends readonly string[] = readonly string[]> {
  locales: Locales;
  defaultLocale: Locales[number] | string;
  localePrefix?: LocalePrefixMode;
}

export interface UrlObject {
  auth?: string | null;
  hash?: string | null;
  host?: string | null;
  hostname?: string | null;
  href?: string | null;
  pathname?: string | null;
  protocol?: string | null;
  search?: string | null;
  slashes?: boolean | null;
  port?: string | number | null;
  query?: Record<string, any> | string | null;
}

export type Href = string | UrlObject;

export interface GetPathnameOptions {
  href: Href;
  locale?: string;
}

export interface Navigation<Locales extends readonly string[] = readonly string[]> {
  Link: React.ForwardRefExoticComponent<
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
      href: Href;
      locale?: Locales[number] | string;
      replace?: boolean;
      scroll?: boolean;
      prefetch?: boolean;
      children?: React.ReactNode;
      className?: string;
    } & React.RefAttributes<HTMLAnchorElement>
  >;
  usePathname: () => string;
  useRouter: () => {
    push(href: Href, options?: { locale?: Locales[number] | string; scroll?: boolean }): void;
    replace(href: Href, options?: { locale?: Locales[number] | string; scroll?: boolean }): void;
    prefetch(href: Href, options?: { locale?: Locales[number] | string }): void;
    back(): void;
    forward(): void;
    refresh(): void;
  };
  redirect(url: string, options?: { locale?: Locales[number] | string; type?: 'push' | 'replace' }): never;
  permanentRedirect(url: string, options?: { locale?: Locales[number] | string; type?: 'push' | 'replace' }): never;
  getPathname(options: GetPathnameOptions): string;
}

export interface RequestConfigParams {
  locale?: string;
}

export interface RequestConfigResult {
  locale?: string;
  messages: string | readonly string[];
  fallbackLocale?: string;
  fallbackMessages?: string | readonly string[];
  defaultTranslationValues?: RichTranslationValues;
  timeZone?: string;
}

export type RequestConfigFn = (
  params: RequestConfigParams
) => Promise<RequestConfigResult> | RequestConfigResult;

export interface GetTranslationsOptions {
  locale?: string;
  messages?: string | readonly string[];
  fallbackLocale?: string;
  fallbackLocales?: readonly string[];
  fallbackMessages?: string | readonly string[];
  defaultTranslationValues?: RichTranslationValues;
  namespace?: string;
  debug?: boolean;
}

export interface I18nMiddlewareOptions {
  locales: readonly string[];
  defaultLocale: string;
  localePrefix?: 'always' | 'as-needed' | 'never';
  cookieName?: string;
  headerName?: string;
}

export interface I18nConfig {
  locales: readonly string[];
  defaultLocale: string;
  localePrefix?: 'always' | 'as-needed' | 'never';
  cookieName?: string;
  headerName?: string;
  loadMessages?: (locale: string) => Promise<string | readonly string[]> | string | readonly string[];
}


