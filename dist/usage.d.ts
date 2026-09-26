import { type MessageSource } from './catalog';
/**
 * Usage analysis: the inverse of message extraction.
 *
 * `next-intl extract` scans source code because there the code is the source of
 * truth and the JSON catalog is a hand-maintained shadow. next-fluent inverts
 * that: the catalog is the source of truth and `typegen` derives types from it,
 * so `t('unknown')` is already a compile error.
 *
 * What static types cannot tell you is the other direction — which catalog
 * messages nobody renders any more, and which call sites are too dynamic to
 * verify. This module answers exactly that, and never writes to a catalog.
 */
export type UsageIssueKind = 'unused' | 'missing' | 'dynamic' | 'missing-attributes';
export interface UsageIssue {
    kind: UsageIssueKind;
    /** Catalog key the issue is about, when there is one. */
    key?: string;
    /** Source file the issue was found in, for call-site issues. */
    file?: string;
    line?: number;
    message: string;
}
export interface UsageReport {
    referenceLocale: string;
    catalogKeys: string[];
    usedKeys: string[];
    /** Call sites whose key could not be resolved statically. */
    dynamicSites: number;
    issues: UsageIssue[];
}
export interface AnalyzeUsageOptions {
    /** Locale whose key set defines the catalog. Defaults to the first key. */
    referenceLocale?: string;
    /** Report catalog keys that no call site references. Defaults to `true`. */
    reportUnused?: boolean;
    /** Key prefixes exempt from the `unused` report (e.g. dynamically built namespaces). */
    ignore?: readonly string[];
}
/** One source file to scan. */
export interface SourceFile {
    path: string;
    content: string;
}
declare const CALL_METHODS: readonly ["rich", "attrs", "plain", "markup", "has", "exists"];
type CallMethod = (typeof CALL_METHODS)[number];
/** Comment marker exempting a call site from the usage report. */
export declare const IGNORE_MARKER = "next-fluent-ignore";
interface CallSite {
    method: CallMethod | undefined;
    /** Raw source of the first argument. */
    argument: string;
    line: number;
}
/** Finds translator bindings and the call sites that use them. */
export declare function collectCallSites(file: SourceFile): {
    bindings: Map<string, string | undefined>;
    sites: (CallSite & {
        namespace?: string;
        ignored: boolean;
    })[];
};
/**
 * Compares a catalog against the call sites found in `sources`.
 *
 * Deliberately conservative: anything that cannot be resolved to a literal key
 * is reported as `dynamic` instead of being guessed at, so the `unused` report
 * never claims a message is dead just because the analyzer could not see it.
 */
export declare function analyzeUsage(catalogs: Record<string, MessageSource>, sources: readonly SourceFile[], options?: AnalyzeUsageOptions): UsageReport;
/** Human-readable rendering of a usage report, grouped by severity. */
export declare function formatUsageReport(report: UsageReport): string;
export {};
