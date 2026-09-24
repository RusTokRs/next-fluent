import path from 'node:path';

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
export function createNextFluentPlugin(i18nRequestPath: string = './src/i18n/request.ts') {
  return function withNextFluent(nextConfig: NextConfigLike = {}): NextConfigLike {
    const resolvedPath = path.resolve(process.cwd(), i18nRequestPath);

    return {
      ...nextConfig,
      webpack(config, context) {
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias['next-fluent/config'] = resolvedPath;

        if (typeof nextConfig.webpack === 'function') {
          return nextConfig.webpack(config, context);
        }
        return config;
      },
      experimental: {
        ...nextConfig.experimental,
        turbo: {
          ...nextConfig.experimental?.turbo,
          resolveAlias: {
            ...nextConfig.experimental?.turbo?.resolveAlias,
            'next-fluent/config': resolvedPath,
          },
        },
      },
      turbopack: {
        ...nextConfig.turbopack,
        resolveAlias: {
          ...nextConfig.turbopack?.resolveAlias,
          'next-fluent/config': resolvedPath,
        },
      },
    };
  };
}

export default createNextFluentPlugin;
