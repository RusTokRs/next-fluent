import path from "node:path";
import { watchCatalogs, writeTypeDeclarations } from "./catalog-io.js";
function createNextFluentPlugin(i18nRequestPath = "./src/i18n/request.ts", options = {}) {
  return function withNextFluent(nextConfig = {}) {
    if (options.typegen) {
      const input = path.resolve(process.cwd(), options.typegen.input ?? "./messages");
      const output = path.resolve(process.cwd(), options.typegen.output ?? "./next-fluent.d.ts");
      try {
        const result = writeTypeDeclarations(input, output);
        if (result.changed) {
          console.log(
            `[next-fluent] Generated message types at ${path.relative(process.cwd(), output)}`
          );
        }
        const isProduction = process.env.NODE_ENV === "production";
        if (options.typegen.watch !== false && !isProduction) {
          watchCatalogs(input, output, {
            unref: true,
            onUpdate: () => console.log("[next-fluent] Regenerated message types."),
            onError: (error) => console.error(`[next-fluent] Type generation failed: ${error.message}`)
          });
        }
      } catch (error) {
        console.error(`[next-fluent] Type generation failed: ${error.message}`);
      }
    }
    const resolvedPath = path.resolve(process.cwd(), i18nRequestPath);
    const relativePath = path.relative(process.cwd(), resolvedPath).split(path.sep).join("/");
    const turbopackPath = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return {
      ...nextConfig,
      webpack(config, context) {
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        config.resolve.alias["next-fluent/config"] = resolvedPath;
        if (typeof nextConfig.webpack === "function") {
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
          "next-fluent/config": turbopackPath
        }
      }
    };
  };
}
var plugin_default = createNextFluentPlugin;
export {
  createNextFluentPlugin,
  plugin_default as default
};
