import { useTranslations, useMessages, FluentProvider } from '../../dist/client.js';
import { getTranslations, getFormatter, setRequestConfig } from '../../dist/server.js';
import { defineRouting } from '../../dist/routing.js';
import { createNavigation } from '../../dist/navigation.js';
import { hasLocale } from '../../dist/utils.js';
import { FluentErrorCode } from '../../dist/errors.js';
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
