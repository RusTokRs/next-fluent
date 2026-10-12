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
/**
 * Recursively collects catalog files, sorted for deterministic output.
 *
 * The sort is the plain code-unit one, and it is load-bearing: Fluent resolves
 * a duplicate message id last-wins, so this order decides *which* of two
 * definitions survives. `localeCompare` would not do — it collates by the
 * process's ICU locale, so the winner changed between machines. `check` sorted
 * that way while this walk sorted by code units, and the two disagreed about
 * which catalog was "last" for the very message `check` tells the developer
 * Fluent keeps. Every consumer now derives its order from this walk instead of
 * sorting again; see `readCatalogsByLocale`.
 */
export declare function collectCatalogFiles(target: string): string[];
/** Reads a catalog file, converting JSON catalogs into FTL source. */
export declare function readCatalog(file: string): string;
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
export declare function localeFromCatalogName(name: string): string;
/**
 * Groups catalogs by locale: `messages/en.ftl` or `messages/en/app.ftl` → `en`.
 *
 * The file list comes from `collectCatalogFiles` rather than from a second,
 * independent directory walk. This function used to read the directory itself,
 * which diverged from the walk every other consumer uses in two ways:
 *
 * - **Symlinked catalogs were dropped.** A `Dirent` for a symlink is neither
 *   `isFile()` nor `isDirectory()`, so `messages/en.ftl → ../shared/en.ftl` —
 *   how a monorepo shares one catalog with several apps — never became a
 *   locale at all. `check` then elected a different reference locale, compared
 *   the rest against a smaller key set, and answered "No issues found" for
 *   translations that really were missing. `typegen`, in the same package and
 *   the same CLI invocation, read the same file without blinking.
 * - **The merge order followed `localeCompare`**, i.e. the process's ICU
 *   locale, while the runtime and `typegen` sort by code units. Fluent resolves
 *   a duplicate id last-wins, so the two disagreed about *which* definition
 *   survived: the validator pointed the developer at one entry to delete while
 *   the app shipped the other.
 *
 * Deriving the grouping from the same walk makes agreement structural instead
 * of something two implementations have to keep remembering. The locale of a
 * file is decided by its first path segment under `dir`: a segment that is a
 * directory names the locale (`en/app.ftl`), a segment that is the file itself
 * is a namespaced flat catalog (`en-app.ftl`).
 *
 * Directory symlinks stay out of both walks, exactly as in `collectCatalogFiles`:
 * following them recursively would let `messages/en → ..` loop forever.
 */
export declare function readCatalogsByLocale(dir: string): Record<string, string[]>;
/**
 * Collects source files worth scanning for message usage.
 *
 * Deliberately shallow about file *types*: `.d.ts` files are skipped because
 * they contain no call sites, only declarations.
 *
 * Symlinks are followed, which `collectCatalogFiles` deliberately does not do
 * for directories: a linked *directory* is a monorepo's `app/components →
 * packages/ui`, and every message used only there was reported as dead —
 * a false accusation that `check --usage` is expected to lead people to act
 * on. The cost is that a cycle becomes possible (`app/components → .. → app`),
 * so the real path of every visited directory and every collected file is
 * remembered: a repeat is skipped rather than walked or counted twice.
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
