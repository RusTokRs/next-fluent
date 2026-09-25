export interface PseudoOptions {
    /** Prefix added to each localized message. Default: `[` */
    prefix?: string;
    /** Suffix added to each localized message. Default: `]` */
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
 * Preserves message IDs, attributes, selectors, and comments. The pseudo
 * prefix/suffix wraps each message (and each select variant) as a whole.
 */
export declare function pseudoLocalizeFtl(ftlContent: string, options?: PseudoOptions): string;
