import type { FluentFunction } from '@fluent/bundle';
/**
 * Unwraps FluentType wrapper to extract raw underlying value.
 */
export declare function unwrapFluentValue(val: unknown): unknown;
/**
 * Creates standard built-in Intl formatter functions for FluentBundle.
 */
export declare function createDefaultFunctions(locale: string): Record<string, FluentFunction>;
