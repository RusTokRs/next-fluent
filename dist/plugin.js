import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { watchCatalogs, writeTypeDeclarations } from "./catalog-io.js";
const require2 = createRequire(import.meta.url);
function needsLegacyTurboConfig() {
  try {
    const packagePath = require2.resolve("next/package.json");
    const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
    const [major, minor] = version.split(".").map(Number);
    return major < 15 || major === 15 && minor < 3;
  } catch {
    return false;
  }
}
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
    const legacyTurbo = needsLegacyTurboConfig();
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
      ...legacyTurbo ? {
        experimental: {
          ...nextConfig.experimental,
          turbo: {
            ...nextConfig.experimental?.turbo,
            resolveAlias: {
              ...nextConfig.experimental?.turbo?.resolveAlias,
              "next-fluent/config": turbopackPath
            }
          }
        }
      } : {},
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
