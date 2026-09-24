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

export function createFormatter(optionsOrLocale: string | FormatterOptions): Formatter {
  const options: FormatterOptions =
    typeof optionsOrLocale === 'string' ? { locale: optionsOrLocale } : optionsOrLocale;

  const rawLocale = options.locale || 'en';
  const locale = canonicalizeLocale(rawLocale) || rawLocale;
  const timeZone = options.timeZone;

  return {
    locale,
    timeZone,

    dateTime(value: Date | number | string, dtfOptions?: Intl.DateTimeFormatOptions): string {
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

    number(value: number | bigint, nfOptions?: Intl.NumberFormatOptions): string {
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
      rtfOptions?: Intl.RelativeTimeFormatOptions
    ): string {
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

    list(value: Iterable<string>, lfOptions?: Intl.ListFormatOptions): string {
      if (!value || typeof (value as any)[Symbol.iterator] !== 'function') {
        return String(value ?? '');
      }

      const cacheKey = `${locale}::${stringifySorted(lfOptions ?? {})}`;
      let formatter = lfCache.get(cacheKey);
      if (!formatter) {
        try {
          formatter = new Intl.ListFormat(locale, lfOptions);
          lfCache.set(cacheKey, formatter);
        } catch {
          return Array.from(value).join(', ');
        }
      }

      try {
        return formatter.format(value);
      } catch {
        return Array.from(value).join(', ');
      }
    },
  };
}
