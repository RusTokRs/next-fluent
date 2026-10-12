import { cache } from "react";
const getRequestStore = cache(() => ({
  bundles: /* @__PURE__ */ new Map()
}));
function isRequestScopeActive() {
  return getRequestStore() === getRequestStore();
}
function requestLocale() {
  return getRequestStore().locale;
}
export {
  getRequestStore,
  isRequestScopeActive,
  requestLocale
};
