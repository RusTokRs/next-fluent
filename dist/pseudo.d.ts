/**
 * Pseudo-localization engine for layout overflow and truncation testing.
 */
export interface PseudoOptions {
    /** Prefix added to localized string. Default: `[` */
    prefix?: string;
    /** Suffix added to localized string. Default: `]` */
    suffix?: string;
    /** Elongate strings by duplicating vowels to simulate text expansion. Default: true */
    elongate?: boolean;
}
/**
 * Transforms a text chunk into pseudo-localized text while preserving
 * variables ({ $var }), Fluent functions ({ NUMBER(...) }), and HTML tags (<tag>).
 */
export declare function pseudoLocalizeText(text: string, options?: PseudoOptions): string;
/**
 * Transforms an entire FTL file content into pseudo-localized FTL.
 * Preserves message IDs, attributes, selectors, and comments.
 */
export declare function pseudoLocalizeFtl(ftlContent: string, options?: PseudoOptions): string;
