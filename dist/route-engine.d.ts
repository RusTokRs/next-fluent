import type { Pathnames } from './types';
type Params = Record<string, string | string[]>;
interface Match {
    template: string;
    params: Params;
}
export declare function externalTemplate(internal: string, locale: string, pathnames?: Pathnames<any>): string;
export declare function findInternalPath(pathname: string, locale: string, pathnames?: Pathnames<any>): Match | null;
export declare function renderTemplate(template: string, params: Params): string;
export declare function localizePath(pathname: string, sourceLocale: string, targetLocale: string, pathnames?: Pathnames<any>, query?: Record<string, unknown>, locales?: readonly string[]): {
    pathname: string;
    consumed: string[];
};
export declare function rewriteLocalizedPath(pathname: string, locale: string, pathnames?: Pathnames<any>): string;
export declare function validatePathnames(locales: readonly string[], pathnames?: Pathnames<any>): void;
export declare function validateRouteEnvironment(locales: readonly string[], domains?: readonly {
    domain: string;
    defaultLocale: string;
    locales?: readonly string[];
}[], basePath?: string): void;
export {};
