import { domainLocalePrefix, findLocaleDomain } from "./domain-routing.js";
import { findInternalPath, externalTemplate, renderTemplate } from "./route-engine.js";
import {
  localeNeedsPrefix,
  normalizeLocalePrefix,
  prefixForLocale
} from "./locale-prefix.js";
function withLocalePrefix(path, locale, defaultLocale, localePrefix) {
  if (!localeNeedsPrefix(locale, defaultLocale, localePrefix.mode)) return path;
  const prefix = prefixForLocale(locale, localePrefix);
  return path === "/" ? prefix : `${prefix}${path}`;
}
function buildAlternateLinksHeader(options) {
  const {
    locales,
    defaultLocale,
    localePrefix,
    pathname,
    pathnames,
    domains,
    basePath = "",
    search = "",
    origin
  } = options;
  const prefixConfig = normalizeLocalePrefix(locales, localePrefix);
  if (locales.length < 2) return void 0;
  let match = null;
  if (pathnames) {
    for (const locale of locales) {
      const candidate = findInternalPath(pathname, locale, pathnames);
      if (candidate) {
        match = candidate;
        break;
      }
    }
  }
  const template = options.internalTemplate ?? match?.template;
  const params = match?.params ?? {};
  const base = new URL(origin);
  const basePathname = (path) => `${basePath}${path === "/" && basePath ? "" : path}`;
  const variants = [];
  for (const locale of locales) {
    const external = template ? externalTemplate(template, locale, pathnames) : pathname;
    const rendered = template ? renderTemplate(external, params) : pathname;
    const domain = findLocaleDomain(domains, locale, base.host);
    const targetPrefix = domain ? domainLocalePrefix(locales, localePrefix, domain) : prefixConfig;
    const path = withLocalePrefix(rendered, locale, domain?.defaultLocale ?? defaultLocale, targetPrefix);
    const url = domain ? new URL(`https://${domain.domain}`) : new URL(base);
    url.pathname = basePathname(path);
    url.search = search;
    variants.push({ href: url.toString(), locale });
  }
  const counts = /* @__PURE__ */ new Map();
  for (const { href } of variants) counts.set(href, (counts.get(href) ?? 0) + 1);
  const unique = variants.filter(({ href }) => counts.get(href) === 1);
  if (unique.length < 2) return void 0;
  const links = unique.map(({ href, locale }) => `<${href}>; rel="alternate"; hreflang="${locale}"`);
  if (!domains || domains.length === 0) {
    const defaultPath = withLocalePrefix(
      template ? renderTemplate(externalTemplate(template, defaultLocale, pathnames), params) : pathname,
      defaultLocale,
      defaultLocale,
      prefixConfig
    );
    const url = new URL(base);
    url.pathname = basePathname(defaultPath);
    url.search = search;
    if (unique.some(({ href }) => href === url.toString())) {
      links.push(`<${url.toString()}>; rel="alternate"; hreflang="x-default"`);
    }
  }
  return links.length > 0 ? links.join(", ") : void 0;
}
export {
  buildAlternateLinksHeader
};
