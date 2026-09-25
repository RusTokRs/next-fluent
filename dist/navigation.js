import React, { forwardRef, useMemo } from "react";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  redirect as nextRedirect,
  permanentRedirect as nextPermanentRedirect
} from "next/navigation.js";
import { matchSupportedLocale, validateI18nConfig } from "./utils.js";
import { validatePathnames, validateRouteEnvironment } from "./route-engine.js";
import {
  resolveLocalizedPathname,
  rewriteToInternalPath,
  switchLocaleHref
} from "./nav-url.js";
import { LocalizedLink, useLocale } from "./client.js";
import { formatUrlObject as formatUrlObject2, resolveLocalizedPathname as resolveLocalizedPathname2, assertSafeHref, isExternalUrl } from "./nav-url.js";
const STUB_ROUTER = {
  push: () => {
  },
  replace: () => {
  },
  prefetch: () => {
  },
  back: () => {
  },
  forward: () => {
  },
  refresh: () => {
  }
};
function createNavigation(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix
  });
  validatePathnames(config.locales, config.pathnames);
  validateRouteEnvironment(config.locales, config.domains, config.basePath);
  const { locales, defaultLocale, pathnames, basePath = "" } = config;
  const getPathname = (options) => {
    return resolveLocalizedPathname(options, config);
  };
  const Link = forwardRef(function NextFluentLink(props, ref) {
    return React.createElement(LocalizedLink, { ...props, navConfig: config, ref });
  });
  Link.displayName = "I18nLink";
  function usePathname() {
    const currentLocale = useLocale();
    const nextPathname = useNextPathname() || "";
    let rawPathname = nextPathname;
    if (!rawPathname) return rawPathname;
    if (basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))) {
      rawPathname = rawPathname.slice(basePath.length) || "/";
    }
    const segments = rawPathname.split("/").filter(Boolean);
    if (segments.length === 0) return "/";
    let cleanPathname = rawPathname;
    const first = segments[0];
    if (matchSupportedLocale(first, locales)) {
      const rest = segments.slice(1).join("/");
      cleanPathname = rest ? `/${rest}` : "/";
    }
    const lookupKey = cleanPathname.length > 1 && cleanPathname.endsWith("/") ? cleanPathname.slice(0, -1) : cleanPathname;
    const internal = rewriteToInternalPath(lookupKey, currentLocale, locales, pathnames);
    return cleanPathname.endsWith("/") && internal !== "/" ? `${internal}/` : internal;
  }
  function useRouter() {
    let router;
    try {
      router = useNextRouter();
    } catch {
      router = STUB_ROUTER;
    }
    const currentLocale = useLocale();
    return useMemo(
      () => ({
        ...router,
        push(href, options) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(
            getPathname({ href, locale: targetLocale }),
            options?.locale,
            config
          );
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.push(target, routerOptions);
        },
        replace(href, options) {
          const targetLocale = options?.locale ?? currentLocale ?? defaultLocale;
          const target = switchLocaleHref(
            getPathname({ href, locale: targetLocale }),
            options?.locale,
            config
          );
          const routerOptions = options?.scroll !== void 0 ? { scroll: options.scroll } : void 0;
          return router.replace(target, routerOptions);
        },
        prefetch(href, options) {
          if (options?.locale && config.localePrefix !== "always") return;
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
        }
      }),
      [router, currentLocale]
    );
  }
  function redirect(url, options) {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextRedirect(target, options?.type);
  }
  function permanentRedirect(url, options) {
    const targetLocale = options?.locale ?? defaultLocale;
    const target = getPathname({ href: url, locale: targetLocale });
    return nextPermanentRedirect(target, options?.type);
  }
  return {
    Link,
    usePathname,
    useRouter,
    redirect,
    permanentRedirect,
    getPathname
  };
}
export {
  assertSafeHref,
  createNavigation,
  formatUrlObject2 as formatUrlObject,
  isExternalUrl,
  resolveLocalizedPathname2 as resolveLocalizedPathname
};
