import type { DomainConfig, LocalePrefixConfig } from './types';
export declare function findDomain(domains: readonly DomainConfig[] | undefined, host: string | undefined): DomainConfig | undefined;
export declare function domainSupportsLocale(domain: DomainConfig, locale: string): boolean;
/** Stay on the current domain when it supports the locale; otherwise use the first match. */
export declare function findLocaleDomain(domains: readonly DomainConfig[] | undefined, locale: string, host?: string): DomainConfig | undefined;
export declare function domainLocalePrefix(locales: readonly string[], globalPrefix: LocalePrefixConfig | undefined, domain?: DomainConfig): import("./locale-prefix").NormalizedLocalePrefix;
/** WHATWG URL.host does not clear an existing port when the new host omits it. */
export declare function replaceUrlHost(url: URL, host: string): void;
