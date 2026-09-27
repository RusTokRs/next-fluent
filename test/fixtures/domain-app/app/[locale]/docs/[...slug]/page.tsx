import { setRequestLocale } from 'next-fluent/server';
import { routing } from '../../../../i18n/routing';
import ClientMessage from '../../client';

export function generateStaticParams() { return [{ slug: ['a', 'b'] }]; }

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string[] }> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale, routing.locales);
  return <main data-server-locale={locale} data-route-kind="many" data-route-value={slug.join('/')}>
    <h1>Many document route</h1><ClientMessage />
  </main>;
}
