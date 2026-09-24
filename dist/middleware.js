// src/utils.ts
var MAX_LOCALE_TAG_LENGTH = 64;
var HTTP_QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
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
function resolveAcceptLanguage(header, locales) {
  if (!header) return void 0;
  let bestLocale;
  let bestQuality = Number.NEGATIVE_INFINITY;
  let entryStart = 0;
  while (entryStart <= header.length) {
    const separator = header.indexOf(",", entryStart);
    const entryEnd = separator === -1 ? header.length : separator;
    const candidate = parseAcceptLanguageEntry(header.slice(entryStart, entryEnd));
    if (candidate && candidate.quality > bestQuality) {
      const matched = candidate.tag === "*" ? locales[0] : matchSupportedLocale(candidate.tag, locales);
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

// src/middleware.ts
function createI18nMiddleware(options) {
  validateI18nConfig(options);
  const {
    locales,
    defaultLocale: rawDefaultLocale,
    localePrefix = "always",
    cookieName = "NEXT_LOCALE",
    headerName = "x-next-locale"
  } = options;
  const defaultLocale = matchSupportedLocale(rawDefaultLocale, locales) ?? rawDefaultLocale;
  return async function middleware(request) {
    let NextResponse;
    try {
      const nextServer = await import("next/server.js").catch(() => import("next/server"));
      NextResponse = nextServer.NextResponse;
    } catch {
      NextResponse = class MockNextResponse {
        static next(opts) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            request: { headers: reqHeaders },
            cookies: {
              set: (name, val) => headers.append("Set-Cookie", `${name}=${val}; Path=/`)
            }
          };
        }
        static rewrite(url, opts) {
          const headers = new Headers();
          const reqHeaders = opts?.request?.headers ?? new Headers();
          return {
            status: 200,
            headers,
            rewriteUrl: String(url),
            request: { headers: reqHeaders },
            cookies: {
              set: (name, val) => headers.append("Set-Cookie", `${name}=${val}; Path=/`)
            }
          };
        }
        static redirect(url) {
          const headers = new Headers();
          headers.set("location", String(url));
          return {
            status: 307,
            headers,
            cookies: {
              set: (name, val) => headers.append("Set-Cookie", `${name}=${val}; Path=/`)
            }
          };
        }
      };
    }
    const { pathname, search } = request.nextUrl;
    const segments = pathname.split("/").filter(Boolean);
    const firstSegment = segments[0];
    const matchedPrefix = matchSupportedLocale(firstSegment, locales);
    const cookieLocale = matchSupportedLocale(
      request.cookies.get(cookieName)?.value || (cookieName !== "NEXT_LOCALE" ? request.cookies.get("NEXT_LOCALE")?.value : void 0),
      locales
    );
    const headerLocale = resolveAcceptLanguage(
      request.headers.get("accept-language"),
      locales
    );
    const preferredLocale = cookieLocale || headerLocale || defaultLocale;
    const createSuccessResponse = (effectiveLocale, rewritePath) => {
      const requestHeaders = new Headers();
      if (request.headers) {
        if (typeof request.headers.forEach === "function") {
          request.headers.forEach((val, key) => requestHeaders.set(key, val));
        } else if (typeof request.headers.entries === "function") {
          for (const [key, val] of request.headers.entries()) {
            requestHeaders.set(key, val);
          }
        }
      }
      requestHeaders.set(headerName, effectiveLocale);
      const response = rewritePath ? NextResponse.rewrite(new URL(rewritePath, request.url), {
        request: { headers: requestHeaders }
      }) : NextResponse.next({
        request: { headers: requestHeaders }
      });
      if (!response.request) {
        response.request = { headers: requestHeaders };
      }
      if (response.headers?.set) {
        response.headers.set(headerName, effectiveLocale);
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, effectiveLocale, {
          path: "/",
          maxAge: 31536e3,
          sameSite: "lax"
        });
      }
      return response;
    };
    const createRedirect = (targetUrl, targetLocale) => {
      const response = NextResponse.redirect(targetUrl);
      if (response.headers?.set) {
        response.headers.set(headerName, targetLocale);
      }
      if (response.cookies?.set) {
        response.cookies.set(cookieName, targetLocale, {
          path: "/",
          maxAge: 31536e3,
          sameSite: "lax"
        });
      }
      return response;
    };
    if (localePrefix === "never") {
      if (matchedPrefix) {
        const remainingPath = `/${segments.slice(1).join("/")}${search}`;
        return createRedirect(new URL(remainingPath, request.url), matchedPrefix);
      }
      const rewritePath = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
      return createSuccessResponse(preferredLocale, rewritePath);
    }
    if (localePrefix === "as-needed") {
      if (matchedPrefix === defaultLocale) {
        const remainingPath = `/${segments.slice(1).join("/")}${search}`;
        return createRedirect(new URL(remainingPath, request.url), defaultLocale);
      }
      if (matchedPrefix) {
        return createSuccessResponse(matchedPrefix);
      }
      if (preferredLocale === defaultLocale) {
        const rewritePath = `/${defaultLocale}${pathname === "/" ? "" : pathname}${search}`;
        return createSuccessResponse(defaultLocale, rewritePath);
      }
      const targetPath2 = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
      return createRedirect(new URL(targetPath2, request.url), preferredLocale);
    }
    if (matchedPrefix) {
      return createSuccessResponse(matchedPrefix);
    }
    const targetPath = `/${preferredLocale}${pathname === "/" ? "" : pathname}${search}`;
    return createRedirect(new URL(targetPath, request.url), preferredLocale);
  };
}
var createMiddleware = createI18nMiddleware;
export {
  createI18nMiddleware,
  createMiddleware
};
