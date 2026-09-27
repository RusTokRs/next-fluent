import type { LocalePrefixConfig } from './types';

const MAX_LOCALE_TAG_LENGTH = 64;
const HTTP_QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function localeDiagnosticValue(locale: unknown): string {
  if (typeof locale !== 'string') {
    const kind = locale === null ? 'null' : typeof locale;
    return `<non-string locale: ${kind}>`;
  }
  if (locale.length > MAX_LOCALE_TAG_LENGTH) {
    return `<oversized locale: ${locale.length} code units>`;
  }
  return locale;
}

/**
 * `Intl.getCanonicalLocales` is comparatively expensive, and locale resolution
 * asks for the same handful of configured tags on every request — measurably
 * ~113 us to match the last of 184 locales versus ~29 us for the first, which
 * showed up as ~3.5 ms of middleware time per request on a 200-locale site.
 *
 * Bounded, because the input can be request-controlled: an attacker could
 * otherwise grow the map without limit by varying the cookie. Caching negative
 * results matters too — it makes repeated garbage cheap instead of expensive.
 */
const CANONICAL_CACHE_MAX = 500;
const canonicalCache = new Map<string, string | undefined>();

export function canonicalizeLocale(locale?: string | null): string | undefined {
  if (!locale || typeof locale !== 'string') return undefined;
  if (locale.length > MAX_LOCALE_TAG_LENGTH) return undefined;
  if (canonicalCache.has(locale)) return canonicalCache.get(locale);
  const resolved = computeCanonicalLocale(locale);
  if (canonicalCache.size >= CANONICAL_CACHE_MAX) canonicalCache.clear();
  canonicalCache.set(locale, resolved);
  return resolved;
}

function computeCanonicalLocale(locale: string): string | undefined {

  // Bound request-controlled raw input before trim/replaceAll can allocate copies.
  let raw = locale.trim();
  if (!raw) return undefined;

  // Strip surrounding quotes if present (e.g. from quoted HTTP cookies: "en")
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    raw = raw.slice(1, -1).trim();
    if (!raw) return undefined;
  }

  const normalized = raw.replaceAll('_', '-');

  try {
    const canonical = Intl.getCanonicalLocales(normalized);
    return canonical[0];
  } catch {
    return undefined;
  }
}

export function normalizeLocaleTag(value?: string | null): string | undefined {
  return canonicalizeLocale(value);
}

export function localeLookupCandidates(canonical: string): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate?: string): void => {
    if (candidate && !candidates.some((item) => item.toLowerCase() === candidate.toLowerCase())) {
      candidates.push(candidate);
    }
  };

  pushCandidate(canonical);

  try {
    const locale = new Intl.Locale(canonical);

    // Extensions are not a structural fallback layer for catalog selection.
    // Probe the extension-free base name before removing variant/core parts.
    pushCandidate(locale.baseName);

    // Treat all variants as one specificity layer. Intl canonicalization can
    // reorder variants, so peeling serialized subtags one-by-one can manufacture
    // arbitrary partial-variant parents just like unic-langid can on Rust.
    const core = [locale.language, locale.script, locale.region]
      .filter((part): part is string => Boolean(part))
      .join('-');
    pushCandidate(core);

    if (locale.region) {
      pushCandidate([locale.language, locale.script].filter(Boolean).join('-'));
    }
    if (locale.script || locale.region) {
      pushCandidate(locale.language);
    }
  } catch {
    // `canonical` came from Intl.getCanonicalLocales, so this is defensive only.
  }

  return candidates;
}

export function matchSupportedLocale(
  value: string | null | undefined,
  locales: readonly string[]
): string | undefined {
  if (!value) return undefined;
  const canonical = canonicalizeLocale(value);
  if (!canonical) return undefined;

  for (const candidate of localeLookupCandidates(canonical)) {
    const normalizedCandidate = candidate.toLowerCase();
    const matched = locales.find((loc) => {
      const locCanonical = canonicalizeLocale(loc);
      return locCanonical?.toLowerCase() === normalizedCandidate;
    });
    if (matched) return matched;
  }

  return undefined;
}

