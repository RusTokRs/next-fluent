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
/**
 * Regenerates on every catalog change (debounced). Returns a stop function.
 * Errors are reported through `onError` instead of killing the watcher.
 */
export declare function watchCatalogs(input: string, output: string, handlers?: {
    onUpdate?: (result: TypegenResult) => void;
    onError?: (error: Error) => void;
}): () => void;
