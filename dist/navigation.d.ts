import type { Navigation, NavigationConfig, UrlObject } from './types';
export { formatUrlObject, resolveLocalizedPathname, assertSafeHref, isExternalUrl } from './nav-url';
export declare function createNavigation<const Locales extends readonly string[], const Routes extends Record<string, string | Record<string, string>>>(config: Omit<NavigationConfig<Locales>, 'pathnames'> & {
    pathnames: Routes;
}): Navigation<Locales, keyof Routes & string>;
export declare function createNavigation<Locales extends readonly string[] = readonly string[]>(config: NavigationConfig<Locales>): Navigation<Locales>;
export type { UrlObject };
