import React from 'react';
import type { RichTranslationValues } from './types';
export declare const REACT_ELEMENT_TOKEN_PREFIX = "\uE000NF_EL_";
export declare const REACT_ELEMENT_TOKEN_SUFFIX = "_\uE001";
export declare function createReactElementToken(key: string): string;
/**
 * Parses a formatted string containing markup tags (e.g. `<link>text</link>`, `<br/>`, `<br>`)
 * and embedded React element tokens, mapping them to React elements or tag render functions in `values`.
 */
export declare function parseRichText(text: string, values?: RichTranslationValues): React.ReactNode;
