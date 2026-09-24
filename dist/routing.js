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
function localeLookupCandidates(canonical) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (candidate && !candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) {
      candidates.push(candidate);
    }
  };
  pushCandidate(canonical);
  try {
    const locale = new Intl.Locale(canonical);
    pushCandidate(locale.baseName);
    const core = [locale.language, locale.script, locale.region].filter((part) => Boolean(part)).join("-");
    pushCandidate(core);
    if (locale.region) {
      pushCandidate([locale.language, locale.script].filter(Boolean).join("-"));
    }
    if (locale.script || locale.region) {
      pushCandidate(locale.language);
    }
  } catch {
  }
  return candidates;
}
function matchSupportedLocale(value, locales) {
  if (!value) return void 0;
  const canonical = canonicalizeLocale(value);
  if (!canonical) return void 0;
  for (const candidate of localeLookupCandidates(canonical)) {
    const normalizedCandidate = candidate.toLowerCase();
    const matched = locales.find((loc) => {
      const locCanonical = canonicalizeLocale(loc);
      return locCanonical?.toLowerCase() === normalizedCandidate;
    });
    if (matched) return matched;
  }
  return void 0;
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

// src/route-engine.ts
function segments(path) {
  return path.split("/").filter(Boolean);
}
function parameter(segment) {
  let match = /^\[\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]\]$/.exec(segment);
  if (match) return { name: match[1], kind: "optional" };
  match = /^\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  if (match) return { name: match[1], kind: "many" };
  match = /^\[([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  return match ? { name: match[1], kind: "one" } : null;
}
function externalTemplate(internal, locale, pathnames) {
  const mapped = pathnames?.[internal];
  return typeof mapped === "string" ? mapped : mapped?.[locale] ?? internal;
}
function validatePathnames(locales, pathnames) {
  if (!pathnames) return;
  for (const locale of locales) {
    const seen = /* @__PURE__ */ new Set();
    for (const internal of Object.keys(pathnames)) {
      const external = externalTemplate(internal, locale, pathnames);
      if (!internal.startsWith("/") || !external.startsWith("/") || external.startsWith("//")) {
        throw new Error("[next-fluent] Pathnames must be internal absolute paths.");
      }
      const key = external.toLowerCase();
      if (seen.has(key)) throw new Error(`[next-fluent] Duplicate pathname for ${locale}: ${external}`);
      seen.add(key);
      const internalParams = segments(internal).flatMap((part) => {
        const value = parameter(part);
        return value ? [value.name] : [];
      }).sort();
      const externalParams = segments(external).flatMap((part) => {
        const value = parameter(part);
        return value ? [value.name] : [];
      }).sort();
      if (internalParams.join() !== externalParams.join()) {
        throw new Error(`[next-fluent] Route parameters differ for ${internal} (${locale}).`);
      }
    }
  }
}
function validateRouteEnvironment(locales, domains, basePath) {
  if (basePath !== void 0 && (basePath !== "" && (!basePath.startsWith("/") || basePath.startsWith("//") || basePath.endsWith("/") || /[?#\\]/.test(basePath)))) {
    throw new Error("[next-fluent] basePath must be an absolute path without a trailing slash.");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const entry of domains ?? []) {
    let url;
    try {
      url = new URL(`https://${entry.domain}`);
    } catch {
      throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`);
    }
    if (url.host !== entry.domain || url.pathname !== "/" || !url.hostname) {
      throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`);
    }
    const name = entry.domain.toLowerCase();
    if (seen.has(name)) throw new Error(`[next-fluent] Duplicate domain: ${entry.domain}`);
    seen.add(name);
    const domainLocales = entry.locales ?? [entry.defaultLocale];
    if (!matchSupportedLocale(entry.defaultLocale, domainLocales)) {
      throw new Error(`[next-fluent] Domain defaultLocale must be in its locales: ${entry.domain}`);
    }
    for (const locale of domainLocales) {
      if (!matchSupportedLocale(locale, locales)) {
        throw new Error(`[next-fluent] Unsupported domain locale: ${locale}`);
      }
    }
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
