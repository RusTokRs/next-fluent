import { setRequestLocale } from 'next-fluent/server';
import { redirect } from '../../../i18n/navigation';
import { routing } from '../../../i18n/routing';

// `redirect()` names no locale here, on purpose. In a Server Component there is
// no hook to read the current locale from, so the navigation helper reads the
// one `setRequestLocale` stored. The assertion in
// `scripts/test-next-integration.mjs` pins the outcome per locale: `/go-about`
// must land on `/about-us` and `/ru/go-about` on `/ru/o-nas`. Before that, both
// landed on `/about-us`, because the missing locale silently meant
// `defaultLocale` — the same `push('/about')` in a Client Component kept the
// visitor on the Russian pathname.
//
// Forced dynamic so the redirect is computed from a live request scope rather
// than baked once at build time.
export const dynamic = 'force-dynamic';

export default async function GoAbout({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale, routing.locales);
  redirect('/about');
}
