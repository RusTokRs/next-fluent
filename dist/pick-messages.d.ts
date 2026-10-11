import { type MessageSource } from './catalog';
export interface PickMessagesOptions {
    /**
     * Keep the shared terms (`-brand`) the namespace references. Defaults to
     * `true`; message references (`{ other-message }`) are always kept, because a
     * message without them cannot be formatted at all.
     */
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
