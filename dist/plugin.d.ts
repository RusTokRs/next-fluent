/** Automatic `next-fluent typegen` wiring for `next dev` / `next build`. */
export interface TypegenPluginOptions {
    /** Catalog file or directory. Defaults to `./messages`. */
    input?: string;
    /** Generated `.d.ts` path. Defaults to `./next-fluent.d.ts`. */
    output?: string;
    /** Regenerate on every catalog change. Defaults to `true`. */
    watch?: boolean;
}
export interface NextFluentPluginOptions {
    typegen?: TypegenPluginOptions;
}
export interface NextConfigLike {
    webpack?: (config: any, context: any) => any;
    experimental?: {
        turbo?: {
            resolveAlias?: Record<string, string>;
        };
        [key: string]: any;
    };
    turbopack?: {
        resolveAlias?: Record<string, string>;
    };
    [key: string]: any;
}
/**
 * Creates a Next.js plugin for next-fluent that automatically binds
 * your `src/i18n/request.ts` configuration into Webpack and Turbopack.
 *
 * @param i18nRequestPath Path to your request configuration file. Defaults to `./src/i18n/request.ts`.
 */
export declare function createNextFluentPlugin(i18nRequestPath?: string, options?: NextFluentPluginOptions): (nextConfig?: NextConfigLike) => NextConfigLike;
export default createNextFluentPlugin;
