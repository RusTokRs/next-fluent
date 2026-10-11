import { headers } from 'next/headers';
import { getLocale, getRequestConfigSnapshot } from 'next-fluent/server';

// Reads request headers on purpose: this route is expected to stay dynamic so
// the static routes prove that next-fluent does not force dynamic rendering.
// `getLocale()` here also proves that the request scope is per-request: the
// layout's `setRequestLocale` must reach the page, and concurrent requests for
// different locales must not see each other's store (V4-16).
export default async function Live() {
  const headerLocale = (await headers()).get('x-next-locale');
  const scopeLocale = await getLocale();
  // A snapshot taken for another locale must not replace the locale the request
  // resolved (V6-07): the request store keeps its own locale, the snapshot only
  // reports the one it was asked for.
  const otherLocale = scopeLocale === 'ru' ? 'en' : 'ru';
  const snapshot = await getRequestConfigSnapshot(otherLocale);
  const scopeLocaleAfterSnapshot = await getLocale();
  return (
    <main
      data-header-locale={headerLocale}
      data-scope-locale={scopeLocale}
      data-snapshot-locale={snapshot.locale}
      data-scope-locale-after-snapshot={scopeLocaleAfterSnapshot}
    >
      live
    </main>
  );
}
