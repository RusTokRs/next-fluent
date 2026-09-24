import { notFound } from 'next/navigation';
import { FluentServerProvider } from 'next-fluent/server-provider';
import { setRequestLocale } from 'next-fluent/server';
import { routing } from '../../i18n/routing';

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
  return <html lang={locale}><body><FluentServerProvider locale={locale}>{children}</FluentServerProvider></body></html>;
}
