import type { FluentFunction, FluentValue } from '@fluent/bundle';
import { LRUCache } from './lru';

/**
 * Unwraps FluentType wrapper to extract raw underlying value.
 */
export function unwrapFluentValue(val: unknown): unknown {
  if (
    val &&
    typeof val === 'object' &&
    typeof (val as { valueOf?: () => unknown }).valueOf === 'function'
  ) {
    return (val as { valueOf: () => unknown }).valueOf();
  }
  return val;
}

const numberFormatCache = new LRUCache<Intl.NumberFormat>(200);

/**
 * Argument sets `Intl` refused, already reported.
 *
 * A Fluent function runs inside `formatPattern`, where the pattern's own error
 * channel only sees what Fluent itself rejects — a function that catches its
 * own `Intl` failure reports nothing at all. `CURRENCY($price, currencyDisplay:
 * "nope")` therefore rendered `12.5 USD` in complete silence: a number that
 * looks deliberate, produced by a configuration that was never applied. The
 * formatter reports the same class of failure for `number` and `dateTime`, and
 * this is the FTL-side half of that contract.
 */
const refusedNumberFormats = new Set<string>();
const MAX_REFUSED_REPORTS = 200;

function warnRefusedFormat(
  name: string,
  locale: string,
  named: Record<string, FluentValue>,
  fallback: string
): void {
  const key = `${name}::${locale}::${Object.entries(named)
    .map(([k, v]) => `${k}=${String(unwrapFluentValue(v))}`)
    .sort()
    .join(',')}`;
  if (refusedNumberFormats.has(key)) return;
  if (refusedNumberFormats.size >= MAX_REFUSED_REPORTS) refusedNumberFormats.clear();
  refusedNumberFormats.add(key);
  console.warn(
    `[next-fluent] Intl refused the options of ${name}() for "${locale}" ` +
      `(${key.split('::').slice(2).join('::')}); the value was rendered as ${JSON.stringify(fallback)}.`
  );
}

export function clearFunctionsCache(): void {
  numberFormatCache.clear();
  refusedNumberFormats.clear();
}

function getCachedNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${locale}::${options.style}::${options.currency ?? ''}::${options.currencyDisplay ?? ''}::${options.minimumFractionDigits ?? ''}::${options.maximumFractionDigits ?? ''}`;
  let nf = numberFormatCache.get(cacheKey);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(cacheKey, nf);
  }
  return nf;
}

/**
 * Creates standard built-in Intl formatter functions for FluentBundle.
 */
export function createDefaultFunctions(locale: string): Record<string, FluentFunction> {
  return {
    CURRENCY: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? '');
      }

      const currency = String(unwrapFluentValue(named.currency) || 'USD');
      const currencyDisplay = named.currencyDisplay
        ? (String(unwrapFluentValue(named.currencyDisplay)) as Intl.NumberFormatOptions['currencyDisplay'])
        : undefined;

      const minFraction =
        named.minimumFractionDigits !== undefined
          ? Number(unwrapFluentValue(named.minimumFractionDigits))
          : undefined;
      const maxFraction =
        named.maximumFractionDigits !== undefined
          ? Number(unwrapFluentValue(named.maximumFractionDigits))
          : undefined;

      try {
        return getCachedNumberFormat(locale, {
          style: 'currency',
          currency,
          currencyDisplay,
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction,
        }).format(num);
      } catch {
        const fallback = `${num} ${currency}`;
        warnRefusedFormat('CURRENCY', locale, named, fallback);
        return fallback;
      }
    },

    PERCENT: (positional, named) => {
      const rawVal = unwrapFluentValue(positional[0]);
      const num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
      if (Number.isNaN(num)) {
        return String(rawVal ?? '');
      }

      const minFraction =
        named.minimumFractionDigits !== undefined
          ? Number(unwrapFluentValue(named.minimumFractionDigits))
          : undefined;
      const maxFraction =
        named.maximumFractionDigits !== undefined
          ? Number(unwrapFluentValue(named.maximumFractionDigits))
          : undefined;

      try {
        return getCachedNumberFormat(locale, {
          style: 'percent',
          minimumFractionDigits: minFraction,
          maximumFractionDigits: maxFraction,
        }).format(num);
      } catch {
        const fallback = `${num * 100}%`;
        warnRefusedFormat('PERCENT', locale, named, fallback);
        return fallback;
      }
    },
  };
}
