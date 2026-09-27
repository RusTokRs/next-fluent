import type { DomainConfig, Pathnames } from './types';
import { matchSupportedLocale, validateLocalePrefix } from './utils';

type Params = Record<string, string | string[]>;
interface Match { template: string; params: Params; }

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function parameter(segment: string): { name: string; kind: 'one' | 'many' | 'optional' } | null {
  let match = /^\[\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]\]$/.exec(segment);
  if (match) return { name: match[1], kind: 'optional' };
  match = /^\[\.\.\.([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  if (match) return { name: match[1], kind: 'many' };
  match = /^\[([A-Za-z][A-Za-z\d_]*)\]$/.exec(segment);
  return match ? { name: match[1], kind: 'one' } : null;
}

function decode(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function matchTemplate(template: string, pathname: string): Params | null {
  const pattern = segments(template);
  const actual = segments(pathname);
  const params: Params = {};
  let index = 0;
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    const variable = parameter(part);
    if (variable?.kind === 'many' || variable?.kind === 'optional') {
      if (i !== pattern.length - 1) return null;
      const rest = actual.slice(index).map(decode);
      if (variable.kind === 'many' && rest.length === 0) return null;
      params[variable.name] = rest;
      index = actual.length;
      break;
    }
    if (index >= actual.length) return null;
    if (variable) params[variable.name] = decode(actual[index]);
    else if (decode(part) !== decode(actual[index])) return null;
    index++;
  }
  return index === actual.length ? params : null;
}

/**
 * Lexicographic segment priority: static > single > catch-all > optional.
 * A terminator ranks highest so /docs wins over /docs/[[...slug]] on /docs.
 * Counting static segments alone loses precedence at the first differing slot.
 */
function specificity(template: string): string {
  return segments(template).map((part) => {
    const kind = parameter(part)?.kind;
    return kind === 'optional' ? '1' : kind === 'many' ? '2' : kind === 'one' ? '3' : '4';
  }).join('') + '5';
}

export function externalTemplate(
  internal: string,
  locale: string,
  pathnames?: Pathnames<any>
): string {
  const mapped = pathnames?.[internal];
  return typeof mapped === 'string' ? mapped : mapped?.[locale] ?? internal;
}

export function findInternalPath(
  pathname: string,
  locale: string,
  pathnames?: Pathnames<any>
): Match | null {
  if (!pathnames) return null;
  // A parameterized internal key explicitly identifies a route, rather than a
  // concrete public URL that a translated catch-all is allowed to capture.
  if (Object.hasOwn(pathnames, pathname) && segments(pathname).some(parameter)) {
    return { template: pathname, params: matchTemplate(pathname, pathname)! };
  }
  const entries = Object.keys(pathnames);
  // Public templates take precedence over internal fallbacks. Rank the actual
  // template being matched in each pass; a localized route may have a very
  // different structure from its internal key.
  for (const localized of [true, false]) {
    let best: Match | null = null;
    let bestRank = '';
    for (const internal of entries) {
      const template = localized ? externalTemplate(internal, locale, pathnames) : internal;
      const params = matchTemplate(template, pathname);
      if (!params) continue;
      // Exact supplied templates outrank incidental parameter captures.
      const rank = template === pathname ? '6' : specificity(template);
      if (rank > bestRank) { best = { template: internal, params }; bestRank = rank; }
    }
    if (best) return best;
  }
  return null;
}

export function renderTemplate(template: string, params: Params): string {
  const result: string[] = [];
  for (const part of segments(template)) {
    const variable = parameter(part);
    if (!variable) { result.push(part); continue; }
    const value = params[variable.name];
    if (value === undefined) {
      if (variable.kind === 'optional') continue;
      throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
    }
    if (variable.kind === 'one') {
      if (Array.isArray(value)) throw new Error(`[next-fluent] Expected one route parameter: ${variable.name}`);
      result.push(encodeURIComponent(value));
    } else {
      const list = Array.isArray(value) ? value : [value];
      if (variable.kind === 'many' && list.length === 0) {
        throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
      }
      result.push(...list.map(encodeURIComponent));
    }
  }
  return `/${result.join('/')}`;
}

export function localizePath(
  pathname: string,
  sourceLocale: string,
  targetLocale: string,
  pathnames?: Pathnames<any>,
  query?: Record<string, unknown>,
  locales?: readonly string[]
): { pathname: string; consumed: string[] } {
  const match = findInternalPath(pathname, sourceLocale, pathnames)
    ?? findInternalPath(pathname, targetLocale, pathnames)
    ?? locales?.map((locale) => findInternalPath(pathname, locale, pathnames)).find(Boolean);
  if (!match) return { pathname, consumed: [] };
  const params = { ...match.params };
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      params[name] = Array.isArray(value) ? value.map(String) : String(value);
    }
  }
  const target = externalTemplate(match.template, targetLocale, pathnames);
  return { pathname: renderTemplate(target, params), consumed: Object.keys(match.params).concat(
    segments(target).flatMap((part) => {
      const value = parameter(part);
      return value ? [value.name] : [];
    })
  ) };
}

