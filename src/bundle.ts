import type { FluentBundle } from '@fluent/bundle';
import React from 'react';
import type { FluentArgs, FluentVariable, RichTranslationValues, Translations } from './types';
import { buildKeyCandidates, canonicalizeLocale, withKebabKey } from './utils';
import {
  parseRichText,
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

export function clearBundleCache(): void {
  clearInternalBundleCache();
  clearFunctionsCache();
}

export {
  getCachedFluentBundle,
  clearFunctionsCache,
  getBundleCacheStats,
  LRUCache,
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
  ftlSource: string | readonly string[],
  options: CreateFluentBundleOptions = {}
): FluentBundle {
  const canonicalLocale = canonicalizeLocale(locale);
  if (!canonicalLocale) {
    throw new Error(
      `[next-fluent] Invalid Fluent bundle locale: "${fluentBundleLocaleDiagnostic(locale)}"`
    );
  }

  return getCachedFluentBundle(canonicalLocale, ftlSource, options);
}

export interface CreateTranslatorOptions {
  fallbackBundle?: FluentBundle | null;
  fallbackBundles?: FluentBundle | readonly FluentBundle[] | null;
  namespace?: string;
  debug?: boolean;
  defaultTranslationValues?: RichTranslationValues;
  strictNamespace?: boolean;
}

const FORMAT_ERROR = Symbol('format-error');
type FormatCandidateResult = string | null | typeof FORMAT_ERROR;
type RawCandidateResult = string[] | string | null;

function stripBidiIsolates(value: string): string {
  return value.replace(/[\u2068\u2069]/g, '');
}

/**
 * Converts user-facing translation values into Fluent arguments. React
 * elements become placeholder tokens that `parseRichText` resolves later.
 */
function buildFluentArgs(values: Record<string, unknown> | undefined): FluentArgs {
  const fluentArgs: FluentArgs = {};
  if (!values) return fluentArgs;
  for (const [k, v] of Object.entries(values)) {
    if (React.isValidElement(v)) {
      fluentArgs[k] = createReactElementToken(k);
    } else if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      v instanceof Date ||
      (typeof v === 'object' && v !== null && 'type' in v)
    ) {
      fluentArgs[k] = v as FluentVariable;
    }
  }
  return fluentArgs;
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
    }
  } else {
    namespace = maybeNamespace;
  }

  const defaultFluentArgs = buildFluentArgs(defaultTranslationValues);

  const formatCandidate = (
    targetBundle: FluentBundle,
    candidate: string,
    args?: FluentArgs
  ): FormatCandidateResult => {
    const msg = targetBundle.getMessage(candidate);
    if (msg?.value) {
      const errors: Error[] = [];
      const formatted = targetBundle.formatPattern(msg.value, args, errors);
      if (errors.length > 0) {
        console.warn(`[next-fluent] Format errors for key "${candidate}":`, errors);
        // Never expose Fluent's partially formatted output. A message that exists
        // but cannot be formatted is a terminal resolution failure rather than
        // silently falling through to another locale.
        return FORMAT_ERROR;
      }
      return formatted;
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
          if (errors.length > 0) {
            console.warn(
              `[next-fluent] Format errors for attribute "${candidate}":`,
              errors
            );
            return FORMAT_ERROR;
          }
          return formatted;
        }
      }
    }

    return null;
  };

  /**
   * Formats a key to a plain string. Returns the fallback key when the message
   * is missing or fails to format. React element tokens may survive in the
   * output — `t()` rejects them while `t.rich()` resolves them.
   */
  const formatKey = (key: string, args?: FluentArgs): string => {
    const mergedArgs =
      Object.keys(defaultFluentArgs).length > 0
        ? { ...defaultFluentArgs, ...args }
        : args;
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    const fallbackKey = namespace ? `${namespace}.${key}` : key;
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const formatted = formatCandidate(b, candidate, mergedArgs);
        if (formatted === FORMAT_ERROR) return fallbackKey;
        if (formatted !== null) return formatted;
      }
    }

    if (debug) {
      console.warn(`[next-fluent] Missing translation for key "${fallbackKey}"`);
      return `[MISSING: ${fallbackKey}]`;
    }

    return fallbackKey;
  };

  const tFn = ((key: string, args?: FluentArgs): string => {
    // Plain `t()` interpolations may contain React elements only by mistake —
    // resolve them to tokens first so a clear error can be raised, instead of
    // leaking placeholder tokens into strings or failing deep inside Fluent.
    const formatted = formatKey(key, buildFluentArgs(args as Record<string, unknown>));
    if (formatted.includes(REACT_ELEMENT_TOKEN_PREFIX)) {
      const fallbackKey = namespace ? `${namespace}.${key}` : key;
      throw new Error(
        `[next-fluent] Message "${fallbackKey}" interpolates a React element. ` +
          'Use t.rich() or <FormattedMessage> for rich content.'
      );
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
      const sortedAttrKeys = Object.keys(msg.attributes).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      return sortedAttrKeys.map((attrKey) =>
        formatRawPattern(targetBundle, msg.attributes![attrKey], args)
      );
    }

    return null;
  };

  tFn.raw = ((key: string, args?: FluentArgs): string[] | string => {
    const mergedArgs = buildFluentArgs(args as Record<string, unknown>);
    const candidates = buildKeyCandidates(namespace, key, { strictNamespace });
    const fallbackKey = namespace ? `${namespace}.${key}` : key;
    for (const b of allBundles) {
      for (const candidate of candidates) {
        const res = getRawValue(b, candidate, mergedArgs);
        if (res !== null && res !== undefined) return res;
      }
    }

    if (debug) {
      console.warn(`[next-fluent] Missing raw translation for key "${fallbackKey}"`);
      return `[MISSING: ${fallbackKey}]`;
    }

    return fallbackKey;
  }) as Translations['raw'];

  tFn.rich = (key: string, values?: RichTranslationValues): React.ReactNode => {
    const mergedValues =
      defaultTranslationValues || values
        ? { ...(defaultTranslationValues ?? {}), ...(values ?? {}) }
        : undefined;

    const formattedText = formatKey(key, buildFluentArgs(mergedValues));
    return parseRichText(formattedText, mergedValues);
  };

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
