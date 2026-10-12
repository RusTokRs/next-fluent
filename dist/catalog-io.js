import fs from "node:fs";
import path from "node:path";
import { jsonToFluent, stripCatalogBom } from "./catalog.js";
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
  const raw = stripCatalogBom(fs.readFileSync(file, "utf8"));
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
  const root = path.resolve(dir);
  for (const file of collectCatalogFiles(dir)) {
    const relative = path.relative(root, path.resolve(file));
    const segments = relative.split(path.sep);
    const top = segments[0];
    const locale = segments.length > 1 ? localeFromCatalogName(top) : localeFromCatalogName(path.basename(top, path.extname(top)));
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
    return fs.realpathSync(target);
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
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const linked = fs.statSync(full);
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
      if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue;
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
