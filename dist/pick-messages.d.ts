import { type MessageSource } from './catalog';
export interface PickMessagesOptions {
    /** Keep messages outside the namespace that the namespace's terms reference. */
    keepTerms?: boolean;
}
/**
 * Returns the FTL source for `namespace` only. Without a namespace the source
 * is returned unchanged (arrays are joined), so call sites can pass it
 * unconditionally.
 */
export declare function pickMessages(messages: MessageSource, namespace?: string, options?: PickMessagesOptions): string;
/** Message ids present in a catalog — useful for tests and the `check` CLI. */
export declare function listMessageKeys(messages: MessageSource): string[];
