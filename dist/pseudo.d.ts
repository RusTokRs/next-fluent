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
type PreservedToken = {
    kind: 'text' | 'expr' | 'tag';
    value: string;
};
/**
 * Splits text into translatable runs and the tokens that must survive
 * untouched: Fluent placeables and HTML tags.
 *
 * A flat `\{[^}]*\}` pattern breaks on nested placeables — `{ $count ->
 * [one] { NUMBER($count) } }` — because it stops at the first `}` and the rest
 * of the selector gets pseudo-localized. Brace depth (and Fluent string
 * literals) are tracked instead.
 */
export declare function splitPreservedTokens(text: string): PreservedToken[];
/**
 * Transforms an entire FTL file content into pseudo-localized FTL.
 * Preserves message IDs, attributes, selectors, and comments. The pseudo
 * prefix/suffix wraps each message (and each select variant) as a whole.
 */
export declare function pseudoLocalizeFtl(ftlContent: string, options?: PseudoOptions): string;
export {};
