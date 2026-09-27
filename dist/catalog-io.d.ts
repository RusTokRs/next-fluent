/**
 * Node-side catalog I/O shared by the CLI and the Next.js plugin.
 *
 * Kept separate from `typegen.ts` on purpose: that module is re-exported from
 * the browser entry, and pulling `node:fs` into it would ship a Node dependency
 * to every client bundle.
 */
export declare const CATALOG_EXTENSIONS: string[];
/** Directories probed when a command runs without `--input`. */
export declare const DEFAULT_CATALOG_DIRS: string[];
export declare function isCatalogFile(name: string): boolean;
/** Recursively collects catalog files, sorted for deterministic output. */
export declare function collectCatalogFiles(target: string): string[];
/** Reads a catalog file, converting JSON catalogs into FTL source. */
export declare function readCatalog(file: string): string;
/** Groups catalogs by locale: `messages/en.ftl` or `messages/en/app.ftl` → `en`. */
export declare function readCatalogsByLocale(dir: string): Record<string, string[]>;
/**
 * Collects source files worth scanning for message usage.
 *
 * Deliberately shallow about file *types*: `.d.ts` files are skipped because
 * they contain no call sites, only declarations.
 */
export declare function collectSourceFiles(dir: string): string[];
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
export declare function writeTypeDeclarations(input: string, output: string): TypegenResult;
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
/**
 * Regenerates on every catalog change (debounced). Returns a stop function.
 * Errors are reported through `onError` instead of killing the watcher.
 *
 * With `unref` the watcher polls on an unref'd timer instead of using
 * `fs.watch`: a recursive `fs.watch` keeps the event loop alive even after
 * `unref()` on Linux, which would stop `next build` from ever exiting.
 */
export declare function watchCatalogs(input: string, output: string, handlers?: WatchCatalogsOptions): () => void;
