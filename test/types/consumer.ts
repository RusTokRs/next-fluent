import { useTranslations, useMessages, FluentProvider } from '../../dist/client.js';
import { getTranslations, getFormatter, setRequestConfig } from '../../dist/server.js';
import { defineRouting, type DomainConfig } from '../../dist/routing.js';
import { createNavigation } from '../../dist/navigation.js';
import { hasLocale } from '../../dist/utils.js';
import { FluentErrorCode } from '../../dist/errors.js';
import { pickMessages } from '../../dist/pick-messages.js';
import { jsonToFluent } from '../../dist/catalog.js';
import { checkCatalogs } from '../../dist/check.js';
import { analyzeUsage, formatUsageReport, type UsageReport } from '../../dist/usage.js';
import { createElement, type ReactNode } from 'react';

const t = useTranslations('app');
t('hello', { name: 'Ada' });
t('title');
// @ts-expect-error Unknown message key
t('unknown');
// @ts-expect-error Required Fluent variable is missing
t('hello');

async function serverConsumer() {
  const translate = await getTranslations('app');
  translate('hello', { name: 'Ada' });
  // @ts-expect-error Unknown server message key
  translate('unknown');
}
void serverConsumer;

const routing = defineRouting({
  locales: ['en', 'ru'] as const,
  defaultLocale: 'en',
  pathnames: {
    '/about': { en: '/about-us', ru: '/o-nas' },
    '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]' },
  },
});
const navigation = createNavigation(routing);
navigation.getPathname({ href: '/about', locale: 'ru' });
navigation.getPathname({ href: { pathname: '/products/[id]', query: { id: 123 } } });
// @ts-expect-error Unknown route
navigation.getPathname({ href: '/abut' });
// @ts-expect-error Unsupported locale
navigation.getPathname({ href: '/about', locale: 'fr' });
// @ts-expect-error Dynamic route requires its parameter
navigation.getPathname({ href: { pathname: '/products/[id]', query: {} } });

// V3: locale guard, named formats and error handling are typed.
const locales = ['en', 'ru'] as const;
if (hasLocale(locales, 'ru')) {
  const value: string = 'ru';
  void value;
}
void useMessages();

setRequestConfig(async ({ locale }) => ({
  locale: locale ?? 'en',
  messages: 'a = b',
  useIsolating: false,
  formats: { dateTime: { short: { dateStyle: 'short' } }, number: { percent: { style: 'percent' } } },
  onError: (error) => {
    const code: string = error.code;
    void code;
    if (error.code === FluentErrorCode.MISSING_MESSAGE) void error.key;
  },
  getMessageFallback: ({ namespace, key, error }) => `${namespace ?? ''}${key}${error.code}`,
}));

async function formatterConsumer() {
  const format = await getFormatter();
  format.dateTime(new Date(), 'short');
  format.dateTime(new Date(), { dateStyle: 'full' });
  format.number(1, 'percent');
  format.list(['a', 'b'], { type: 'conjunction' });
}
void formatterConsumer;

export function ProviderConsumer({ children }: { children: ReactNode }) {
  return createElement(FluentProvider, {
    locale: 'en',
    messages: 'a = b',
    strictNamespace: true,
    useIsolating: false,
    formats: { number: { percent: { style: 'percent' } } },
    onError: (error) => void error.code,
    getMessageFallback: ({ key }) => key,
    children,
  });
}

// Roadmap APIs: per-locale prefixes, attributes, plain text, JSON catalogs and
// catalog pruning must be typed like everything else.
const prefixedRouting = defineRouting({
  locales: ['en', 'en-US', 'ru'] as const,
  defaultLocale: 'en',
  localePrefix: { mode: 'as-needed', prefixes: { 'en-US': '/usa', ru: '/rus' } },
});
void prefixedRouting;
// @ts-expect-error Unknown prefix mode
defineRouting({ locales: ['en'] as const, defaultLocale: 'en', localePrefix: { mode: 'sometimes' } });

function attributesConsumer() {
  const attrs: Record<string, string> = t.attrs('hello', { name: 'Ada' });
  const plain: string = t.plain('title');
  void attrs;
  void plain;
  // @ts-expect-error Unknown message key
  t.attrs('unknown');
}
void attributesConsumer;

async function jsonCatalogConsumer() {
  const translate = await getTranslations({ messages: { 'app-hello': 'Hi {name}' } });
  translate('app-hello', { name: 'Ada' });
  const picked: string = pickMessages('app-hello = Hi', 'app');
  const json: string = jsonToFluent({ hello: 'Hi' });
  const report = checkCatalogs({ en: 'a = 1', ru: 'a = 1' }, { referenceLocale: 'en' });
  void report.issues;
  void picked;
  void json;
}
void jsonCatalogConsumer;

