'use client';

import React, { forwardRef, useMemo } from 'react';
import NextLink from 'next/link.js';
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  redirect as nextRedirect,
  permanentRedirect as nextPermanentRedirect,
} from 'next/navigation.js';
import type {
  GetPathnameOptions,
  Href,
  Navigation,
  NavigationConfig,
  UrlObject,
} from './types';
import { matchSupportedLocale, validateI18nConfig } from './utils';
import { useLocale } from './client';

function isExternalUrl(url: string): boolean {
  return /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/|\\\\)/.test(url);
}

export function formatUrlObject(urlObj: UrlObject): {
  pathname: string;
  search: string;
  hash: string;
} {
  let pathname = urlObj.pathname ?? '/';
  let embeddedSearch = '';
  let embeddedHash = '';

  const hashIdx = pathname.indexOf('#');
  if (hashIdx !== -1) {
    embeddedHash = pathname.slice(hashIdx);
    pathname = pathname.slice(0, hashIdx);
  }

  const searchIdx = pathname.indexOf('?');
  if (searchIdx !== -1) {
    embeddedSearch = pathname.slice(searchIdx);
    pathname = pathname.slice(0, searchIdx);
  }

  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  const params = new URLSearchParams();
  if (embeddedSearch) {
    const rawEmbedded = embeddedSearch.startsWith('?') ? embeddedSearch.slice(1) : embeddedSearch;
    new URLSearchParams(rawEmbedded).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.search) {
    const rawSearch = urlObj.search.startsWith('?') ? urlObj.search.slice(1) : urlObj.search;
    new URLSearchParams(rawSearch).forEach((val, key) => params.append(key, val));
  }
  if (urlObj.query) {
    if (typeof urlObj.query === 'string') {
      const rawQuery = urlObj.query.startsWith('?') ? urlObj.query.slice(1) : urlObj.query;
      new URLSearchParams(rawQuery).forEach((val, key) => params.append(key, val));
    } else {
      for (const [k, v] of Object.entries(urlObj.query)) {
        if (v !== undefined && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item !== undefined && item !== null) {
                params.append(k, String(item));
              }
            }
          } else {
            params.set(k, String(v));
          }
        }
      }
    }
  }

  const qs = params.toString();
  const search = qs ? `?${qs}` : '';

  let hash = urlObj.hash ?? embeddedHash ?? '';
  if (hash && !hash.startsWith('#')) {
    hash = `#${hash}`;
  }

  return { pathname, search, hash };
}

export function resolveLocalizedPathname(
  options: GetPathnameOptions,
  config: NavigationConfig
): string {
  const { href, locale: explicitLocale } = options;
  const { locales, defaultLocale, localePrefix = 'always', pathnames } = config;

  let rawPathname = '';
  let search = '';
  let hash = '';

  if (typeof href === 'string') {
    if (isExternalUrl(href)) {
      return href;
    }
    const hashIndex = href.indexOf('#');
    const pathAndSearch = hashIndex !== -1 ? href.slice(0, hashIndex) : href;
    hash = hashIndex !== -1 ? href.slice(hashIndex) : '';

    const searchIndex = pathAndSearch.indexOf('?');
    rawPathname = searchIndex !== -1 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch;
    search = searchIndex !== -1 ? pathAndSearch.slice(searchIndex) : '';
  } else if (href && typeof href === 'object') {
    if (href.href && isExternalUrl(href.href)) {
      return href.href;
    }
    const parts = formatUrlObject(href);
    rawPathname = parts.pathname;
    search = parts.search;
    hash = parts.hash;
  } else {
    return '/';
  }

  // Normalize Windows backslashes in route pathname
  rawPathname = rawPathname.replace(/\\+/g, '/');

  // Ensure leading slash
  if (!rawPathname.startsWith('/')) {
    rawPathname = `/${rawPathname}`;
  }

  // Strip existing supported locale prefix if present
  const segments = rawPathname.split('/').filter(Boolean);
  let cleanPathname = rawPathname;
  if (segments.length > 0) {
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join('/');
      cleanPathname = rest ? `/${rest}` : '/';
    }
  }

  const hasTrailingSlash =
    rawPathname.length > 1 && rawPathname.endsWith('/') && cleanPathname !== '/';
  const lookupKey =
    cleanPathname.length > 1 && cleanPathname.endsWith('/')
      ? cleanPathname.slice(0, -1)
      : cleanPathname;

  const resolvedLocale = explicitLocale
    ? (matchSupportedLocale(explicitLocale, locales) ?? defaultLocale)
    : defaultLocale;

  // Localized pathname mapping (e.g. /about -> /about-us for 'en', /o-nas for 'ru', /ueber-uns for 'de', /a-propos for 'fr')
  let mappedPathname = cleanPathname;
  const pathnamesTarget = pathnames?.[lookupKey] ?? pathnames?.[cleanPathname];
  if (pathnamesTarget) {
    if (typeof pathnamesTarget === 'string') {
      mappedPathname = pathnamesTarget;
    } else if (typeof pathnamesTarget === 'object') {
      mappedPathname =
        (pathnamesTarget as Record<string, string>)[resolvedLocale] ??
        lookupKey;
    }
  }

  if (hasTrailingSlash && mappedPathname !== '/' && !mappedPathname.endsWith('/')) {
    mappedPathname = `${mappedPathname}/`;
  }

  let prefix = '';
  if (localePrefix === 'never') {
    prefix = '';
  } else if (localePrefix === 'as-needed') {
    if (resolvedLocale !== defaultLocale) {
      prefix = `/${resolvedLocale}`;
    }
  } else {
    // 'always'
    prefix = `/${resolvedLocale}`;
  }

  const finalPath = prefix
    ? mappedPathname === '/'
      ? prefix
      : `${prefix}${mappedPathname.startsWith('/') ? mappedPathname : `/${mappedPathname}`}`
    : mappedPathname;

  return `${finalPath}${search}${hash}`;
}

