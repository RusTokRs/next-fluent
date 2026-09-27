const MAX_LOCALE_TAG_LENGTH = 64;
const HTTP_QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
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
const CANONICAL_CACHE_MAX = 500;
const canonicalCache = /* @__PURE__ */ new Map();
function canonicalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return void 0;
  if (locale.length > MAX_LOCALE_TAG_LENGTH) return void 0;
  if (canonicalCache.has(locale)) return canonicalCache.get(locale);
  const resolved = computeCanonicalLocale(locale);
  if (canonicalCache.size >= CANONICAL_CACHE_MAX) canonicalCache.clear();
  canonicalCache.set(locale, resolved);
  return resolved;
}
function computeCanonicalLocale(locale) {
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
function normalizeLocaleTag(value) {
  return canonicalizeLocale(value);
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
function parseAcceptLanguageEntry(entry) {
  const trimmed = entry.trim();
  if (!trimmed) return void 0;
  const firstSeparator = trimmed.indexOf(";");
  const tag = (firstSeparator === -1 ? trimmed : trimmed.slice(0, firstSeparator)).trim();
  if (!tag) return void 0;
  let quality = 1;
  let paramStart = firstSeparator === -1 ? trimmed.length : firstSeparator + 1;
  while (paramStart < trimmed.length) {
    const nextSeparator = trimmed.indexOf(";", paramStart);
    const paramEnd = nextSeparator === -1 ? trimmed.length : nextSeparator;
    const param = trimmed.slice(paramStart, paramEnd).trim();
    const qParam = param.match(/^q\s*=\s*(.*)$/i);
    if (qParam) {
      const rawQuality = qParam[1].trim();
      if (!HTTP_QVALUE.test(rawQuality)) return void 0;
      quality = Number(rawQuality);
      break;
    }
    if (nextSeparator === -1) break;
    paramStart = nextSeparator + 1;
  }
  if (quality <= 0) return void 0;
  return { tag, quality };
}
function resolveAcceptLanguage(header, locales, preferred) {
  if (!header) return void 0;
  let bestLocale;
  let bestQuality = Number.NEGATIVE_INFINITY;
  let entryStart = 0;
  while (entryStart <= header.length) {
    const separator = header.indexOf(",", entryStart);
    const entryEnd = separator === -1 ? header.length : separator;
    const candidate = parseAcceptLanguageEntry(header.slice(entryStart, entryEnd));
    if (candidate && candidate.quality > bestQuality) {
      const matched = candidate.tag === "*" ? (preferred ? matchSupportedLocale(preferred, locales) : void 0) ?? locales[0] : matchSupportedLocale(candidate.tag, locales);
      if (matched) {
        bestLocale = matched;
        bestQuality = candidate.quality;
      }
    }
    if (separator === -1) break;
    entryStart = separator + 1;
  }
  return bestLocale;
}
const LOCALE_PREFIX_MODES = ["always", "as-needed", "never"];
function validateLocalePrefix(locales, localePrefix) {
  if (localePrefix === void 0 || typeof localePrefix === "string") {
    if (localePrefix !== void 0 && !LOCALE_PREFIX_MODES.includes(localePrefix)) {
      throw new Error(
        `[next-fluent] "localePrefix" must be one of ${LOCALE_PREFIX_MODES.map((mode2) => `"${mode2}"`).join(", ")} (received "${localePrefix}").`
      );
    }
    return;
  }
  const { mode, prefixes } = localePrefix;
  if (mode !== void 0 && !LOCALE_PREFIX_MODES.includes(mode)) {
    throw new Error(
      `[next-fluent] "localePrefix.mode" must be one of ${LOCALE_PREFIX_MODES.map((m) => `"${m}"`).join(", ")} (received "${mode}").`
    );
  }
  if (prefixes === void 0) return;
  if (typeof prefixes !== "object" || prefixes === null) {
    throw new Error('[next-fluent] "localePrefix.prefixes" must be an object.');
  }
  const seen = /* @__PURE__ */ new Set();
  for (const [locale, prefix] of Object.entries(prefixes)) {
    if (!matchSupportedLocale(locale, locales)) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes" contains an unsupported locale: "${locale}".`
      );
    }
    if (typeof prefix !== "string" || !prefix.startsWith("/") || prefix.startsWith("//") || prefix.endsWith("/") || /[?#\\]/.test(prefix)) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes.${locale}" must be an absolute path without a trailing slash (received ${JSON.stringify(prefix)}).`
      );
    }
    if (prefix.split("/").some((segment) => segment === "." || segment === "..")) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes.${locale}" must not contain "." or ".." path segments (received ${JSON.stringify(prefix)}).`
      );
    }
    const identity = prefix.toLowerCase();
    if (seen.has(identity)) {
      throw new Error(`[next-fluent] Duplicate locale prefix: ${prefix}`);
    }
    for (const other of seen) {
      if (other.startsWith(`${identity}/`) || identity.startsWith(`${other}/`)) {
        throw new Error(`[next-fluent] Ambiguous locale prefixes: ${identity} and ${other}`);
      }
    }
    seen.add(identity);
  }
}
const VALID_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALID_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function hasLocale(locales, locale) {
  return matchSupportedLocale(locale ?? void 0, locales) !== void 0;
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
  validateLocalePrefix(options.locales, options.localePrefix);
  if (options.cookieName !== void 0 && !VALID_COOKIE_NAME.test(options.cookieName)) {
    throw new Error(
      `[next-fluent] "cookieName" must be a valid HTTP cookie name (received ${JSON.stringify(options.cookieName)}).`
    );
  }
  if (options.headerName !== void 0 && !VALID_HEADER_NAME.test(options.headerName)) {
    throw new Error(
      `[next-fluent] "headerName" must be a valid HTTP header name (received ${JSON.stringify(options.headerName)}).`
    );
  }
}
function withKebabKey(key) {
  return key.replaceAll(".", "-");
}
function buildKeyCandidates(namespace, key, options) {
  const candidates = [];
  const pushCandidate = (candidate) => {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };
  const cleanNs = namespace?.trim();
  if (cleanNs) {
    const joined = `${cleanNs}.${key}`;
    pushCandidate(withKebabKey(joined));
    pushCandidate(joined);
    const nsHyphen = withKebabKey(cleanNs);
    if (nsHyphen !== cleanNs) {
      pushCandidate(`${nsHyphen}-${key}`);
    }
    if (options?.strictNamespace) {
      return candidates;
    }
  }
  pushCandidate(withKebabKey(key));
  pushCandidate(key);
  return candidates;
}
export {
  buildKeyCandidates,
  canonicalizeLocale,
  hasLocale,
  localeLookupCandidates,
  matchSupportedLocale,
  normalizeLocaleTag,
  resolveAcceptLanguage,
  validateI18nConfig,
  validateLocalePrefix,
  withKebabKey
};
