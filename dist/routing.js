// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
function localeDiagnosticValue(locale) {
  if (typeof locale !== "string") {
    const kind = locale === null ? "null" : typeof locale;
    return `<non-string locale: ${kind}>`;
  }
  if (locale.length > MAX_LOCALE_TAG_LENGTH) {
    return `<oversized locale: ${locale.length} code units>`;
  }
  return locale;
}
function canonicalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return void 0;
  if (locale.length > MAX_LOCALE_TAG_LENGTH) return void 0;
  let raw = locale.trim();
  if (!raw) return void 0;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).trim();
    if (!raw) return void 0;
  }
  const normalized = raw.replaceAll("_", "-");
  try {
    const canonical = Intl.getCanonicalLocales(normalized);
    return canonical[0];
  } catch {
    return void 0;
  }
}
function validateI18nConfig(options) {
  if (!options || !Array.isArray(options.locales) || options.locales.length === 0) {
    throw new Error('[next-fluent] "locales" must be a non-empty array.');
  }
  const canonicalLocales = /* @__PURE__ */ new Set();
  for (const loc of options.locales) {
    const canonical = canonicalizeLocale(loc);
    if (!canonical) {
      throw new Error(
        `[next-fluent] Invalid locale tag in "locales": "${localeDiagnosticValue(loc)}"`
      );
    }
    const identity = canonical.toLowerCase();
    if (canonicalLocales.has(identity)) {
      throw new Error(
        `[next-fluent] Duplicate locale identity in "locales": "${canonical}"`
      );
    }
    canonicalLocales.add(identity);
  }
  const defaultCanonical = canonicalizeLocale(options.defaultLocale);
  if (!defaultCanonical) {
    throw new Error(
      `[next-fluent] Invalid "defaultLocale": "${localeDiagnosticValue(options.defaultLocale)}"`
    );
  }
  if (!canonicalLocales.has(defaultCanonical.toLowerCase())) {
    throw new Error(
      `[next-fluent] "defaultLocale" ("${options.defaultLocale}") must be included in "locales" [${options.locales.join(", ")}].`
    );
  }
}

// src/routing.ts
function defineRouting(config) {
  validateI18nConfig({
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    localePrefix: config.localePrefix,
    cookieName: config.cookieName,
    headerName: config.headerName
  });
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
