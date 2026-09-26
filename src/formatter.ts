import type { Formatter, FormatterOptions } from './types';
import { canonicalizeLocale } from './utils';
import { LRUCache } from './lru';

const MAX_CACHE_SIZE = 200;

function stringifySorted(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(stringifySorted).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stringifySorted((obj as Record<string, unknown>)[k])}`
    )
    .join(',')}}`;
}

const dtfCache = new LRUCache<Intl.DateTimeFormat>(MAX_CACHE_SIZE);
const nfCache = new LRUCache<Intl.NumberFormat>(MAX_CACHE_SIZE);
const rtfCache = new LRUCache<Intl.RelativeTimeFormat>(MAX_CACHE_SIZE);
const lfCache = new LRUCache<Intl.ListFormat>(MAX_CACHE_SIZE);

export function clearFormatterCache(): void {
  dtfCache.clear();
  nfCache.clear();
  rtfCache.clear();
  lfCache.clear();
}

/**
 * Resolves a named format (`'short'`) against the configured presets, or passes
 * `Intl` options through unchanged. Unknown names are reported once and fall
 * back to default formatting instead of throwing during render.
 */
function resolveFormat<T>(
  presets: Record<string, T> | undefined,
  options: T | string | undefined,
  kind: string
): T | undefined {
  if (options === undefined || typeof options !== 'string') return options;
  const preset = presets?.[options];
  if (!preset) {
    console.warn(
      `[next-fluent] Unknown ${kind} format "${options}". Configure it in the request config "formats" option.`
    );
    return undefined;
  }
  return preset;
}

export function createFormatter(optionsOrLocale: string | FormatterOptions): Formatter {
  const options: FormatterOptions =
    typeof optionsOrLocale === 'string' ? { locale: optionsOrLocale } : optionsOrLocale;

  const rawLocale = options.locale || 'en';
  const locale = canonicalizeLocale(rawLocale) || rawLocale;
  const timeZone = options.timeZone;
  const formats = options.formats;

  return {
    locale,
    timeZone,

    dateTime(
      value: Date | number | string,
      dtfOptionsOrName?: Intl.DateTimeFormatOptions | string
    ): string {
      const dtfOptions = resolveFormat(formats?.dateTime, dtfOptionsOrName, 'dateTime');
      const date =
        value instanceof Date
          ? value
          : new Date(typeof value === 'number' || typeof value === 'string' ? value : NaN);

      if (Number.isNaN(date.getTime())) {
        return String(value);
      }

      const mergedOptions: Intl.DateTimeFormatOptions = {
        ...(timeZone && !dtfOptions?.timeZone ? { timeZone } : {}),
        ...dtfOptions,
      };

      const cacheKey = `${locale}::${stringifySorted(mergedOptions)}`;
      let formatter = dtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.DateTimeFormat(locale, mergedOptions);
          dtfCache.set(cacheKey, formatter);
        } catch {
          return date.toISOString();
        }
      }

      try {
        return formatter.format(date);
      } catch {
        return date.toISOString();
      }
    },

    number(
      value: number | bigint,
      nfOptionsOrName?: Intl.NumberFormatOptions | string
    ): string {
      const nfOptions = resolveFormat(formats?.number, nfOptionsOrName, 'number');
      const cacheKey = `${locale}::${stringifySorted(nfOptions ?? {})}`;
      let formatter = nfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.NumberFormat(locale, nfOptions);
          nfCache.set(cacheKey, formatter);
        } catch {
          return String(value);
        }
      }

      try {
        return formatter.format(value);
      } catch {
        return String(value);
      }
    },

    relativeTime(
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      rtfOptionsOrName?: Intl.RelativeTimeFormatOptions | string
    ): string {
      const rtfOptions = resolveFormat(formats?.relativeTime, rtfOptionsOrName, 'relativeTime');
      const cacheKey = `${locale}::${stringifySorted(rtfOptions ?? {})}`;
      let formatter = rtfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.RelativeTimeFormat(locale, rtfOptions);
          rtfCache.set(cacheKey, formatter);
        } catch {
          return `${value} ${unit}`;
        }
      }

      try {
        return formatter.format(value, unit);
      } catch {
        return `${value} ${unit}`;
      }
    },

    list(value: Iterable<string>, lfOptionsOrName?: Intl.ListFormatOptions | string): string {
      if (!value || typeof (value as any)[Symbol.iterator] !== 'function') {
        return String(value ?? '');
      }

      const items = typeof value === 'string' ? [value] : value;
      const lfOptions = resolveFormat(formats?.list, lfOptionsOrName, 'list');
      const cacheKey = `${locale}::${stringifySorted(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(items).join(', ');
        }
      }

      try {
        return formatter.format(items);
      } catch {
        return Array.from(items).join(', ');
      }
    },
  };
}
