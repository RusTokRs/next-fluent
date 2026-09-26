import type { Pathnames } from './types';
import { matchSupportedLocale } from './utils';
import { findInternalPath, externalTemplate, renderTemplate } from './route-engine';

export interface AlternateLinksOptions {
  locales: readonly string[];
  defaultLocale: string;
  localePrefix: 'always' | 'as-needed' | 'never';
  /** Pathname without locale prefix and without basePath (internal form). */
  pathname: string;
  /** Internal route template matched for the current request, when known. */
  internalTemplate?: string;
  pathnames?: Pathnames<any>;
  domains?: readonly { domain: string; defaultLocale: string; locales?: readonly string[] }[];
  basePath?: string;
  search?: string;
  origin: string;
}

function withLocalePrefix(
  path: string,
  locale: string,
  defaultLocale: string,
  localePrefix: 'always' | 'as-needed' | 'never'
): string {
  if (localePrefix === 'never') return path;
  if (localePrefix === 'as-needed' && locale === defaultLocale) return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
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

  if (localePrefix === 'never' || locales.length < 2) return undefined;

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

  const links: string[] = [];
  const push = (href: string, hreflang: string) => {
    links.push(`<${href}>; rel="alternate"; hreflang="${hreflang}"`);
  };

  for (const locale of locales) {
    const external = template ? externalTemplate(template, locale, pathnames) : pathname;
    // Render with the parameters captured from the current request so dynamic
    // routes keep their concrete values.
    const rendered = template ? renderTemplate(external, params) : pathname;
    const path = withLocalePrefix(rendered, locale, defaultLocale, localePrefix);

    const domain = domains?.find((entry) =>
      (entry.locales ?? [entry.defaultLocale]).some((item) =>
        matchSupportedLocale(locale, [item])
      )
    );

    if (domain) {
      const needsPrefix = !(
        domain.defaultLocale === locale && localePrefix !== 'always'
      );
      const domainPath = needsPrefix ? withLocalePrefix(rendered, locale, domain.defaultLocale, 'always') : rendered;
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
    push(url.toString(), 'x-default');
  }

  return links.length > 0 ? links.join(', ') : undefined;
}
