import { FluentNumber, FluentType, type FluentBundle } from '@fluent/bundle';
import React from 'react';
import type {
  FluentArgs,
  FluentVariable,
  GetMessageFallbackFn,
  OnErrorFn,
  RichTranslationValues,
  Translations,
} from './types';
import { buildKeyCandidates, canonicalizeLocale, withKebabKey } from './utils';
import { toFluentSource, type MessageSource } from './catalog';
import {
  parseRichText,
  stripRichText,
  createReactElementToken,
  REACT_ELEMENT_TOKEN_PREFIX,
} from './rich';
import {
  getCachedFluentBundle,
  clearBundleCache as clearInternalBundleCache,
  getBundleCacheStats,
  LRUCache,
  type CreateFluentBundleOptions,
} from './cache';
import { clearFunctionsCache } from './functions';
import {
  FluentErrorCode,
  FluentError,
  createErrorReporter,
  type FluentErrorDetails,
} from './errors';

export function clearBundleCache(): void {
  clearInternalBundleCache();
  clearFunctionsCache();
}

export {
  getCachedFluentBundle,
  clearFunctionsCache,
  getBundleCacheStats,
  LRUCache,
  FluentError,
  FluentErrorCode,
  type CreateFluentBundleOptions,
};

function fluentBundleLocaleDiagnostic(locale: unknown): string {
  if (typeof locale !== 'string') {
    const kind = locale === null ? 'null' : typeof locale;
    return `<non-string locale: ${kind}>`;
  }
  if (locale.length > 64) {
    return `<oversized locale: ${locale.length} code units>`;
  }
  return locale;
}

export function createFluentBundle(
  locale: string,
  ftlSource: MessageSource,
  options: CreateFluentBundleOptions = {}
): FluentBundle {
  const canonicalLocale = canonicalizeLocale(locale);
  if (!canonicalLocale) {
    throw new Error(
      `[next-fluent] Invalid Fluent bundle locale: "${fluentBundleLocaleDiagnostic(locale)}"`
    );
  }

  // JSON catalogs are converted here so every entry point (provider, server
  // config, explicit messages) accepts the same three shapes.
  return getCachedFluentBundle(canonicalLocale, toFluentSource(ftlSource), options);
}

export interface CreateTranslatorOptions {
  fallbackBundle?: FluentBundle | null;
  fallbackBundles?: FluentBundle | readonly FluentBundle[] | null;
  namespace?: string;
  debug?: boolean;
  defaultTranslationValues?: RichTranslationValues;
  strictNamespace?: boolean;
  onError?: OnErrorFn;
  getMessageFallback?: GetMessageFallbackFn;
}

type FormatCandidateResult =
  | { kind: 'ok'; value: string }
  | { kind: 'error'; errors: readonly Error[] }
  | { kind: 'missing' };
type RawCandidateResult = string[] | string | null;

function stripBidiIsolates(value: string): string {
  return value.replace(/[\u2068\u2069]/g, '');
}

interface BuiltArgs {
  args: FluentArgs;
  /** Names of values Fluent cannot represent; kept for error reporting. */
  rejected: string[];
}

/**
 * Converts user-facing translation values into Fluent arguments.
 *
 * React elements become placeholder tokens that `parseRichText` resolves later.
 * Fluent has no boolean type, so booleans are stringified (`true`/`"true"`)
 * instead of being dropped — dropping them turned every message that used the
 * variable into an unresolvable reference.
 */
