import { validateI18nConfig } from "./utils.js";
import { validatePathnames, validateRouteEnvironment } from "./route-engine.js";
function copyAndFreeze(value, copies = /* @__PURE__ */ new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const existing = copies.get(value);
  if (existing) return existing;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(copy)) {
    Object.defineProperty(copy, key, { value: copyAndFreeze(Reflect.get(copy, key), copies) });
  }
  return Object.freeze(copy);
}
function defineRouting(config) {
  const normalized = { ...config };
  if (normalized.localePrefix === void 0) normalized.localePrefix = "always";
  normalized.cookieName ??= "NEXT_LOCALE";
  normalized.headerName ??= "x-next-locale";
  const snapshot = copyAndFreeze(normalized);
  validateI18nConfig(snapshot);
  validatePathnames(snapshot.locales, snapshot.pathnames);
  validateRouteEnvironment(snapshot.locales, snapshot.domains, snapshot.basePath);
  return snapshot;
}
export {
  defineRouting
};
