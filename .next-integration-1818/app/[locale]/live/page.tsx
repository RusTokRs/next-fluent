import { headers } from 'next/headers';

// Reads request headers on purpose: this route is expected to stay dynamic so
// the static routes prove that next-fluent does not force dynamic rendering.
export default async function Live() {
  const headerLocale = (await headers()).get('x-next-locale');
  return <main data-header-locale={headerLocale}>live</main>;
}
