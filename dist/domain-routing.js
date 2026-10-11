import { matchSupportedLocale } from "./utils.js";
import { normalizeLocalePrefix } from "./locale-prefix.js";
function normalizeHost(host) {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}
function findDomain(domains, host) {
  if (!host) return void 0;
  const normalized = normalizeHost(host.toLowerCase());
  return domains?.find((entry) => normalizeHost(entry.domain.toLowerCase()) === normalized);
}
function domainSupportsLocale(domain, locale) {
  return Boolean(matchSupportedLocale(locale, domain.locales ?? [domain.defaultLocale]));
}
function findLocaleDomain(domains, locale, host) {
  const current = findDomain(domains, host);
  return current && domainSupportsLocale(current, locale) ? current : domains?.find((entry) => domainSupportsLocale(entry, locale));
}
function domainLocalePrefix(locales, globalPrefix, domain) {
  return normalizeLocalePrefix(locales, domain?.localePrefix ?? globalPrefix);
}
function replaceUrlHost(url, host) {
  const target = new URL(`${url.protocol}//${host}`);
  url.hostname = target.hostname;
  url.port = target.port;
}
export {
  domainLocalePrefix,
  domainSupportsLocale,
  findDomain,
  findLocaleDomain,
  replaceUrlHost
};
