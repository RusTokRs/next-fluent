import { matchSupportedLocale } from "./utils.js";
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
  if (prefixConfig.mode === "never" || locales.length < 2) return void 0;
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
  const links = [];
  const push = (href, hreflang) => {
    links.push(`<${href}>; rel="alternate"; hreflang="${hreflang}"`);
  };
  for (const locale of locales) {
    const external = template ? externalTemplate(template, locale, pathnames) : pathname;
    const rendered = template ? renderTemplate(external, params) : pathname;
    const path = withLocalePrefix(rendered, locale, defaultLocale, prefixConfig);
    const domain = domains?.find(
      (entry) => (entry.locales ?? [entry.defaultLocale]).some(
        (item) => matchSupportedLocale(locale, [item])
      )
    );
    if (domain) {
      const needsPrefix = !(domain.defaultLocale === locale && prefixConfig.mode !== "always");
      const domainPath = needsPrefix ? `${prefixForLocale(locale, prefixConfig)}${rendered === "/" ? "" : rendered}` : rendered;
      push(`https://${domain.domain}${basePathname(domainPath)}${search}`, locale);
      continue;
    }
    const url = new URL(base);
    url.pathname = basePathname(path);
    url.search = search;
    push(url.toString(), locale);
  }
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
    push(url.toString(), "x-default");
  }
  return links.length > 0 ? links.join(", ") : void 0;
}
export {
  buildAlternateLinksHeader
};
