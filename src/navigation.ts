'use client';

import React, { forwardRef, useMemo } from 'react';

let NextLink: any = 'a';
let useNextPathname: any = () => '';
let useNextRouter: any = () => ({
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
});
let nextRedirect: any = (url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
};
let nextPermanentRedirect: any = (url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
};

try {
  const linkMod: any = await import('next/link.js').catch(() => import('next/link'));
  NextLink = linkMod.default ?? linkMod;
} catch {
  // Fallback for non-Next or test runtime
}

try {
  const navMod: any = await import('next/navigation.js').catch(() => import('next/navigation'));
  useNextPathname = navMod.usePathname ?? useNextPathname;
  useNextRouter = navMod.useRouter ?? useNextRouter;
  nextRedirect = navMod.redirect ?? nextRedirect;
  nextPermanentRedirect = navMod.permanentRedirect ?? nextPermanentRedirect;
} catch {
  // Fallback for non-Next or test runtime
}
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
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  let search = urlObj.search ?? '';
  if (search && !search.startsWith('?')) {
    search = `?${search}`;
  } else if (!search && urlObj.query) {
    if (typeof urlObj.query === 'string') {
      search = urlObj.query.startsWith('?') ? urlObj.query : `?${urlObj.query}`;
    } else {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(urlObj.query)) {
        if (v !== undefined && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) {
              params.append(k, String(item));
            }
          } else {
            params.set(k, String(v));
          }
        }
      }
      const qs = params.toString();
      search = qs ? `?${qs}` : '';
    }
  }

  let hash = urlObj.hash ?? '';
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
  const { locales, defaultLocale, localePrefix = 'always' } = config;

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

  // Normalize any Windows backslashes in route pathname
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

  const resolvedLocale = explicitLocale
    ? (matchSupportedLocale(explicitLocale, locales) ?? defaultLocale)
    : defaultLocale;

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
    ? cleanPathname === '/'
      ? prefix
      : `${prefix}${cleanPathname}`
    : cleanPathname;

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

  const { locales, defaultLocale } = config;
  const ResolvedNextLink = (NextLink as any)?.default ?? NextLink;

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

    return React.createElement(ResolvedNextLink, {
      ...rest,
      href: localizedHref,
      ref,
    });
  });
  Link.displayName = 'I18nLink';

  function usePathname(): string {
    const rawPathname = useNextPathname();
    if (!rawPathname) return rawPathname;

    const segments = rawPathname.split('/').filter(Boolean);
    if (segments.length === 0) return '/';

    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join('/');
      return rest ? `/${rest}` : '/';
    }

    return rawPathname;
  }

  function useRouter() {
    const router = useNextRouter();

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
