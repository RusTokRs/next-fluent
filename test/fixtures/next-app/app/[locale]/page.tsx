import { getLocale, getTranslations, setRequestLocale } from 'next-fluent/server';
import { routing } from '../../i18n/routing';
import { getPathname } from '../../i18n/navigation';
import ClientMessage from './client';

// `setRequestLocale` must be called in every page *and* layout: Next.js renders
// them independently, so this is what enables static rendering per locale.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: segment } = await params;
  setRequestLocale(segment, routing.locales);
  const locale = await getLocale();
  const t = await getTranslations();
  // Server-side usage of the shared navigation factory (N09 regression).
  const supported = routing.locales.find((item) => item === locale);
  const aboutHref = getPathname({ href: '/about', locale: supported });
  return (
    <main data-server-locale={locale}>
      <h1>{t('hello')}</h1>
      <a data-about-href={aboutHref} href={aboutHref}>About</a>
      <ClientMessage />
    </main>
  );
}