export function rewriteLocalizedPath(
  pathname: string,
  locale: string,
  pathnames?: Pathnames<any>
): string {
  const match = findInternalPath(pathname, locale, pathnames);
  if (!match) return pathname;
  const result = renderTemplate(match.template, match.params);
  return pathname.length > 1 && pathname.endsWith('/') && !result.endsWith('/')
    ? `${result}/`
    : result;
}

export function validatePathnames(locales: readonly string[], pathnames?: Pathnames<any>): void {
  if (!pathnames) return;
  for (const locale of locales) {
    const seen = new Set<string>();
    for (const internal of Object.keys(pathnames)) {
      const external = externalTemplate(internal, locale, pathnames);
      if (!internal.startsWith('/') || !external.startsWith('/') || external.startsWith('//')) {
        throw new Error('[next-fluent] Pathnames must be internal absolute paths.');
      }
      const key = external.toLowerCase();
      if (seen.has(key)) throw new Error(`[next-fluent] Duplicate pathname for ${locale}: ${external}`);
      seen.add(key);
      const internalParams = segments(internal).flatMap((part) => {
        const value = parameter(part); return value ? [value.name] : [];
      }).sort();
      const externalParams = segments(external).flatMap((part) => {
        const value = parameter(part); return value ? [value.name] : [];
      }).sort();
      if (internalParams.join() !== externalParams.join()) {
        throw new Error(`[next-fluent] Route parameters differ for ${internal} (${locale}).`);
      }
    }
  }
}

export function validateRouteEnvironment(
  locales: readonly string[],
  domains?: readonly DomainConfig[],
  basePath?: string
): void {
  if (basePath !== undefined && (basePath !== '' && (
    !basePath.startsWith('/') || basePath.startsWith('//') ||
    basePath.endsWith('/') || /[?#\\]/.test(basePath)
  ))) {
    throw new Error('[next-fluent] basePath must be an absolute path without a trailing slash.');
  }
  const seen = new Set<string>();
  for (const entry of domains ?? []) {
    let url: URL;
    try { url = new URL(`https://${entry.domain}`); }
    catch { throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`); }
    if (url.host.toLowerCase() !== entry.domain.toLowerCase() || url.pathname !== '/' || !url.hostname) {
      throw new Error(`[next-fluent] Invalid domain: ${entry.domain}`);
    }
    const name = entry.domain.toLowerCase();
    if (seen.has(name)) throw new Error(`[next-fluent] Duplicate domain: ${entry.domain}`);
    seen.add(name);
    const domainLocales = entry.locales ?? [entry.defaultLocale];
    if (!matchSupportedLocale(entry.defaultLocale, domainLocales)) {
      throw new Error(`[next-fluent] Domain defaultLocale must be in its locales: ${entry.domain}`);
    }
    const canonicalLocales = domainLocales.map((locale) => {
      const supported = matchSupportedLocale(locale, locales);
      if (!supported) throw new Error(`[next-fluent] Unsupported domain locale: ${locale}`);
      return supported;
    });
    validateLocalePrefix(canonicalLocales, entry.localePrefix);
  }
}
