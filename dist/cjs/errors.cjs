"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var errors_exports = {};
__export(errors_exports, {
  FluentError: () => FluentError,
  FluentErrorCode: () => FluentErrorCode,
  createErrorReporter: () => createErrorReporter,
  defaultMessageFallback: () => defaultMessageFallback
});
module.exports = __toCommonJS(errors_exports);
const FluentErrorCode = {
  /** The key does not exist in any bundle of the fallback chain. */
  MISSING_MESSAGE: "MISSING_MESSAGE",
  /** The message exists but Fluent could not format it. */
  FORMATTING_ERROR: "FORMATTING_ERROR",
  /** An argument passed to `t()` is not a valid Fluent variable. */
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  /** A React element was interpolated through a string-only API. */
  UNSUPPORTED_VALUE: "UNSUPPORTED_VALUE",
  /** A less specific locale had to be used for the request. */
  ENVIRONMENT_FALLBACK: "ENVIRONMENT_FALLBACK"
};
class FluentError extends Error {
  code;
  key;
  namespace;
  locale;
  constructor(details) {
    super(details.message ?? describe(details));
    this.name = "FluentError";
    this.code = details.code;
    this.key = details.key;
    this.namespace = details.namespace;
    this.locale = details.locale;
    if (details.cause !== void 0) {
      this.cause = details.cause;
    }
  }
  /** Fully qualified key, e.g. `nav.home`. */
  get path() {
    return this.namespace ? `${this.namespace}.${this.key}` : this.key;
  }
}
function describe(details) {
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
function localeSuffix(locale) {
  return locale ? ` (locale: ${locale})` : "";
}
const defaultMessageFallback = ({ namespace, key }) => namespace ? `${namespace}.${key}` : key;
const SEVERE_CODES = [
  FluentErrorCode.FORMATTING_ERROR,
  FluentErrorCode.INVALID_ARGUMENT,
  FluentErrorCode.UNSUPPORTED_VALUE
];
const defaultOnError = (error) => {
  const log = SEVERE_CODES.includes(error.code) ? console.error : console.warn;
  log(error.message, error.cause ?? "");
};
function createErrorReporter(options = {}) {
  const onError = options.onError ?? defaultOnError;
  const getMessageFallback = options.getMessageFallback ?? (options.debug ? ({ namespace, key }) => `[MISSING: ${namespace ? `${namespace}.${key}` : key}]` : defaultMessageFallback);
  return function report(details) {
    const error = new FluentError(details);
    try {
      onError(error);
    } catch {
    }
    try {
      const fallback = getMessageFallback({
        namespace: details.namespace,
        key: details.key,
        error
      });
      return typeof fallback === "string" ? fallback : defaultMessageFallback({
        namespace: details.namespace,
        key: details.key,
        error
      });
    } catch {
      return defaultMessageFallback({ namespace: details.namespace, key: details.key, error });
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FluentError,
  FluentErrorCode,
  createErrorReporter,
  defaultMessageFallback
});