async function usageAnalysisConsumer() {
  const report: UsageReport = analyzeUsage(
    { en: 'app-hello = Hi' },
    [{ path: 'app/page.tsx', content: "const t = useTranslations();\nt('app-hello');" }],
    { referenceLocale: 'en', reportUnused: true, ignore: ['legacy'] }
  );
  const unused = report.issues.filter((issue) => issue.kind === 'unused');
  const text: string = formatUsageReport(report);
  void unused;
  void text;
}
void usageAnalysisConsumer;

export function JsonProviderConsumer({ children }: { children: ReactNode }) {
  return createElement(FluentProvider, {
    locale: 'en',
    messages: { 'app-title': 'Title {version}' },
    children,
  });
}

// Domain overrides flow through all configuration entry points.
import type { I18nConfig, I18nMiddlewareOptions, NavigationConfig } from '../../dist/types.js';
const domain: DomainConfig = {
  domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'],
  localePrefix: { mode: 'as-needed', prefixes: { ru: '/russian' } },
};
const domainRouting = defineRouting({
  locales: ['en', 'ru'] as const, defaultLocale: 'en', domains: [domain],
});
const domainMiddleware: I18nMiddlewareOptions = domainRouting;
const domainNavigation: NavigationConfig = domainRouting;
const domainFactory: I18nConfig = domainRouting;
createNavigation(domainNavigation);
void domainMiddleware;
void domainFactory;
// @ts-expect-error Unknown domain prefix mode
const invalidDomain: DomainConfig = { domain: 'example.com', defaultLocale: 'en', localePrefix: 'sometimes' };
void invalidDomain;

function immutableRoutingConsumer() {
  // A mutable input (rather than `as const`) ensures readonly comes from the API.
  const input = {
    locales: ['en', 'ru'] as ['en', 'ru'], defaultLocale: 'en' as const,
    localePrefix: { mode: 'always' as const, prefixes: { ru: '/rus' } },
    pathnames: { '/products/[id]': { en: '/products/[id]', ru: '/tovary/[id]' } },
    domains: [{ domain: 'example.com', defaultLocale: 'en', locales: ['en', 'ru'],
      localePrefix: { mode: 'as-needed' as const, prefixes: { ru: '/russian' } } }],
    localeCookie: { name: 'LANG', path: '/' }, trustedHosts: ['example.com'],
  };
  const immutable = defineRouting(input);
  const locales: readonly ['en', 'ru'] = immutable.locales;
  const middleware: I18nMiddlewareOptions = immutable;
  const factory: I18nConfig = immutable;
  const nav = createNavigation(immutable);
  nav.getPathname({ href: { pathname: '/products/[id]', query: { id: 42 } }, locale: 'ru' });
  // @ts-expect-error Locale inference is retained
  nav.getPathname({ href: { pathname: '/products/[id]', query: { id: 42 } }, locale: 'de' });
  // @ts-expect-error Route inference is retained
  nav.getPathname({ href: '/unknown' });
  // @ts-expect-error Required parameter inference is retained
  nav.getPathname({ href: { pathname: '/products/[id]', query: {} } });
  // @ts-expect-error Root settings are readonly
  immutable.defaultLocale = 'en';
  // @ts-expect-error Locales are a readonly tuple
  immutable.locales.push('en');
  if (typeof immutable.localePrefix === 'object') {
    // @ts-expect-error Global prefix mode is readonly
    immutable.localePrefix.mode = 'always';
    // @ts-expect-error Global prefix entries are readonly
    immutable.localePrefix.prefixes!.ru = '/changed';
  }
  // @ts-expect-error Translated pathnames are readonly
  immutable.pathnames['/products/[id]'].ru = '/changed/[id]';
  // @ts-expect-error Route entries are readonly
  immutable.pathnames['/products/[id]'] = input.pathnames['/products/[id]'];
  // @ts-expect-error Domain properties are readonly
  immutable.domains![0].domain = 'changed.test';
  // @ts-expect-error Domain locale arrays are readonly
  immutable.domains![0].locales!.push('ru');
  const prefix = immutable.domains![0].localePrefix;
  if (typeof prefix === 'object') {
    // @ts-expect-error Domain prefix entries are readonly
    prefix.prefixes!.ru = '/changed';
  }
  if (typeof immutable.localeCookie === 'object') {
    // @ts-expect-error Cookie options are readonly
    immutable.localeCookie.name = 'CHANGED';
  }
  // @ts-expect-error Trusted hosts are readonly
  immutable.trustedHosts![0] = 'changed.test';

  // The input remains mutable, and both defineRouting overloads are readonly.
  input.localePrefix.prefixes.ru = '/new';
  input.domains[0].locales.push('en');
  const withoutPathnames = defineRouting({ locales: ['en'], defaultLocale: 'en' });
  // @ts-expect-error Readonly also applies to the overload without pathnames
  withoutPathnames.defaultLocale = 'en';
  void locales; void middleware; void factory;
}
void immutableRoutingConsumer;
