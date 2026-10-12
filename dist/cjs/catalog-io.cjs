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
var catalog_io_exports = {};
__export(catalog_io_exports, {
  CATALOG_EXTENSIONS: () => CATALOG_EXTENSIONS,
  DEFAULT_CATALOG_DIRS: () => DEFAULT_CATALOG_DIRS,
  collectCatalogFiles: () => collectCatalogFiles,
  collectSourceFiles: () => collectSourceFiles,
  isCatalogFile: () => isCatalogFile,
  localeFromCatalogName: () => localeFromCatalogName,
  readCatalog: () => readCatalog,
  readCatalogsByLocale: () => readCatalogsByLocale,
  watchCatalogs: () => watchCatalogs,
  writeTypeDeclarations: () => writeTypeDeclarations
});
module.exports = __toCommonJS(catalog_io_exports);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_catalog = require("./catalog.cjs");
var import_typegen = require("./typegen.cjs");
var import_utils = require("./utils.cjs");
const CATALOG_EXTENSIONS = [".ftl", ".json"];
const DEFAULT_CATALOG_DIRS = ["messages", "locales", "src/messages", "src/locales"];
function isCatalogFile(name) {
  return CATALOG_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}
function collectCatalogFiles(target) {
  if (!import_node_fs.default.existsSync(target)) return [];
  const stat = import_node_fs.default.statSync(target);
  if (!stat.isDirectory()) return isCatalogFile(import_node_path.default.basename(target)) ? [target] : [];
  const files = [];
  for (const entry of import_node_fs.default.readdirSync(target, { withFileTypes: true })) {
    const full = import_node_path.default.join(target, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        isFile = import_node_fs.default.statSync(full).isFile();
      } catch {
        continue;
      }
      isDir = false;
    }
    if (isDir) files.push(...collectCatalogFiles(full));
    else if (isFile && isCatalogFile(entry.name)) files.push(full);
  }
  return files.sort();
}
function readCatalog(file) {
  const raw = (0, import_catalog.stripCatalogBom)(import_node_fs.default.readFileSync(file, "utf8"));
  if (!file.toLowerCase().endsWith(".json")) return raw;
  try {
    return (0, import_catalog.jsonToFluent)(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `[next-fluent] Cannot read the catalog ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function localeFromCatalogName(name) {
  const direct = (0, import_utils.canonicalizeLocale)(name);
  if (direct) return direct;
  for (let index = name.length - 1; index > 0; index--) {
    const separator = name[index];
    if (separator !== "-" && separator !== "_" && separator !== ".") continue;
    const candidate = (0, import_utils.canonicalizeLocale)(name.slice(0, index));
    if (candidate) return candidate;
  }
  return name;
}
function readCatalogsByLocale(dir) {
  const catalogs = /* @__PURE__ */ Object.create(null);
  const root = import_node_path.default.resolve(dir);
  for (const file of collectCatalogFiles(dir)) {
    const relative = import_node_path.default.relative(root, import_node_path.default.resolve(file));
    const segments = relative.split(import_node_path.default.sep);
    const top = segments[0];
    const locale = segments.length > 1 ? localeFromCatalogName(top) : localeFromCatalogName(import_node_path.default.basename(top, import_node_path.default.extname(top)));
    (catalogs[locale] ??= []).push(readCatalog(file));
  }
  return catalogs;
}
const SKIPPED_SOURCE_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "out",
  "build",
  "coverage",
  ".turbo"
]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".mdx"];
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
function realPathOrNull(target) {
  try {
    return import_node_fs.default.realpathSync(target);
  } catch {
    return null;
  }
}
function collectSourceFiles(dir) {
  const found = [];
  const visitedDirs = /* @__PURE__ */ new Set();
  const seenFiles = /* @__PURE__ */ new Set();
  const walk = (current) => {
    let entries;
    try {
      entries = import_node_fs.default.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = import_node_path.default.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const linked = import_node_fs.default.statSync(full);
          isFile = linked.isFile();
          isDir = linked.isDirectory();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (SKIPPED_SOURCE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        const real2 = realPathOrNull(full);
        if (real2 === null || visitedDirs.has(real2)) continue;
        visitedDirs.add(real2);
        walk(full);
        continue;
      }
      if (!isFile) continue;
      if (DECLARATION_FILE.test(entry.name)) continue;
      if (!SOURCE_EXTENSIONS.includes(import_node_path.default.extname(entry.name))) continue;
      const real = realPathOrNull(full);
      if (real !== null) {
        if (seenFiles.has(real)) continue;
        seenFiles.add(real);
      }
      found.push(full);
    }
  };
  const root = realPathOrNull(dir);
  if (root !== null) visitedDirs.add(root);
  walk(dir);
  return found;
}
function writeTypeDeclarations(input, output) {
  const files = collectCatalogFiles(input);
  const content = (0, import_typegen.generateTypeDeclarations)(files.map(readCatalog));
  const previous = import_node_fs.default.existsSync(output) ? import_node_fs.default.readFileSync(output, "utf8") : null;
  if (previous === content) return { files, changed: false, output };
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(output), { recursive: true });
  import_node_fs.default.writeFileSync(output, content, "utf8");
  return { files, changed: true, output };
}
function catalogSnapshot(dir) {
  try {
    return collectCatalogFiles(dir).map((file) => {
      const stats = import_node_fs.default.statSync(file);
      return `${import_node_path.default.relative(dir, file)}:${stats.mtimeMs}:${stats.size}`;
    }).sort().join("|");
  } catch {
    return "";
  }
}
function watchCatalogs(input, output, handlers = {}) {
  let timer;
  const regenerate = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const result = writeTypeDeclarations(input, output);
        if (result.changed) handlers.onUpdate?.(result);
      } catch (error) {
        handlers.onError?.(error);
      }
    }, 50);
  };
  let stats;
  try {
    stats = import_node_fs.default.statSync(input, { throwIfNoEntry: false });
  } catch {
    stats = void 0;
  }
  if (!stats?.isDirectory()) {
    handlers.onError?.(
      new Error(`[next-fluent] Cannot watch ${input}: it is not a directory.`)
    );
    return () => clearTimeout(timer);
  }
  if (handlers.unref) {
    let signature = catalogSnapshot(input);
    const poller = setInterval(() => {
      const next = catalogSnapshot(input);
      if (next !== signature) {
        signature = next;
        regenerate();
      }
    }, handlers.intervalMs ?? 300);
    poller.unref?.();
    return () => {
      clearInterval(poller);
      clearTimeout(timer);
    };
  }
  let watcher;
  try {
    watcher = import_node_fs.default.watch(input, { recursive: true }, (_event, filename) => {
      if (filename && !isCatalogFile(String(filename))) return;
      regenerate();
    });
  } catch (error) {
    handlers.onError?.(error);
    return () => clearTimeout(timer);
  }
  watcher.on("error", (error) => handlers.onError?.(error));
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CATALOG_EXTENSIONS,
  DEFAULT_CATALOG_DIRS,
  collectCatalogFiles,
  collectSourceFiles,
  isCatalogFile,
  localeFromCatalogName,
  readCatalog,
  readCatalogsByLocale,
  watchCatalogs,
  writeTypeDeclarations
});
