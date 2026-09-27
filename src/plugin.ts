import path from 'node:path';
import { watchCatalogs, writeTypeDeclarations } from './catalog-io';

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
export function createNextFluentPlugin(
  i18nRequestPath: string = './src/i18n/request.ts',
  options: NextFluentPluginOptions = {}
) {
  return function withNextFluent(nextConfig: NextConfigLike = {}): NextConfigLike {
    // Message types must exist before TypeScript compiles the app, so generation
    // happens while the config is evaluated rather than in a loader.
    if (options.typegen) {
      const input = path.resolve(process.cwd(), options.typegen.input ?? './messages');
      const output = path.resolve(process.cwd(), options.typegen.output ?? './next-fluent.d.ts');
      try {
        const result = writeTypeDeclarations(input, output);
        if (result.changed) {
          console.log(
            `[next-fluent] Generated message types at ${path.relative(process.cwd(), output)}`
          );
        }
        // Watching only makes sense while developing, and the handle must never
        // hold the process open — otherwise `next build` would not exit.
        const isProduction = process.env.NODE_ENV === 'production';
        if (options.typegen.watch !== false && !isProduction) {
          watchCatalogs(input, output, {
            unref: true,
            onUpdate: () => console.log('[next-fluent] Regenerated message types.'),
            onError: (error) =>
              console.error(`[next-fluent] Type generation failed: ${error.message}`),
          });
        }
      } catch (error) {
        console.error(`[next-fluent] Type generation failed: ${(error as Error).message}`);
      }
    }

    const resolvedPath = path.resolve(process.cwd(), i18nRequestPath);
    const relativePath = path.relative(process.cwd(), resolvedPath).split(path.sep).join('/');
    const turbopackPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;

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
      // Top-level `turbopack` is the supported location since Next 15.3; the
      // old `experimental.turbo` spelling is an alias Next keeps for 13.0-15.2,
      // which the peer range no longer covers.
      turbopack: {
        ...nextConfig.turbopack,
        resolveAlias: {
          ...nextConfig.turbopack?.resolveAlias,
          'next-fluent/config': turbopackPath,
        },
      },
    };
  };
}

export default createNextFluentPlugin;
