import { createI18nMiddleware } from 'next-fluent/middleware';
import { routing } from './i18n/routing';

export default createI18nMiddleware(routing);

export const config = {
  // `/probe` is excluded on purpose: it is the one route that must resolve its
  // own locale from headers and cookies instead of receiving the middleware's
  // forwarded `x-next-locale`, which is what covers that branch of `getLocale()`
  // for an app that does not call `setRequestLocale`.
  matcher: ['/', '/((?!api|_next|_vercel|probe|.*\\..*).*)'],
};