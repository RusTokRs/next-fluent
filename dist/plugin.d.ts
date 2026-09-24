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
export declare function createNextFluentPlugin(i18nRequestPath?: string): (nextConfig?: NextConfigLike) => NextConfigLike;
export default createNextFluentPlugin;
