import fs from 'node:fs';
import path from 'node:path';
import { jsonToFluent } from './catalog';
import { generateTypeDeclarations } from './typegen';

/**
 * Node-side catalog I/O shared by the CLI and the Next.js plugin.
 *
 * Kept separate from `typegen.ts` on purpose: that module is re-exported from
 * the browser entry, and pulling `node:fs` into it would ship a Node dependency
 * to every client bundle.
 */

export const CATALOG_EXTENSIONS = ['.ftl', '.json'];

/** Directories probed when a command runs without `--input`. */
export const DEFAULT_CATALOG_DIRS = ['messages', 'locales', 'src/messages', 'src/locales'];

export function isCatalogFile(name: string): boolean {
  return CATALOG_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

/** Recursively collects catalog files, sorted for deterministic output. */
export function collectCatalogFiles(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return isCatalogFile(path.basename(target)) ? [target] : [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...collectCatalogFiles(full));
    else if (entry.isFile() && isCatalogFile(entry.name)) files.push(full);
  }
  return files.sort();
}

/** Reads a catalog file, converting JSON catalogs into FTL source. */
export function readCatalog(file: string): string {
  const raw = fs.readFileSync(file, 'utf8');
  return file.toLowerCase().endsWith('.json') ? jsonToFluent(JSON.parse(raw)) : raw;
}

/** Groups catalogs by locale: `messages/en.ftl` or `messages/en/app.ftl` → `en`. */
export function readCatalogsByLocale(dir: string): Record<string, string[]> {
  const catalogs: Record<string, string[]> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
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

export interface TypegenResult {
  files: string[];
  changed: boolean;
  output: string;
}

/**
 * Generates and writes the message declarations for `input`.
 *
 * The write is skipped when the content is unchanged, so watchers and editors
 * are not woken up by no-op regenerations.
 */
export function writeTypeDeclarations(input: string, output: string): TypegenResult {
  const files = collectCatalogFiles(input);
  const content = generateTypeDeclarations(files.map(readCatalog));

  const previous = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
  if (previous === content) return { files, changed: false, output };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content, 'utf8');
  return { files, changed: true, output };
}

/**
 * Regenerates on every catalog change (debounced). Returns a stop function.
 * Errors are reported through `onError` instead of killing the watcher.
 */
export function watchCatalogs(
  input: string,
  output: string,
  handlers: { onUpdate?: (result: TypegenResult) => void; onError?: (error: Error) => void } = {}
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const regenerate = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const result = writeTypeDeclarations(input, output);
        if (result.changed) handlers.onUpdate?.(result);
      } catch (error) {
        handlers.onError?.(error as Error);
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
