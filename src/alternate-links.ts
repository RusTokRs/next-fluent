import type { DomainConfig, LocalePrefixConfig, Pathnames } from './types';
import { domainLocalePrefix, findLocaleDomain } from './domain-routing';
import { findInternalPath, externalTemplate, renderTemplate } from './route-engine';
import {
  localeNeedsPrefix,
  normalizeLocalePrefix,
  prefixForLocale,
  type NormalizedLocalePrefix,
} from './locale-prefix';

export interface AlternateLinksOptions {
  locales: readonly string[];
  defaultLocale: string;
  localePrefix?: LocalePrefixConfig;
  /** Pathname without locale prefix and without basePath (internal form). */
  pathname: string;
  /** Internal route template matched for the current request, when known. */
  internalTemplate?: string;
  pathnames?: Pathnames<any>;
  domains?: readonly DomainConfig[];
  basePath?: string;
  search?: string;
  origin: string;
}

function withLocalePrefix(
  path: string,
  locale: string,
  defaultLocale: string,
  localePrefix: NormalizedLocalePrefix
): string {
  if (!localeNeedsPrefix(locale, defaultLocale, localePrefix.mode)) return path;
  const prefix = prefixForLocale(locale, localePrefix);
  return path === '/' ? prefix : `${prefix}${path}`;
}

/**
 * Builds the `Link` response header advertising localized variants of the
 * current route (`rel="alternate"; hreflang="…"`), including `x-default`.
 * Search engines use it to serve the right language in results.
 */
export function buildAlternateLinksHeader(options: AlternateLinksOptions): string | undefined {
  const {
    locales,
    defaultLocale,
    localePrefix,
    pathname,
    pathnames,
    domains,
    basePath = '',
    search = '',
    origin,
  } = options;

  const prefixConfig = normalizeLocalePrefix(locales, localePrefix);

  if (locales.length < 2) return undefined;

  // Resolve the internal template and its concrete parameters once, probing
  // every locale so a slug from another language still resolves.
  let match: { template: string; params: Record<string, string | string[]> } | null = null;
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
  const basePathname = (path: string) => `${basePath}${path === '/' && basePath ? '' : path}`;

  const variants: { href: string; locale: string }[] = [];

  for (const locale of locales) {
    const external = template ? externalTemplate(template, locale, pathnames) : pathname;
    // Render with the parameters captured from the current request so dynamic
    // routes keep their concrete values.
    const rendered = template ? renderTemplate(external, params) : pathname;
    const domain = findLocaleDomain(domains, locale, base.host);
    const targetPrefix = domain ? domainLocalePrefix(locales, localePrefix, domain) : prefixConfig;
    const path = withLocalePrefix(rendered, locale, domain?.defaultLocale ?? defaultLocale, targetPrefix);
    const url = domain ? new URL(`https://${domain.domain}`) : new URL(base);
    url.pathname = basePathname(path);
    url.search = search;
    variants.push({ href: url.toString(), locale });
  }

  // `never` is useful with domain routing and localized slugs too. Only omit
  // ambiguous URLs (e.g. /about serving both en and ru based on a cookie), not
  // every configuration whose global prefix mode happens to be `never`.
  const counts = new Map<string, number>();
  for (const { href } of variants) counts.set(href, (counts.get(href) ?? 0) + 1);
  const unique = variants.filter(({ href }) => counts.get(href) === 1);
  if (unique.length < 2) return undefined;
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

  return links.length > 0 ? links.join(', ') : undefined;
}
