import { setRequestLocale } from 'next-fluent/server';
import { routing } from '../../../../i18n/routing';
import ClientMessage from '../../client';



export default async function Page({ params }: { params: Promise<{ locale: string;  }> }) {
  const { locale } = await params;
  setRequestLocale(locale, routing.locales);
  return <main data-server-locale={locale} data-route-kind="static" data-route-value={'new'}>
    <h1>Static document route</h1><ClientMessage />
  </main>;
}
