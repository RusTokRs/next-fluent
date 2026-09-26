import fs from "node:fs";
import path from "node:path";
import { jsonToFluent } from "./catalog.js";
import { generateTypeDeclarations } from "./typegen.js";
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
    if (entry.isDirectory()) files.push(...collectCatalogFiles(full));
    else if (entry.isFile() && isCatalogFile(entry.name)) files.push(full);
  }
  return files.sort();
}
function readCatalog(file) {
  const raw = fs.readFileSync(file, "utf8");
  return file.toLowerCase().endsWith(".json") ? jsonToFluent(JSON.parse(raw)) : raw;
}
function readCatalogsByLocale(dir) {
  const catalogs = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const files = collectCatalogFiles(full);
      if (files.length > 0) catalogs[entry.name] = files.map(readCatalog);
    } else if (entry.isFile() && isCatalogFile(entry.name)) {
      const locale = path.basename(entry.name, path.extname(entry.name));
      (catalogs[locale] ??= []).push(readCatalog(full));
    }
  }
  return catalogs;
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
  const watcher = fs.watch(input, { recursive: true }, (_event, filename) => {
    if (filename && !isCatalogFile(String(filename))) return;
    regenerate();
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
export {
  CATALOG_EXTENSIONS,
  DEFAULT_CATALOG_DIRS,
  collectCatalogFiles,
  isCatalogFile,
  readCatalog,
  readCatalogsByLocale,
  watchCatalogs,
  writeTypeDeclarations
};
