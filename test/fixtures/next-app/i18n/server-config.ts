import { configureServerI18n } from 'next-fluent/server';

// The locale list the server helpers validate against. Without it `getLocale()`
// can only trust the middleware's forwarded header and the locale cookie:
// `Accept-Language` is a *negotiation* list, and there is nothing to negotiate
// against without knowing which locales the app ships. That is why this call
// has to happen before the first `getLocale()` of a request — a server module
// imported by a layout (or Next's `instrumentation.ts`), not the request config,
// which is resolved *by* those helpers and therefore afterwards.
//
// It lives in its own module because `i18n/routing.ts` is imported by client
// components too: importing `next-fluent/server` from there would put the
// server runtime into the browser bundle.
configureServerI18n({ locales: ['en', 'ru'], defaultLocale: 'en' });