import { headers } from 'next/headers';
import { getLocale } from 'next-fluent/server';

// Reads request headers on purpose: this route is expected to stay dynamic so
// the static routes prove that next-fluent does not force dynamic rendering.
// `getLocale()` here also proves that the request scope is per-request: the
// layout's `setRequestLocale` must reach the page, and concurrent requests for
// different locales must not see each other's store (V4-16).
export default async function Live() {
  const headerLocale = (await headers()).get('x-next-locale');
  const scopeLocale = await getLocale();
  return (
    <main data-header-locale={headerLocale} data-scope-locale={scopeLocale}>
      live
    </main>
  );
}
