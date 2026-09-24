import type { I18nMiddlewareOptions } from './types';
export interface NextMiddlewareRequestLike {
    url: string;
    nextUrl: {
        pathname: string;
        search: string;
    };
    cookies: {
        get(name: string): {
            value: string;
        } | undefined;
        set?(name: string, value: string, options?: unknown): void;
    };
    headers: {
        get(name: string): string | null;
        forEach?(callback: (value: string, key: string) => void): void;
        entries?(): IterableIterator<[string, string]>;
    };
}
export declare function createI18nMiddleware(options: I18nMiddlewareOptions): (request: NextMiddlewareRequestLike) => Promise<import("next/server.js").NextResponse<unknown>>;
export declare const createMiddleware: typeof createI18nMiddleware;