function parseAcceptLanguageEntry(entry: string): { tag: string; quality: number } | undefined {
  const trimmed = entry.trim();
  if (!trimmed) return undefined;

  const firstSeparator = trimmed.indexOf(';');
  const tag = (firstSeparator === -1 ? trimmed : trimmed.slice(0, firstSeparator)).trim();
  if (!tag) return undefined;

  let quality = 1.0;
  let paramStart = firstSeparator === -1 ? trimmed.length : firstSeparator + 1;

  while (paramStart < trimmed.length) {
    const nextSeparator = trimmed.indexOf(';', paramStart);
    const paramEnd = nextSeparator === -1 ? trimmed.length : nextSeparator;
    const param = trimmed.slice(paramStart, paramEnd).trim();
    const qParam = param.match(/^q\s*=\s*(.*)$/i);
    if (qParam) {
      const rawQuality = qParam[1].trim();
      if (!HTTP_QVALUE.test(rawQuality)) return undefined;
      quality = Number(rawQuality);
      break;
    }

    if (nextSeparator === -1) break;
    paramStart = nextSeparator + 1;
  }

  if (quality <= 0) return undefined;
  return { tag, quality };
}

export function resolveAcceptLanguage(
  header: string | null | undefined,
  locales: readonly string[],
  preferred?: string
): string | undefined {
  if (!header) return undefined;

  // Parse candidates one at a time instead of materializing and sorting the
  // entire request-controlled header. Tracking only the best supported match
  // preserves descending-q and stable first-seen semantics with bounded
  // auxiliary memory regardless of candidate count.
  let bestLocale: string | undefined;
  let bestQuality = Number.NEGATIVE_INFINITY;
  let entryStart = 0;

  while (entryStart <= header.length) {
    const separator = header.indexOf(',', entryStart);
    const entryEnd = separator === -1 ? header.length : separator;
    const candidate = parseAcceptLanguageEntry(header.slice(entryStart, entryEnd));

    if (candidate && candidate.quality > bestQuality) {
      const matched = candidate.tag === '*'
        ? (preferred ? matchSupportedLocale(preferred, locales) : undefined) ?? locales[0]
        : matchSupportedLocale(candidate.tag, locales);

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

export interface BaseI18nConfig {
  locales: readonly string[];
  defaultLocale: string;
  localePrefix?: LocalePrefixConfig;
  cookieName?: string;
  headerName?: string;
  loadMessages?: unknown;
}

const LOCALE_PREFIX_MODES = ['always', 'as-needed', 'never'] as const;

/** Throws on malformed `localePrefix` maps so misconfiguration fails at boot. */
export function validateLocalePrefix(
  locales: readonly string[],
  localePrefix?: LocalePrefixConfig
): void {
  if (localePrefix === undefined || typeof localePrefix === 'string') {
    if (
      localePrefix !== undefined &&
      !LOCALE_PREFIX_MODES.includes(localePrefix as (typeof LOCALE_PREFIX_MODES)[number])
    ) {
      throw new Error(
        `[next-fluent] "localePrefix" must be one of ${LOCALE_PREFIX_MODES.map((mode) => `"${mode}"`).join(', ')} (received "${localePrefix}").`
      );
    }
    return;
  }

  const { mode, prefixes } = localePrefix;
  if (mode !== undefined && !LOCALE_PREFIX_MODES.includes(mode)) {
    throw new Error(
      `[next-fluent] "localePrefix.mode" must be one of ${LOCALE_PREFIX_MODES.map((m) => `"${m}"`).join(', ')} (received "${mode}").`
    );
  }
  if (prefixes === undefined) return;
  if (typeof prefixes !== 'object' || prefixes === null) {
    throw new Error('[next-fluent] "localePrefix.prefixes" must be an object.');
  }

  const effective = new Map<string, string>();
  for (const [locale, prefix] of Object.entries(prefixes)) {
    const supported = matchSupportedLocale(locale, locales);
    if (!supported) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes" contains an unsupported locale: "${locale}".`
      );
    }
    if (
      typeof prefix !== 'string' || !prefix.startsWith('/') || prefix.startsWith('//') ||
      prefix.endsWith('/') || /[?#\\]/.test(prefix)
    ) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes.${locale}" must be an absolute path without a trailing slash (received ${JSON.stringify(prefix)}).`
      );
    }
    if (prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error(
        `[next-fluent] "localePrefix.prefixes.${locale}" must not contain "." or ".." path segments (received ${JSON.stringify(prefix)}).`
      );
    }
    // Match normalizeLocalePrefix: the first alias of a supported locale wins.
    if (!effective.has(supported)) effective.set(supported, prefix);
  }

  // Validate what routing will actually use, not just the explicitly supplied
  // entries: e.g. ru: '/en' collides with en's implicit default prefix.
  const seen = new Set<string>();
  for (const locale of locales) {
    const prefix = effective.get(locale) ?? `/${locale}`;
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
/** RFC 6265 cookie-name: token characters except `=`. */
const VALID_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** RFC 9110 field-name: token characters. */
const VALID_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Type guard for "is this value one of the configured locales". */
export function hasLocale(
  locales: readonly string[],
  locale: string | null | undefined
): locale is string {
  return matchSupportedLocale(locale ?? undefined, locales) !== undefined;
}

export function validateI18nConfig(options: BaseI18nConfig): void {
  if (!options || !Array.isArray(options.locales) || options.locales.length === 0) {
    throw new Error('[next-fluent] "locales" must be a non-empty array.');
  }

  // Locale matching throughout the package is canonical and case-insensitive.
  // Reject duplicate canonical identities at configuration time instead of
  // allowing two raw spellings to compete for the same runtime locale.
  const canonicalLocales = new Set<string>();
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
      `[next-fluent] "defaultLocale" ("${options.defaultLocale}") must be included in "locales" [${options.locales.join(', ')}].`
    );
  }

  // A mistyped prefix mode silently degrades to 'always' in the middleware and
  // to prefixed URLs in navigation, so reject unknown values up front.
  validateLocalePrefix(options.locales, options.localePrefix);

  if (options.cookieName !== undefined && !VALID_COOKIE_NAME.test(options.cookieName)) {
    throw new Error(
      `[next-fluent] "cookieName" must be a valid HTTP cookie name (received ${JSON.stringify(options.cookieName)}).`
    );
  }

  if (options.headerName !== undefined && !VALID_HEADER_NAME.test(options.headerName)) {
    throw new Error(
      `[next-fluent] "headerName" must be a valid HTTP header name (received ${JSON.stringify(options.headerName)}).`
    );
  }
}

export function withKebabKey(key: string): string {
  return key.replaceAll('.', '-');
}

export interface BuildKeyCandidatesOptions {
  strictNamespace?: boolean;
}

export function buildKeyCandidates(
  namespace: string | undefined,
  key: string,
  options?: BuildKeyCandidatesOptions
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (candidate: string): void => {
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  const cleanNs = namespace?.trim();
  if (cleanNs) {
    const joined = `${cleanNs}.${key}`;
    pushCandidate(withKebabKey(joined));
    pushCandidate(joined);

    // Keep the legacy namespace-hyphen alias, but avoid probing an equivalent
    // candidate twice when it matches the kebab form of the joined key.
    const nsHyphen = withKebabKey(cleanNs);
    if (nsHyphen !== cleanNs) {
      pushCandidate(`${nsHyphen}-${key}`);
    }

    if (options?.strictNamespace) {
      return candidates;
    }
  }

  // Key as-is with kebab conversion and direct key, preserving first-seen order.
  pushCandidate(withKebabKey(key));
  pushCandidate(key);

  return candidates;
}
