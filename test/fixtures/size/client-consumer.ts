/**
 * The client surface a localized app imports — the fixture `npm run size`
 * bundles to measure what a browser actually downloads.
 *
 * Two rules keep the measurement honest:
 *
 * 1. Import through the published specifiers (`next-fluent`,
 *    `next-fluent/navigation`, `next-fluent/routing`), never through `src/`
 *    relative paths: the exports map decides the module graph, and the fixture
 *    must see exactly what a consumer sees.
 * 2. List every runtime export of the client entries (`next-fluent/client`,
 *    `next-fluent/navigation`). Unused exports are the one thing a bundler
 *    removes, so this file is the definition of "the client bundle"; a newly
 *    exported client API that is missing here would silently stop being
 *    measured. `test/audit-v8.test.mjs` fails if an export is missing.
 *
 * It is type-checked by neither `tsc` nor eslint (see the ignore list in
 * `eslint.config.js`): esbuild only has to resolve and bundle it.
 */
import { defineRouting } from 'next-fluent/routing';
import {
  assertSafeHref,
  createNavigation,
  formatUrlObject,
  isExternalUrl,
  resolveLocalizedPathname,
} from 'next-fluent/navigation';
import {
  FluentProvider,
  FormattedMessage,
  LocalizedLink,
  createFormatter,
  useTranslations,
  useFormatter,
  useLocale,
  useTimeZone,
  useNow,
  useMessages,
  hasLocale,
} from 'next-fluent';

export const routing = defineRouting({
  locales: ['en', 'ru'],
  defaultLocale: 'en',
});

export const navigation = createNavigation(routing as never);

export {
  FluentProvider,
  FormattedMessage,
  LocalizedLink,
  createFormatter,
  useTranslations,
  useFormatter,
  useLocale,
  useTimeZone,
  useNow,
  useMessages,
  hasLocale,
  assertSafeHref,
  createNavigation,
  formatUrlObject,
  isExternalUrl,
  resolveLocalizedPathname,
};
