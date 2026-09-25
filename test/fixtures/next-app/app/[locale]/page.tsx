import { getLocale, getTranslations } from 'next-fluent/server';
import { headers } from 'next/headers';
import { routing } from '../../i18n/routing';
import { getPathname } from '../../i18n/navigation';
import ClientMessage from './client';

export default async function Page() {
  const locale = await getLocale();
  const headerLocale = (await headers()).get('x-next-locale');
  const t = await getTranslations();
  // Server-side usage of the shared navigation factory (N09 regression).
  const supported = routing.locales.find((item) => item === locale);
  const aboutHref = getPathname({ href: '/about', locale: supported });
  return (
    <main data-server-locale={locale} data-header-locale={headerLocale}>
      <h1>{t('hello')}</h1>
      <a data-about-href={aboutHref} href={aboutHref}>About</a>
      <ClientMessage />
    </main>
  );
}
