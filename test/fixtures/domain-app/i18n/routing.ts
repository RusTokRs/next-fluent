import { defineRouting } from 'next-fluent/routing';

const port = process.env.NEXT_PUBLIC_DOMAIN_TEST_PORT;
const sourcePrefixes = { de: '/deutsch', ru: '/lang/ru' };
const sourcePathnames = {
  '/shared': '/shared',
  '/about': { en: '/about-us', es: '/acerca', de: '/uber', ru: '/o-nas', fr: '/a-propos' },
  // Deliberately declare the broad match first to exercise route precedence.
  '/docs/[...slug]': { en: '/docs/[...slug]', es: '/todos/[...slug]', de: '/alle/[...slug]', ru: '/vse/[...slug]', fr: '/tous/[...slug]' },
  '/docs/[id]': { en: '/docs/[id]', es: '/uno/[id]', de: '/einzeln/[id]', ru: '/odin/[id]', fr: '/un/[id]' },
  '/docs/new': { en: '/docs/new', es: '/nuevo', de: '/neu', ru: '/novyi', fr: '/nouveau' },
};

export const routing = defineRouting({
  locales: ['en', 'es', 'de', 'ru', 'fr'] as const,
  defaultLocale: 'en',
  localePrefix: 'always',
  basePath: '/app',
  domains: [
    { domain: `en.next-fluent.test:${port}`, defaultLocale: 'en', locales: ['en', 'es'],
      localePrefix: 'never' },
    { domain: `eu.next-fluent.test:${port}`, defaultLocale: 'de', locales: ['de', 'ru'],
      localePrefix: { mode: 'as-needed', prefixes: sourcePrefixes } },
    { domain: `fr.next-fluent.test:${port}`, defaultLocale: 'fr', localePrefix: { prefixes: { fr: '/francais' } } },
  ],
  pathnames: sourcePathnames,
});

// Caller-owned dictionaries remain writable, but the exported snapshot must
// keep routing, prerendered hrefs and hydrated client navigation unchanged.
sourcePrefixes.ru = '/mutated-prefix';
sourcePathnames['/about'].ru = '/mutated-about';
