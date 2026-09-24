import { useTranslations } from '../../dist/client.js';
import { getTranslations } from '../../dist/server.js';
import { defineRouting } from '../../dist/routing.js';
import { createNavigation } from '../../dist/navigation.js';

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