function buildFluentArgs(values: Record<string, unknown> | undefined): BuiltArgs {
  const args: FluentArgs = {};
  const rejected: string[] = [];
  if (!values) return { args, rejected };

  for (const [k, v] of Object.entries(values)) {
    if (React.isValidElement(v)) {
      args[k] = createReactElementToken(k);
      continue;
    }
    if (v === null || v === undefined) {
      rejected.push(k);
      continue;
    }
    if (typeof v === 'string' || typeof v === 'number' || v instanceof Date) {
      args[k] = v as FluentVariable;
      continue;
    }
    if (typeof v === 'boolean') {
      args[k] = String(v);
      continue;
    }
    if (typeof v === 'bigint') {
      // `Number(v)` rounds past 2^53, so a 64-bit id lost its last digit, and
      // it overflows to Infinity for anything larger — both silently. Keep the
      // exact digits instead: Intl.NumberFormat formats numeric strings
      // exactly. Past the double range even Intl cannot represent the value,
      // and the raw digits beat rendering "∞".
      const digits = v.toString();
      // The typings declare `FluentNumber(number)`, but it forwards the value
      // to Intl.NumberFormat, which formats numeric strings exactly (ES2023
      // Intl.NumberFormat v3). A test pins the exact digits, so a change
      // upstream cannot silently reintroduce the rounding.
      args[k] = Number.isFinite(Number(digits))
        ? new FluentNumber(digits as unknown as number)
        : digits;
      continue;
    }
    if (
      v instanceof FluentType ||
      (typeof v === 'object' &&
        'value' in v &&
        typeof (v as { valueOf?: unknown }).valueOf === 'function')
    ) {
      // FluentType instances (FluentNumber/FluentDateTime/…) carry `value` and
      // `valueOf`, not `type`, so the previous `'type' in v` test never matched
      // and every one was rejected as an invalid argument. `instanceof` covers
      // the common case; the shape check keeps working when a project ends up
      // with two copies of @fluent/bundle.
      args[k] = v as FluentVariable;
      continue;
    }
    rejected.push(k);
  }

  return { args, rejected };
}

