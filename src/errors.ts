/**
 * Structured error reporting for message resolution and formatting.
 *
 * Mirrors the `onError` / `getMessageFallback` contract popularized by
 * next-intl so applications can route localization failures into their own
 * monitoring instead of relying on hard-coded `console` output.
 */

export const FluentErrorCode = {
  /** The key does not exist in any bundle of the fallback chain. */
  MISSING_MESSAGE: 'MISSING_MESSAGE',
  /** The message exists but Fluent could not format it. */
  FORMATTING_ERROR: 'FORMATTING_ERROR',
  /** An argument passed to `t()` is not a valid Fluent variable. */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  /** A React element was interpolated through a string-only API. */
  UNSUPPORTED_VALUE: 'UNSUPPORTED_VALUE',
  /** A less specific locale had to be used for the request. */
  ENVIRONMENT_FALLBACK: 'ENVIRONMENT_FALLBACK',
} as const;

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

export class FluentError extends Error {
  readonly code: FluentErrorCode;
  readonly key: string;
  readonly namespace: string | undefined;
  readonly locale: string | undefined;

  constructor(details: FluentErrorDetails) {
    super(details.message ?? describe(details));
    this.name = 'FluentError';
    this.code = details.code;
    this.key = details.key;
    this.namespace = details.namespace;
    this.locale = details.locale;
    if (details.cause !== undefined) {
      (this as { cause?: unknown }).cause = details.cause;
    }
  }

  /** Fully qualified key, e.g. `nav.home`. */
  get path(): string {
    return this.namespace ? `${this.namespace}.${this.key}` : this.key;
  }
}

function describe(details: FluentErrorDetails): string {
  const path = details.namespace ? `${details.namespace}.${details.key}` : details.key;
  switch (details.code) {
    case FluentErrorCode.MISSING_MESSAGE:
      return `[next-fluent] Missing message "${path}"${localeSuffix(details.locale)}`;
    case FluentErrorCode.FORMATTING_ERROR:
      return `[next-fluent] Could not format message "${path}"${localeSuffix(details.locale)}`;
    case FluentErrorCode.INVALID_ARGUMENT:
      return `[next-fluent] Invalid argument for message "${path}"${localeSuffix(details.locale)}`;
    case FluentErrorCode.UNSUPPORTED_VALUE:
      return `[next-fluent] Unsupported value for message "${path}"${localeSuffix(details.locale)}`;
    case FluentErrorCode.ENVIRONMENT_FALLBACK:
      return `[next-fluent] Environment fallback for message "${path}"${localeSuffix(details.locale)}`;
    default:
      return `[next-fluent] Localization error for "${path}"`;
  }
}

function localeSuffix(locale?: string): string {
  return locale ? ` (locale: ${locale})` : '';
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

export const defaultMessageFallback = ({ namespace, key }: MessageFallbackArgs): string =>
  namespace ? `${namespace}.${key}` : key;

/** Codes that indicate a developer bug rather than an incomplete catalog. */
const SEVERE_CODES: readonly FluentErrorCode[] = [
  FluentErrorCode.FORMATTING_ERROR,
  FluentErrorCode.INVALID_ARGUMENT,
  FluentErrorCode.UNSUPPORTED_VALUE,
];

const defaultOnError: OnErrorFn = (error) => {
  const log = SEVERE_CODES.includes(error.code) ? console.error : console.warn;
  log(error.message, (error as { cause?: unknown }).cause ?? '');
};

/**
 * Creates the reporting pair used by translators. A throwing `onError` or
 * `getMessageFallback` handler can never break rendering: failures are
 * swallowed (and reported once) so a broken logger does not take the page down.
 */
export function createErrorReporter(options: ErrorHandlingOptions = {}) {
  const onError = options.onError ?? defaultOnError;
  const getMessageFallback =
    options.getMessageFallback ??
    (options.debug
      ? ({ namespace, key }: MessageFallbackArgs) =>
          `[MISSING: ${namespace ? `${namespace}.${key}` : key}]`
      : defaultMessageFallback);

  return function report(details: FluentErrorDetails): string {
    const error = new FluentError(details);
    try {
      onError(error);
    } catch {
      // Never let a broken error handler break the render.
    }
    try {
      const fallback = getMessageFallback({
        namespace: details.namespace,
        key: details.key,
        error,
      });
      return typeof fallback === 'string' ? fallback : defaultMessageFallback({
        namespace: details.namespace,
        key: details.key,
        error,
      });
    } catch {
      return defaultMessageFallback({ namespace: details.namespace, key: details.key, error });
    }
  };
}

export type ReportErrorFn = ReturnType<typeof createErrorReporter>;
