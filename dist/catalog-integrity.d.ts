/**
 * Reports catalog sources whose entries the runtime parser silently dropped.
 * Accepts the shapes `createFluentBundle` accepts; JSON catalogs are converted
 * by the caller first, because only FTL text can be reparsed here.
 */
export declare function warnAboutDroppedEntries(locale: string, source: string | readonly string[]): void;