export function createTranslator(
  bundle: FluentBundle | null,
  namespaceOrFallbackOrOpts?: string | FluentBundle | CreateTranslatorOptions | null,
  maybeNamespace?: string
): Translations {
  const allBundles: FluentBundle[] = [];
  if (bundle) allBundles.push(bundle);

  let namespace: string | undefined;
  let debug = false;
  let defaultTranslationValues: RichTranslationValues | undefined;
  let strictNamespace: boolean | undefined;
  let onError: OnErrorFn | undefined;
  let getMessageFallback: GetMessageFallbackFn | undefined;

  if (typeof namespaceOrFallbackOrOpts === 'string') {
    namespace = namespaceOrFallbackOrOpts;
  } else if (namespaceOrFallbackOrOpts && typeof namespaceOrFallbackOrOpts === 'object') {
    if ('locales' in namespaceOrFallbackOrOpts) {
      const fb = namespaceOrFallbackOrOpts as FluentBundle;
      if (!allBundles.includes(fb)) allBundles.push(fb);
      namespace = maybeNamespace;
    } else {
      const opts = namespaceOrFallbackOrOpts as CreateTranslatorOptions;
      if (opts.fallbackBundle && !allBundles.includes(opts.fallbackBundle)) {
        allBundles.push(opts.fallbackBundle);
      }
      if (opts.fallbackBundles) {
        const list = Array.isArray(opts.fallbackBundles)
          ? opts.fallbackBundles
          : [opts.fallbackBundles];
        for (const fb of list) {
          if (fb && !allBundles.includes(fb)) allBundles.push(fb);
        }
      }
      namespace = opts.namespace ?? maybeNamespace;
      debug = opts.debug ?? false;
      defaultTranslationValues = opts.defaultTranslationValues;
      strictNamespace = opts.strictNamespace;
      onError = opts.onError;
      getMessageFallback = opts.getMessageFallback;
    }
  } else {
    namespace = maybeNamespace;
  }

  const report = createErrorReporter({ onError, getMessageFallback, debug });
  const defaults = buildFluentArgs(defaultTranslationValues);

  const bundleLocale = (targetBundle: FluentBundle): string | undefined =>
    targetBundle.locales?.[0];

  const formatCandidate = (
    targetBundle: FluentBundle,
    candidate: string,
    args?: FluentArgs
  ): FormatCandidateResult => {
    const msg = targetBundle.getMessage(candidate);
    if (msg?.value) {
      const errors: Error[] = [];
      const formatted = targetBundle.formatPattern(msg.value, args, errors);
      if (errors.length > 0) return { kind: 'error', errors };
      return { kind: 'ok', value: formatted };
    }

    // Direct attribute access: e.g. 'dialog.confirm' or 'login-button.label'
    const lastDot = candidate.lastIndexOf('.');
    if (lastDot !== -1) {
      const msgId = candidate.slice(0, lastDot);
      const attrName = candidate.slice(lastDot + 1);
      const parentMsg =
        targetBundle.getMessage(msgId) ??
        targetBundle.getMessage(withKebabKey(msgId));

      if (parentMsg?.attributes) {
        const pattern =
          parentMsg.attributes[attrName] ??
          parentMsg.attributes[withKebabKey(attrName)];

        if (pattern) {
          const errors: Error[] = [];
          const formatted = targetBundle.formatPattern(pattern, args, errors);
          if (errors.length > 0) return { kind: 'error', errors };
          return { kind: 'ok', value: formatted };
        }
      }
    }

    return { kind: 'missing' };
  };

  /**
   * Formats a key to a plain string. Unresolvable keys go through the
   * configured `onError` / `getMessageFallback` pair. React element tokens may
   * survive in the output — `t()` rejects them while `t.rich()` resolves them.
   */
  const formatKey = (
    key: string,
    args: FluentArgs | undefined,
    rejectedArgs: readonly string[]
  ): string => {
    const mergedArgs =
      Object.keys(defaults.args).length > 0 || Object.keys(args ?? {}).length > 0
        ? { ...defaults.args, ...args }
        : undefined;
    const rejected =
      defaults.rejected.length > 0 || rejectedArgs.length > 0
        ? [...defaults.rejected, ...rejectedArgs]
        : undefined;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });

    for (const b of allBundles) {
      for (const candidate of candidates) {
        const formatted = formatCandidate(b, candidate, mergedArgs);
        if (formatted.kind === 'error') {
          // Never expose Fluent's partially formatted output. A message that
          // exists but cannot be formatted is a terminal resolution failure
          // rather than a silent fall-through to another locale.
          const details: FluentErrorDetails = rejected
            ? {
                code: FluentErrorCode.INVALID_ARGUMENT,
                key,
                namespace,
                locale: bundleLocale(b),
                cause: { unsupportedArguments: rejected, errors: formatted.errors },
              }
            : {
                code: FluentErrorCode.FORMATTING_ERROR,
                key,
                namespace,
                locale: bundleLocale(b),
                cause: formatted.errors,
              };
          return report(details);
        }
        if (formatted.kind === 'ok') return formatted.value;
      }
    }

    return report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
  };

  const tFn = ((key: string, args?: FluentArgs): string => {
    // Plain `t()` interpolations may contain React elements only by mistake —
    // resolve them to tokens first so a clear error can be raised, instead of
    // leaking placeholder tokens into strings or failing deep inside Fluent.
    const built = buildFluentArgs(args as Record<string, unknown>);
    const formatted = formatKey(key, built.args, built.rejected);
    if (formatted.includes(REACT_ELEMENT_TOKEN_PREFIX)) {
      const fallbackKey = namespace ? `${namespace}.${key}` : key;
      throw new FluentError({
        code: FluentErrorCode.UNSUPPORTED_VALUE,
        key,
        namespace,
        message:
          `[next-fluent] Message "${fallbackKey}" interpolates a React element. ` +
          'Use t.rich() or <FormattedMessage> for rich content.',
      });
    }
    return formatted;
  }) as Translations;

  /**
   * Formats a pattern for `raw()`. Unlike `t()`, unresolved references are not
   * fatal: missing variables render as `{ $name }`-style placeholders so the
   * raw text of a message is always available.
   */
  const formatRawPattern = (
    targetBundle: FluentBundle,
    pattern: Parameters<FluentBundle['formatPattern']>[0],
    args?: FluentArgs
  ): string => {
    const formatted = targetBundle.formatPattern(pattern, args, []) as string;
    return stripBidiIsolates(formatted);
  };

  const getRawValue = (
    targetBundle: FluentBundle,
    candidate: string,
    args?: FluentArgs
  ): RawCandidateResult => {
    const msg = targetBundle.getMessage(candidate);

    if (!msg) {
      const lastDot = candidate.lastIndexOf('.');
      if (lastDot !== -1) {
        const msgId = candidate.slice(0, lastDot);
        const attrName = candidate.slice(lastDot + 1);
        const parentMsg =
          targetBundle.getMessage(msgId) ??
          targetBundle.getMessage(withKebabKey(msgId));

        if (parentMsg?.attributes) {
          const pattern =
            parentMsg.attributes[attrName] ??
            parentMsg.attributes[withKebabKey(attrName)];

          if (pattern) {
            return formatRawPattern(targetBundle, pattern, args);
          }
        }
      }
      return null;
    }

    // The message value is the primary content; attributes are available via
    // `key.attr` or by reading a message that has attributes only.
    if (msg.value) {
      const rawText = formatRawPattern(targetBundle, msg.value, args);
      const trimmed = rawText.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map(String);
          }
        } catch {
          // fallback to raw text
        }
      }
      return rawText;
    }

    if (msg.attributes && Object.keys(msg.attributes).length > 0) {
      // Declaration order — sorting alphabetically detached the values from the
      // attribute names a caller sees in the catalog.
      return Object.keys(msg.attributes).map((attrKey) =>
        formatRawPattern(targetBundle, msg.attributes![attrKey], args)
      );
    }

    return null;
  };

  tFn.raw = ((key: string, args?: FluentArgs): string[] | string => {
    const built = buildFluentArgs(args as Record<string, unknown>);
    const mergedArgs =
      Object.keys(defaults.args).length > 0 || Object.keys(built.args).length > 0
        ? { ...defaults.args, ...built.args }
        : undefined;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const res = getRawValue(b, candidate, mergedArgs);
        if (res !== null && res !== undefined) return res;
      }
    }

    return report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
  }) as Translations['raw'];

  tFn.rich = (key: string, values?: RichTranslationValues): React.ReactNode => {
    const mergedValues =
      defaultTranslationValues || values
        ? { ...(defaultTranslationValues ?? {}), ...(values ?? {}) }
        : undefined;

    const built = buildFluentArgs(mergedValues as Record<string, unknown>);
    const formattedText = formatKey(key, built.args, built.rejected);
    return parseRichText(formattedText, mergedValues);
  };

  /**
   * Every attribute of a message, in declaration order.
   *
   * `t('id')` resolves the message value, so attributes such as `aria-label`
   * or `title` needed one lookup per attribute (`t('id.aria-label')`). This
   * returns them all at once, with the catalog's own ordering intact, for the
   * common case of spreading localized attributes onto an element.
   *
   * Bidi isolation marks are stripped because attribute values end up in HTML
   * attributes, where invisible characters are a bug rather than a feature.
   */
  tFn.attrs = ((key: string, args?: FluentArgs): Record<string, string> => {
    const built = buildFluentArgs(args as Record<string, unknown>);
    const mergedArgs =
      Object.keys(defaults.args).length > 0 || Object.keys(built.args).length > 0
        ? { ...defaults.args, ...built.args }
        : undefined;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });

    for (const b of allBundles) {
      for (const candidate of candidates) {
        const msg =
          b.getMessage(candidate) ?? b.getMessage(withKebabKey(candidate));
        // A message without attributes is not a match: keep looking (a fallback
        // bundle may define them) and report MISSING_MESSAGE if none does.
        if (!msg?.attributes || Object.keys(msg.attributes).length === 0) continue;

        const result: Record<string, string> = {};
        const errors: Error[] = [];
        for (const [attrKey, pattern] of Object.entries(msg.attributes)) {
          result[attrKey] = stripBidiIsolates(
            b.formatPattern(pattern, mergedArgs, errors) as string
          );
        }
        if (errors.length > 0) {
          report(
            built.rejected.length > 0
              ? {
                  code: FluentErrorCode.INVALID_ARGUMENT,
                  key,
                  namespace,
                  locale: bundleLocale(b),
                  cause: { unsupportedArguments: built.rejected, errors },
                }
              : {
                  code: FluentErrorCode.FORMATTING_ERROR,
                  key,
                  namespace,
                  locale: bundleLocale(b),
                  cause: errors,
                }
          );
          return {};
        }
        return result;
      }
    }

    report({ code: FluentErrorCode.MISSING_MESSAGE, key, namespace });
    return {};
  }) as Translations['attrs'];

  /**
   * Formats a message to plain text, dropping rich-text markers instead of
   * throwing (unlike `t()`) or returning React nodes (unlike `t.rich()`).
   *
   * Useful when one catalog entry carries markup for the visible UI but the
   * same text is also needed in `aria-label`, `title`, `alt` or `<meta>`.
   */
  tFn.plain = ((key: string, args?: FluentArgs): string => {
    const built = buildFluentArgs(args as Record<string, unknown>);
    return stripRichText(formatKey(key, built.args, built.rejected));
  }) as Translations['plain'];

  tFn.has = (key: string): boolean => {
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    for (const candidate of candidates) {
      for (const b of allBundles) {
        if (b.hasMessage(candidate)) return true;
        const lastDot = candidate.lastIndexOf('.');
        if (lastDot !== -1) {
          const msgId = candidate.slice(0, lastDot);
          const attrName = candidate.slice(lastDot + 1);
          const parentMsg =
            b.getMessage(msgId) ?? b.getMessage(withKebabKey(msgId));
          if (
            parentMsg?.attributes &&
            (parentMsg.attributes[attrName] || parentMsg.attributes[withKebabKey(attrName)])
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  return tFn as Translations;
}
