/**
 * JSON catalog support.
 *
 * Fluent catalogs are `.ftl` text, but a lot of tooling (translation vendors,
 * CMS exports, existing i18n setups) speaks JSON. Accepting a plain object
 * wherever FTL text is accepted makes migration a copy-paste instead of a
 * rewrite: next-intl users can hand over their `en.json` unchanged.
 *
 * Mapping rules:
 * - Nested objects become namespaced ids joined with `-`
 *   (`{ nav: { home } }` → `nav-home`, addressable as `t('nav.home')`).
 * - `{$count}` / `{count}` placeholders become Fluent variables (`{ $count }`).
 * - A `""` key holds the message value; its siblings become attributes, so
 *   JSON can express `.label` / `.aria-label`.
 */
/** Anything accepted where a catalog is expected. */
export type MessageSource = string | readonly string[] | JsonCatalog;
export type JsonCatalog = Record<string, unknown>;
/** Type guard distinguishing a JSON catalog from a `FluentBundle` instance. */
export declare function isJsonCatalog(value: unknown): value is JsonCatalog;
/** Renders a value as an inline pattern or an indented block pattern. */
export declare function renderFluentPattern(text: string): string;
/** Converts a JSON catalog object into FTL source. */
export declare function jsonToFluent(catalog: JsonCatalog): string;
/**
 * Normalizes any accepted catalog shape to what a `FluentBundle` can consume.
 * JSON objects are converted; strings and arrays pass through untouched.
 */
export declare function toFluentSource(messages: MessageSource): string | readonly string[];
