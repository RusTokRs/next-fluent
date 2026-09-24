import type { FluentFunction } from '@fluent/bundle';
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

export function clearFunctionsCache(): void {
  numberFormatCache.clear();
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
        return `${num} ${currency}`;
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
        return `${num * 100}%`;
      }
    },
  };
}
