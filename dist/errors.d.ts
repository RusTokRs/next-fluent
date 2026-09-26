/**
 * Structured error reporting for message resolution and formatting.
 *
 * Mirrors the `onError` / `getMessageFallback` contract popularized by
 * next-intl so applications can route localization failures into their own
 * monitoring instead of relying on hard-coded `console` output.
 */
export declare const FluentErrorCode: {
    /** The key does not exist in any bundle of the fallback chain. */
    readonly MISSING_MESSAGE: "MISSING_MESSAGE";
    /** The message exists but Fluent could not format it. */
    readonly FORMATTING_ERROR: "FORMATTING_ERROR";
    /** An argument passed to `t()` is not a valid Fluent variable. */
    readonly INVALID_ARGUMENT: "INVALID_ARGUMENT";
    /** A React element was interpolated through a string-only API. */
    readonly UNSUPPORTED_VALUE: "UNSUPPORTED_VALUE";
    /** A less specific locale had to be used for the request. */
    readonly ENVIRONMENT_FALLBACK: "ENVIRONMENT_FALLBACK";
};
export type FluentErrorCode = (typeof FluentErrorCode)[keyof typeof FluentErrorCode];
export interface FluentErrorDetails {
    code: FluentErrorCode;
    /** The key as it was requested (without namespace). */
    key: string;
    namespace?: string;
    locale?: string;
    /** Underlying Fluent/Intl errors, when available. */
    cause?: unknown;
    /** Overrides the generated human-readable message. */
    message?: string;
}
export declare class FluentError extends Error {
    readonly code: FluentErrorCode;
    readonly key: string;
    readonly namespace: string | undefined;
    readonly locale: string | undefined;
    constructor(details: FluentErrorDetails);
    /** Fully qualified key, e.g. `nav.home`. */
    get path(): string;
}
export interface MessageFallbackArgs {
    namespace?: string;
    key: string;
    error: FluentError;
}
export type OnErrorFn = (error: FluentError) => void;
export type GetMessageFallbackFn = (args: MessageFallbackArgs) => string;
export interface ErrorHandlingOptions {
    onError?: OnErrorFn;
    getMessageFallback?: GetMessageFallbackFn;
    /** Renders `[MISSING: key]` and keeps the legacy development warnings. */
    debug?: boolean;
}
export declare const defaultMessageFallback: ({ namespace, key }: MessageFallbackArgs) => string;
/**
 * Creates the reporting pair used by translators. A throwing `onError` or
 * `getMessageFallback` handler can never break rendering: failures are
 * swallowed (and reported once) so a broken logger does not take the page down.
 */
export declare function createErrorReporter(options?: ErrorHandlingOptions): (details: FluentErrorDetails) => string;
export type ReportErrorFn = ReturnType<typeof createErrorReporter>;
