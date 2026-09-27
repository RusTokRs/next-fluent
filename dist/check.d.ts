import { type MessageSource } from './catalog';
/**
 * Catalog consistency checking (`next-fluent check`).
 *
 * Missing translations usually surface as runtime fallbacks in production. This
 * compares every locale against a reference catalog and reports keys that are
 * missing, unexpected, duplicated or unparsable — before the app ships.
 */
export type CatalogIssueKind = 'missing' | 'extra' | 'duplicate' | 'parse-error';
export interface CatalogIssue {
    kind: CatalogIssueKind;
    locale: string;
    key?: string;
    message: string;
}
export interface CheckReport {
    referenceLocale: string;
    locales: string[];
    issues: CatalogIssue[];
    keyCount: number;
}
export interface CheckCatalogsOptions {
    /** Locale every other catalog is compared against. Defaults to the first key. */
    referenceLocale?: string;
    /** Report keys that exist in a locale but not in the reference. Default `true`. */
    reportExtra?: boolean;
}
/**
 * Compares catalogs against a reference locale.
 *
 * `catalogs` maps a locale to anything `loadMessages` may return (FTL text, an
 * array of sources, or a JSON catalog object).
 */
export declare function checkCatalogs(catalogs: Record<string, MessageSource>, options?: CheckCatalogsOptions): CheckReport;
/** Human-readable rendering of a report, suitable for CI output. */
export declare function formatCheckReport(report: CheckReport): string;
