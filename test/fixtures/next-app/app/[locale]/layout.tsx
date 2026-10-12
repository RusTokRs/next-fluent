import { notFound } from 'next/navigation';
import { FluentServerProvider } from 'next-fluent/server-provider';
import { setRequestLocale } from 'next-fluent/server';
import { getLocaleDirection } from 'next-fluent';
import { routing } from '../../i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.some((item) => item === locale)) notFound();
  setRequestLocale(locale, routing.locales);
  // `dir` comes from the same CLDR data the formatters use, so an app that adds
  // an RTL locale does not have to start keeping a direction list by hand.
  return <html lang={locale} dir={getLocaleDirection(locale)}><body><FluentServerProvider locale={locale}>{children}</FluentServerProvider></body></html>;
}
