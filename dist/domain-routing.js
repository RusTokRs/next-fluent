import { matchSupportedLocale } from "./utils.js";
import { normalizeLocalePrefix } from "./locale-prefix.js";
function findDomain(domains, host) {
  return host ? domains?.find((entry) => entry.domain.toLowerCase() === host.toLowerCase()) : void 0;
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
