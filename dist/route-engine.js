import { matchSupportedLocale } from "./utils.js";
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
function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
function matchTemplate(template, pathname) {
  const pattern = segments(template);
  const actual = segments(pathname);
  const params = {};
  let index = 0;
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    const variable = parameter(part);
    if (variable?.kind === "many" || variable?.kind === "optional") {
      if (i !== pattern.length - 1) return null;
      const rest = actual.slice(index).map(decode);
      if (variable.kind === "many" && rest.length === 0) return null;
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
function specificity(template) {
  return segments(template).reduce((score, part) => score + (parameter(part) ? 0 : 10), 0);
}
function externalTemplate(internal, locale, pathnames) {
  const mapped = pathnames?.[internal];
  return typeof mapped === "string" ? mapped : mapped?.[locale] ?? internal;
}
function findInternalPath(pathname, locale, pathnames) {
  if (!pathnames) return null;
  const entries = Object.keys(pathnames).sort((a, b) => specificity(b) - specificity(a));
  for (const internal of entries) {
    const external = externalTemplate(internal, locale, pathnames);
    const params = matchTemplate(external, pathname);
    if (params) return { template: internal, params };
  }
  for (const internal of entries) {
    const params = matchTemplate(internal, pathname);
    if (params) return { template: internal, params };
  }
  return null;
}
function renderTemplate(template, params) {
  const result = [];
  for (const part of segments(template)) {
    const variable = parameter(part);
    if (!variable) {
      result.push(part);
      continue;
    }
    const value = params[variable.name];
    if (value === void 0) {
      if (variable.kind === "optional") continue;
      throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
    }
    if (variable.kind === "one") {
      if (Array.isArray(value)) throw new Error(`[next-fluent] Expected one route parameter: ${variable.name}`);
      result.push(encodeURIComponent(value));
    } else {
      const list = Array.isArray(value) ? value : [value];
      if (variable.kind === "many" && list.length === 0) {
        throw new Error(`[next-fluent] Missing route parameter: ${variable.name}`);
      }
      result.push(...list.map(encodeURIComponent));
    }
  }
  return `/${result.join("/")}`;
}
function localizePath(pathname, sourceLocale, targetLocale, pathnames, query, locales) {
  const match = findInternalPath(pathname, sourceLocale, pathnames) ?? findInternalPath(pathname, targetLocale, pathnames) ?? locales?.map((locale) => findInternalPath(pathname, locale, pathnames)).find(Boolean);
  if (!match) return { pathname, consumed: [] };
  const params = { ...match.params };
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== void 0 && value !== null) {
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
function rewriteLocalizedPath(pathname, locale, pathnames) {
  const match = findInternalPath(pathname, locale, pathnames);
  if (!match) return pathname;
  const result = renderTemplate(match.template, match.params);
  return pathname.length > 1 && pathname.endsWith("/") && !result.endsWith("/") ? `${result}/` : result;
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
    if (url.host.toLowerCase() !== entry.domain.toLowerCase() || url.pathname !== "/" || !url.hostname) {
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
export {
  externalTemplate,
  findInternalPath,
  localizePath,
  renderTemplate,
  rewriteLocalizedPath,
  validatePathnames,
  validateRouteEnvironment
};
