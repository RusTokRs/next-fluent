import { setRequestLocale } from 'next-fluent/server';
import { routing } from '../../../../i18n/routing';
import ClientMessage from '../../client';

export function generateStaticParams() { return [{ id: '42' }]; }

export default async function Page({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale, routing.locales);
  return <main data-server-locale={locale} data-route-kind="single" data-route-value={id}>
    <h1>Single document route</h1><ClientMessage />
  </main>;
}
