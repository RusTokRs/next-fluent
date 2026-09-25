export declare function canonicalizeLocale(locale?: string | null): string | undefined;
export declare function normalizeLocaleTag(value?: string | null): string | undefined;
export declare function localeLookupCandidates(canonical: string): string[];
export declare function matchSupportedLocale(value: string | null | undefined, locales: readonly string[]): string | undefined;
export declare function resolveAcceptLanguage(header: string | null | undefined, locales: readonly string[], preferred?: string): string | undefined;
export interface BaseI18nConfig {
    locales: readonly string[];
    defaultLocale: string;
    localePrefix?: string;
    cookieName?: string;
    headerName?: string;
    loadMessages?: unknown;
}
export declare function validateI18nConfig(options: BaseI18nConfig): void;
export declare function withKebabKey(key: string): string;
export interface BuildKeyCandidatesOptions {
    strictNamespace?: boolean;
}
export declare function buildKeyCandidates(namespace: string | undefined, key: string, options?: BuildKeyCandidatesOptions): string[];
