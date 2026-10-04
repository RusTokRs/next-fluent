import fs from "node:fs";
import path from "node:path";
import { jsonToFluent } from "./catalog.js";
import { generateTypeDeclarations } from "./typegen.js";
import { canonicalizeLocale } from "./utils.js";
const CATALOG_EXTENSIONS = [".ftl", ".json"];
const DEFAULT_CATALOG_DIRS = ["messages", "locales", "src/messages", "src/locales"];
function isCatalogFile(name) {
  return CATALOG_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}
function collectCatalogFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return isCatalogFile(path.basename(target)) ? [target] : [];
  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        isFile = fs.statSync(full).isFile();
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
  const raw = fs.readFileSync(file, "utf8");
  if (!file.toLowerCase().endsWith(".json")) return raw;
  try {
    return jsonToFluent(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `[next-fluent] Cannot read the catalog ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function localeFromCatalogName(name) {
  const direct = canonicalizeLocale(name);
  if (direct) return direct;
  for (let index = name.length - 1; index > 0; index--) {
    const separator = name[index];
    if (separator !== "-" && separator !== "_" && separator !== ".") continue;
    const candidate = canonicalizeLocale(name.slice(0, index));
    if (candidate) return candidate;
  }
  return name;
}
function readCatalogsByLocale(dir) {
  const catalogs = /* @__PURE__ */ Object.create(null);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const files = collectCatalogFiles(full);
      if (files.length > 0) catalogs[localeFromCatalogName(entry.name)] = files.map(readCatalog);
    } else if (entry.isFile() && isCatalogFile(entry.name)) {
      const locale = localeFromCatalogName(path.basename(entry.name, path.extname(entry.name)));
      (catalogs[locale] ??= []).push(readCatalog(full));
    }
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
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
function collectSourceFiles(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_SOURCE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue;
      found.push(full);
    }
  };
  walk(dir);
  return found;
}
function writeTypeDeclarations(input, output) {
  const files = collectCatalogFiles(input);
  const content = generateTypeDeclarations(files.map(readCatalog));
  const previous = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
  if (previous === content) return { files, changed: false, output };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, "utf8");
  return { files, changed: true, output };
}
function catalogSnapshot(dir) {
  try {
    return collectCatalogFiles(dir).map((file) => {
      const stats = fs.statSync(file);
      return `${path.relative(dir, file)}:${stats.mtimeMs}:${stats.size}`;
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
  let stats;
  try {
    stats = fs.statSync(input, { throwIfNoEntry: false });
  } catch {
    stats = void 0;
  }
  if (!stats?.isDirectory()) {
    handlers.onError?.(
      new Error(`[next-fluent] Cannot watch ${input}: it is not a directory.`)
    );
    return () => clearTimeout(timer);
  }
  let watcher;
  try {
    watcher = fs.watch(input, { recursive: true }, (_event, filename) => {
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
export {
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
};
