import { setRequestLocale } from 'next-fluent/server';
import { routing } from '../../../i18n/routing';

export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale, routing.locales);
  return <main>About route</main>;
}
