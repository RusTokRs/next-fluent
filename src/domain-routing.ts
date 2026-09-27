import type { DomainConfig, LocalePrefixConfig } from './types';
import { matchSupportedLocale } from './utils';
import { normalizeLocalePrefix } from './locale-prefix';

export function findDomain(
  domains: readonly DomainConfig[] | undefined,
  host: string | undefined
): DomainConfig | undefined {
  return host ? domains?.find((entry) => entry.domain.toLowerCase() === host.toLowerCase()) : undefined;
}

export function domainSupportsLocale(domain: DomainConfig, locale: string): boolean {
  return Boolean(matchSupportedLocale(locale, domain.locales ?? [domain.defaultLocale]));
}

/** Stay on the current domain when it supports the locale; otherwise use the first match. */
export function findLocaleDomain(
  domains: readonly DomainConfig[] | undefined,
  locale: string,
  host?: string
): DomainConfig | undefined {
  const current = findDomain(domains, host);
  return current && domainSupportsLocale(current, locale)
    ? current
    : domains?.find((entry) => domainSupportsLocale(entry, locale));
}

export function domainLocalePrefix(
  locales: readonly string[],
  globalPrefix: LocalePrefixConfig | undefined,
  domain?: DomainConfig
) {
  return normalizeLocalePrefix(locales, domain?.localePrefix ?? globalPrefix);
}

/** WHATWG URL.host does not clear an existing port when the new host omits it. */
export function replaceUrlHost(url: URL, host: string): void {
  const target = new URL(`${url.protocol}//${host}`);
  url.hostname = target.hostname;
  url.port = target.port;
}
