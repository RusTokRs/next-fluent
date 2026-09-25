import { validateI18nConfig } from "./utils.js";
import { validatePathnames, validateRouteEnvironment } from "./route-engine.js";
function defineRouting(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
    cookieName: config.cookieName,
    headerName: config.headerName
  });
  validatePathnames(config.locales, config.pathnames);
  validateRouteEnvironment(config.locales, config.domains, config.basePath);
  return Object.freeze({
    ...config,
    localePrefix: config.localePrefix ?? "always",
    cookieName: config.cookieName ?? "NEXT_LOCALE",
    headerName: config.headerName ?? "x-next-locale"
  });
}
export {
  defineRouting
};
