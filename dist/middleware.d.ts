import type { I18nMiddlewareOptions } from './types';
/**
 * `example.com.` is the absolute spelling of `example.com` — the same host to
 * every resolver — and clients, health checks and proxies do send it. Comparing
 * the two spellings as different hosts rejected the absolute form with 421 and
 * silently skipped domain routing for it.
 */
export declare function normalizeHostForMatching(host: string): string;
export interface NextMiddlewareRequestLike {
    url: string;
    nextUrl: {
        pathname: string;
        search: string;
        /** Next.js exposes basePath separately from pathname. */
        basePath?: string;
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
