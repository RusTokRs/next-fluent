// src/plugin.ts
import path from "node:path";
function createNextFluentPlugin(i18nRequestPath = "./src/i18n/request.ts") {
  return function withNextFluent(nextConfig = {}) {
    const resolvedPath = path.resolve(process.cwd(), i18nRequestPath);
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
      experimental: {
        ...nextConfig.experimental,
        turbo: {
          ...nextConfig.experimental?.turbo,
          resolveAlias: {
            ...nextConfig.experimental?.turbo?.resolveAlias,
            "next-fluent/config": resolvedPath
          }
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