export function createNavigation<Locales extends readonly string[] = readonly string[]>(
  config: NavigationConfig<Locales>
): Navigation<Locales> {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
  });

  const { locales, defaultLocale, pathnames } = config;

  const getPathname = (options: GetPathnameOptions): string => {
    return resolveLocalizedPathname(options, config);
  };

  const Link = forwardRef<HTMLAnchorElement, any>((props, ref) => {
    const { href, locale: propLocale, ...rest } = props;

    let currentLocale: string | undefined;
    try {
      currentLocale = useLocale();
    } catch {
      // Fallback if rendered outside FluentProvider
    }

    const targetLocale = propLocale ?? currentLocale ?? defaultLocale;
    const localizedHref = getPathname({ href, locale: targetLocale });

    return React.createElement(NextLink, {
      ...rest,
      href: localizedHref,
      ref,
    });
  });
  Link.displayName = 'I18nLink';

  function usePathname(): string {
    let rawPathname = '';
    try {
      rawPathname = useNextPathname() || '';
    } catch {
      return '';
    }

    if (!rawPathname) return rawPathname;

    const segments = rawPathname.split('/').filter(Boolean);
    if (segments.length === 0) return '/';

    let cleanPathname = rawPathname;
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join('/');
      cleanPathname = rest ? `/${rest}` : '/';
    }

    const lookupKey =
      cleanPathname.length > 1 && cleanPathname.endsWith('/')
        ? cleanPathname.slice(0, -1)
        : cleanPathname;

    // Reverse map localized slug back to canonical route pathname
    if (pathnames) {
      for (const [canonical, mapping] of Object.entries(pathnames)) {
        if (typeof mapping === 'string') {
          if (mapping === cleanPathname || mapping === lookupKey) return canonical;
        } else if (mapping && typeof mapping === 'object') {
          for (const localized of Object.values(mapping as Record<string, string>)) {
            if (localized === cleanPathname || localized === lookupKey) return canonical;
          }
        }
      }
    }

    return cleanPathname;
  }

  function useRouter() {
    let router: any;
    try {
      router = useNextRouter();
    } catch {
      router = {
        push: () => {},
        replace: () => {},
        prefetch: () => {},
        back: () => {},
        forward: () => {},
        refresh: () => {},
      };
    }

    let currentLocale: string | undefined;
    try {
      currentLocale = useLocale();
    } catch {
      // Fallback
    }

    return useMemo(
      () => ({
        ...router,
        push(href: Href, options?: { locale?: string; scroll?: boolean }) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = getPathname({ href, locale: targetLocale });
          const routerOptions = options?.scroll !== undefined ? { scroll: options.scroll } : undefined;
          return router.push(target, routerOptions);
        },
        replace(href: Href, options?: { locale?: string; scroll?: boolean }) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = getPathname({ href, locale: targetLocale });
          const routerOptions = options?.scroll !== undefined ? { scroll: options.scroll } : undefined;
          return router.replace(target, routerOptions);
        },
        prefetch(href: Href, options?: { locale?: string }) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = getPathname({ href, locale: targetLocale });
          return router.prefetch(target);
        },
        back() {
          return router.back();
        },
        forward() {
          return router.forward();
        },
        refresh() {
          return router.refresh();
        },
      }),
      [router, currentLocale]
    );
  }

  function redirect(
    url: string,
    options?: { locale?: Locales[number] | string; type?: 'push' | 'replace' }
  ): never {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextRedirect(target, options?.type as any) as never;
  }

  function permanentRedirect(
    url: string,
    options?: { locale?: Locales[number] | string; type?: 'push' | 'replace' }
  ): never {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextPermanentRedirect(target, options?.type as any) as never;
  }

  return {
    Link,
    usePathname,
    useRouter,
    redirect,
    permanentRedirect,
    getPathname,
  };
}
