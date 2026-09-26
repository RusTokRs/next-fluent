import { matchSupportedLocale } from "./utils.js";
import { findInternalPath, externalTemplate, renderTemplate } from "./route-engine.js";
function withLocalePrefix(path, locale, defaultLocale, localePrefix) {
  if (localePrefix === "never") return path;
  if (localePrefix === "as-needed" && locale === defaultLocale) return path;
  return path === "/" ? `/${locale}` : `/${locale}${path}`;
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
  if (localePrefix === "never" || locales.length < 2) return void 0;
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
    const path = withLocalePrefix(rendered, locale, defaultLocale, localePrefix);
    const domain = domains?.find(
      (entry) => (entry.locales ?? [entry.defaultLocale]).some(
        (item) => matchSupportedLocale(locale, [item])
      )
    );
    if (domain) {
      const needsPrefix = !(domain.defaultLocale === locale && localePrefix !== "always");
      const domainPath = needsPrefix ? withLocalePrefix(rendered, locale, domain.defaultLocale, "always") : rendered;
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
      localePrefix
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
