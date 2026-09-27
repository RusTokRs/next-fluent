"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var plugin_exports = {};
__export(plugin_exports, {
  createNextFluentPlugin: () => createNextFluentPlugin,
  default: () => plugin_default
});
module.exports = __toCommonJS(plugin_exports);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_fs = require("node:fs");
var import_node_module = require("node:module");
var import_catalog_io = require("./catalog-io.cjs");
const import_meta = { url: require('node:url').pathToFileURL(__filename).href };
const require2 = (0, import_node_module.createRequire)(import_meta.url);
function needsLegacyTurboConfig() {
  try {
    const packagePath = require2.resolve("next/package.json");
    const version = JSON.parse((0, import_node_fs.readFileSync)(packagePath, "utf8")).version;
    const [major, minor] = version.split(".").map(Number);
    return major < 15 || major === 15 && minor < 3;
  } catch {
    return false;
  }
}
function createNextFluentPlugin(i18nRequestPath = "./src/i18n/request.ts", options = {}) {
  return function withNextFluent(nextConfig = {}) {
    if (options.typegen) {
      const input = import_node_path.default.resolve(process.cwd(), options.typegen.input ?? "./messages");
      const output = import_node_path.default.resolve(process.cwd(), options.typegen.output ?? "./next-fluent.d.ts");
      try {
        const result = (0, import_catalog_io.writeTypeDeclarations)(input, output);
        if (result.changed) {
          console.log(
            `[next-fluent] Generated message types at ${import_node_path.default.relative(process.cwd(), output)}`
          );
        }
        const isProduction = process.env.NODE_ENV === "production";
        if (options.typegen.watch !== false && !isProduction) {
          (0, import_catalog_io.watchCatalogs)(input, output, {
            unref: true,
            onUpdate: () => console.log("[next-fluent] Regenerated message types."),
            onError: (error) => console.error(`[next-fluent] Type generation failed: ${error.message}`)
          });
        }
      } catch (error) {
        console.error(`[next-fluent] Type generation failed: ${error.message}`);
      }
    }
    const resolvedPath = import_node_path.default.resolve(process.cwd(), i18nRequestPath);
    const relativePath = import_node_path.default.relative(process.cwd(), resolvedPath).split(import_node_path.default.sep).join("/");
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createNextFluentPlugin
});

// A CommonJS `next.config.js` calls `require('next-fluent/plugin')(config)`, so
// the module has to *be* the factory rather than a namespace holding it. Read
// through `module.exports`: esbuild already reassigned it, and the `exports`
// binding still points at the original empty object.
module.exports = Object.assign(module.exports.default, module.exports);
