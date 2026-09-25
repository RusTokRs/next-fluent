import React, { forwardRef, useMemo } from 'react';
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
import { validatePathnames, validateRouteEnvironment } from './route-engine';
import {
  formatUrlObject,
  resolveLocalizedPathname,
  rewriteToInternalPath,
  switchLocaleHref,
} from './nav-url';
import { LocalizedLink, useLocale } from './client';

// Pure URL helpers stay available from this entry for backwards compatibility.
export { formatUrlObject, resolveLocalizedPathname, assertSafeHref, isExternalUrl } from './nav-url';

const STUB_ROUTER = {
  push: () => {},
  replace: () => {},
  prefetch: () => {},
  back: () => {},
  forward: () => {},
  refresh: () => {},
} as unknown as ReturnType<typeof useNextRouter>;

export function createNavigation<
  const Locales extends readonly string[],
  const Routes extends Record<string, string | Record<string, string>>
>(config: Omit<NavigationConfig<Locales>, 'pathnames'> & { pathnames: Routes }): Navigation<Locales, keyof Routes & string>;
export function createNavigation<Locales extends readonly string[] = readonly string[]>(
  config: NavigationConfig<Locales>
): Navigation<Locales>;
export function createNavigation<Locales extends readonly string[] = readonly string[]>(
  config: NavigationConfig<Locales>
): Navigation<Locales> {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
  });
  validatePathnames(config.locales, config.pathnames);
  validateRouteEnvironment(config.locales, config.domains, config.basePath);

  const { locales, defaultLocale, pathnames, basePath = '' } = config;

  const getPathname = (options: GetPathnameOptions): string => {
    return resolveLocalizedPathname(options, config);
  };

  /**
   * Thin, hook-free wrapper. The hook-using implementation lives in the client
   * entry (`LocalizedLink`), so this wrapper can be rendered from Server
   * Components as well — it only creates a client-element reference.
   */
  const Link = forwardRef<HTMLAnchorElement, any>(function NextFluentLink(props, ref) {
    return React.createElement(LocalizedLink, { ...props, navConfig: config, ref });
  });
  Link.displayName = 'I18nLink';

  function usePathname(): string {
    const currentLocale = useLocale();
    // `usePathname` from next/navigation reads context and returns null outside
    // the router instead of throwing, so it is called unconditionally.
    const nextPathname = useNextPathname() || '';
    let rawPathname = nextPathname;
    if (!rawPathname) return rawPathname;
    if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
      rawPathname = rawPathname.slice(basePath.length) || '/';
    }

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

    const internal = rewriteToInternalPath(lookupKey, currentLocale, locales, pathnames);
    return cleanPathname.endsWith('/') && internal !== '/' ? `${internal}/` : internal;
  }

  function useRouter() {
    // `useRouter` from next/navigation throws outside the App Router. The hook
    // registers its context read before the invariant, so the hook order stays
    // stable even when the throw is caught here.
    let router: ReturnType<typeof useNextRouter>;
    try {
      router = useNextRouter();
    } catch {
      router = STUB_ROUTER;
    }
    const currentLocale = useLocale();

    return useMemo(
      () => ({
        ...router,
        push(href: Href, options?: { locale?: string; scroll?: boolean }) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(
            getPathname({ href, locale: targetLocale }),
            options?.locale,
            config
          );
          const routerOptions = options?.scroll !== undefined ? { scroll: options.scroll } : undefined;
          return router.push(target, routerOptions);
        },
        replace(href: Href, options?: { locale?: string; scroll?: boolean }) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(
            getPathname({ href, locale: targetLocale }),
            options?.locale,
            config
          );
          const routerOptions = options?.scroll !== undefined ? { scroll: options.scroll } : undefined;
          return router.replace(target, routerOptions);
        },
        prefetch(href: Href, options?: { locale?: string }) {
          if (options?.locale && config.localePrefix !== 'always') return;
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

export type { UrlObject };
