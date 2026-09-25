import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
function createNextFluentPlugin(i18nRequestPath = "./src/i18n/request.ts") {
  return function withNextFluent(nextConfig = {}) {
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
