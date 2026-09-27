import { defineRouting } from 'next-fluent/routing';

export const routing = defineRouting({
  locales: ['en', 'ru'] as const,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  pathnames: {
    '/about': { en: '/about-us', ru: '/o-nas' },
  },
});
