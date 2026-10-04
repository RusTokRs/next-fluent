import fs from 'node:fs';
import path from 'node:path';
import { jsonToFluent } from './catalog';
import { generateTypeDeclarations } from './typegen';
import { canonicalizeLocale } from './utils';

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
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      // A symlink is neither isFile() nor isDirectory(), so linked catalogs
      // were silently dropped. Follow the link to classify it — but only ever
      // treat it as a file, so a directory symlink cannot create a cycle.
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

/** Reads a catalog file, converting JSON catalogs into FTL source. */
export function readCatalog(file: string): string {
  const raw = fs.readFileSync(file, 'utf8');
  if (!file.toLowerCase().endsWith('.json')) return raw;
  try {
    return jsonToFluent(JSON.parse(raw));
  } catch (error) {
    // A bare "Unexpected end of JSON input" says nothing about which of the
    // project's many locale files is broken.
    throw new Error(
      `[next-fluent] Cannot read the catalog ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Locale a catalog name belongs to: `en` → `en`, `en-app` → `en`.
 *
 * A flat `en-app.json` is a namespaced catalog for `en`, not a locale called
 * `en-app` (`Intl` rejects that tag), and treating it as one made `check`
 * compare the FTL catalogs against a JSON namespace file — and even elect it as
 * the reference locale, because `en-app` sorts before `en`/`ru`. The locale is
 * the longest valid tag prefix of the name; the remainder is a namespace label
 * that only decides which files are merged.
 *
 * Names that are not locale-like at all keep their raw stem, so a catalog such
 * as `__proto__.ftl` is still reported instead of being dropped or crashing.
 */
export function localeFromCatalogName(name: string): string {
  const direct = canonicalizeLocale(name);
  if (direct) return direct;
  for (let index = name.length - 1; index > 0; index--) {
    const separator = name[index];
    if (separator !== '-' && separator !== '_' && separator !== '.') continue;
    const candidate = canonicalizeLocale(name.slice(0, index));
    if (candidate) return candidate;
  }
  return name;
}

/** Groups catalogs by locale: `messages/en.ftl` or `messages/en/app.ftl` → `en`. */
export function readCatalogsByLocale(dir: string): Record<string, string[]> {
  // Null prototype: a catalog named `__proto__.ftl` must be a normal key, not a
  // prototype assignment (which crashed the check command outright).
  const catalogs: Record<string, string[]> = Object.create(null);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
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

/** Directories never worth scanning for translator call sites. */
const SKIPPED_SOURCE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'build',
  'coverage',
  '.turbo',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Collects source files worth scanning for message usage.
 *
 * Deliberately shallow about file *types*: `.d.ts` files are skipped because
 * they contain no call sites, only declarations.
 */
export function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_SOURCE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue;
      found.push(full);
    }
  };
  walk(dir);
  return found;
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

export interface WatchCatalogsOptions {
  onUpdate?: (result: TypegenResult) => void;
  onError?: (error: Error) => void;
  /**
   * Poll on an unref'd timer instead of using `fs.watch`, so the watcher never
   * keeps a process alive. Set by the Next.js plugin: `next build` must be able
   * to exit even though the config evaluated a watcher.
   */
  unref?: boolean;
  /** Polling interval in ms when `unref` is set. Defaults to 300. */
  intervalMs?: number;
}

/** Signature of every catalog file: name, mtime and size. */
function catalogSnapshot(dir: string): string {
  try {
    return collectCatalogFiles(dir)
      .map((file) => {
        const stats = fs.statSync(file);
        return `${path.relative(dir, file)}:${stats.mtimeMs}:${stats.size}`;
      })
      .sort()
      .join('|');
  } catch {
    return '';
  }
}

/**
 * Regenerates on every catalog change (debounced). Returns a stop function.
 * Errors are reported through `onError` instead of killing the watcher.
 *
 * With `unref` the watcher polls on an unref'd timer instead of using
 * `fs.watch`: a recursive `fs.watch` keeps the event loop alive even after
 * `unref()` on Linux, which would stop `next build` from ever exiting.
 */
export function watchCatalogs(
  input: string,
  output: string,
  handlers: WatchCatalogsOptions = {}
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

  // `fs.watch` does not fail consistently: on Linux/Node 22 a missing directory
  // throws synchronously, but Node 24 and Windows hand back a watcher that never
  // fires and never reports, leaving the dev watcher silently dead. Checking the
  // target first turns that into the `onError` the callers already expect.
  let stats: fs.Stats | undefined;
  try {
    stats = fs.statSync(input, { throwIfNoEntry: false });
  } catch {
    stats = undefined;
  }
  if (!stats?.isDirectory()) {
    handlers.onError?.(
      new Error(`[next-fluent] Cannot watch ${input}: it is not a directory.`)
    );
    return () => clearTimeout(timer);
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(input, { recursive: true }, (_event, filename) => {
      if (filename && !isCatalogFile(String(filename))) return;
      regenerate();
    });
  } catch (error) {
    handlers.onError?.(error as Error);
    return () => clearTimeout(timer);
  }

  // Errors raised after the watcher exists (the directory disappears, the
  // inotify limit is reached) are emitted asynchronously; without a listener
  // Node treats them as uncaught exceptions.
  watcher.on('error', (error) => handlers.onError?.(error as Error));

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
