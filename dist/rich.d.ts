import React from 'react';
import type { RichTranslationValues } from './types';
/**
 * Parses a formatted string containing markup tags like `<link>text</link>` or `<br/>`
 * and maps them to React elements or tag render functions provided in `values`.
 */
export declare function parseRichText(text: string, values?: RichTranslationValues): React.ReactNode;
