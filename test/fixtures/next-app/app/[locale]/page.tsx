import { getLocale, getTranslations } from 'next-fluent/server';
import { headers } from 'next/headers';
import ClientMessage from './client';

export default async function Page() {
  const locale = await getLocale();
  const headerLocale = (await headers()).get('x-next-locale');
  const t = await getTranslations();
  return <main data-server-locale={locale} data-header-locale={headerLocale}><h1>{t('hello')}</h1><ClientMessage /></main>;
}
