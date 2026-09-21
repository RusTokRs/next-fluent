import type { GetPathnameOptions, Navigation, NavigationConfig, UrlObject } from './types';
export declare function formatUrlObject(urlObj: UrlObject): {
    pathname: string;
    search: string;
    hash: string;
};
export declare function resolveLocalizedPathname(options: GetPathnameOptions, config: NavigationConfig): string;
export declare function createNavigation<Locales extends readonly string[] = readonly string[]>(config: NavigationConfig<Locales>): Navigation<Locales>;
