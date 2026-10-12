import type { FluentBundle } from '@fluent/bundle';
import type { Formats, GetMessageFallbackFn, OnErrorFn, RichTranslationValues } from './types';
/**
 * Per-request state shared by the server runtime and the navigation helpers.
 *
 * Lives in its own module — rather than staying inside `server.ts` — because
 * `navigation.ts` needs the request locale and is imported by Client
 * Components: pulling `server.ts` in would drag `@fluent/bundle`, the formatter
 * and the whole catalog funnel into the browser bundle to read one field.
 *
 * The runtime import here is `cache` from `react` and nothing else, so the
 * client and edge builds pay for a single function reference.
 */
export interface RequestStore {
    locale?: string;
    timeZone?: string;
    now?: Date;
    defaultTranslationValues?: RichTranslationValues;
    formats?: Formats;
    useIsolating?: boolean;
    onError?: OnErrorFn;
    getMessageFallback?: GetMessageFallbackFn;
    strictNamespace?: boolean;
    bundles: Map<string, FluentBundle>;
}
export declare const getRequestStore: () => RequestStore;
/**
 * True when React is memoizing per-request state, i.e. the call happens inside
 * a render/request scope. Outside one, `cache()` hands back a fresh object per
 * call, so a stored locale would vanish immediately.
 */
export declare function isRequestScopeActive(): boolean;
/**
 * The locale of the current request, when one has been established.
 *
 * Deliberately narrow: it reads only what `setRequestLocale` stored, and never
 * falls back to detection. Detection needs the request headers and is
 * asynchronous, while the navigation helpers that call this are not. Outside a
 * request scope — a Client Component build, a script, a unit test — `cache()`
 * memoizes nothing and this returns `undefined`, which callers treat as "no
 * locale known" exactly as they did before this existed.
 */
export declare function requestLocale(): string | undefined;
