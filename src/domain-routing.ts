import type { DomainConfig, LocalePrefixConfig } from './types';
import { matchSupportedLocale } from './utils';
import { normalizeLocalePrefix } from './locale-prefix';

/**
 * `example.com.` is the absolute (FQDN) spelling of `example.com`: every
 * resolver treats them as the same host, and clients and proxies do send the
 * dotted form. Matching has to ignore the trailing dot or a configured domain
 * silently stops applying to those requests.
 */
function normalizeHost(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

export function findDomain(
  domains: readonly DomainConfig[] | undefined,
  host: string | undefined
): DomainConfig | undefined {
  if (!host) return undefined;
  const normalized = normalizeHost(host.toLowerCase());
  return domains?.find((entry) => normalizeHost(entry.domain.toLowerCase()) === normalized);
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
