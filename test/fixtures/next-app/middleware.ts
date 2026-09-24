import { createI18nMiddleware } from 'next-fluent/middleware';
import { routing } from './i18n/routing';

export default createI18nMiddleware(routing);

export const config = {
  matcher: ['/', '/((?!api|_next|_vercel|.*\\..*).*)'],
};
