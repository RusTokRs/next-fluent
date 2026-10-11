import { FluentSerializer, Resource, Visitor, type Message, type MessageReference, type Term, type TermReference } from '@fluent/syntax';
import { junkEntries, parseFtl, unparsableCatalogError } from './ftl-parse';
import { toFluentSource, type MessageSource } from './catalog';

/**
 * Catalog pruning for client payloads.
 *
 * A Client Component only needs the messages it renders, yet `FluentProvider`
 * receives whatever the server passes down. `pickMessages` reduces a catalog to
 * one namespace (and the shared terms it references) so the serialized payload
 * stays proportional to the page, not to the app.
 *
 * ```tsx
 * <FluentProvider
 *   locale={locale}
 *   messages={pickMessages(await loadCatalog(locale), 'checkout')}
 * />
 * ```
 */

class ReferenceCollector extends Visitor {
  terms = new Set<string>();
  messages = new Set<string>();

  visitTermReference(node: TermReference): void {
    if (node.id?.name) this.terms.add(node.id.name);
    this.genericVisit(node);
  }

  /**
   * Message references (`{ other-message }`) are part of the message's meaning,
   * exactly like term references. Dropping the referenced message leaves a
   * placeable that cannot be resolved, so the pruned catalog renders the key
   * instead of the text.
   */
  visitMessageReference(node: MessageReference): void {
    if (node.id?.name) this.messages.add(node.id.name);
    this.genericVisit(node);
  }
}

function referencedEntries(entry: Message | Term): { terms: Set<string>; messages: Set<string> } {
  const collector = new ReferenceCollector();
  collector.visit(entry);
  return { terms: collector.terms, messages: collector.messages };
}

function matchesNamespace(id: string, namespace: string): boolean {
  return id === namespace || id.startsWith(`${namespace}.`) || id.startsWith(`${namespace}-`);
}

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
export function pickMessages(
  messages: MessageSource,
  namespace?: string,
  options: PickMessagesOptions = {}
): string {
  const source = toFluentSource(messages);
  const combined = typeof source === 'string' ? source : source.join('\n');
  if (!namespace) return combined;

  const resource = parseFtl(combined, 'The catalog');

  // An unreadable entry inside the namespace would disappear from the pruned
  // payload without a trace. Entries of *other* namespaces are pruned by
  // design, so only the namespace's own junk is an error.
  const broken = junkEntries(resource).filter(
    (entry) => entry.id !== undefined && matchesNamespace(entry.id, namespace)
  );
  if (broken.length > 0) {
    throw unparsableCatalogError(broken, `The "${namespace}" namespace`);
  }

  const messagesById = new Map<string, Message>();
  const termsById = new Map<string, Term>();
  for (const entry of resource.body) {
    if (entry.type === 'Message') messagesById.set(entry.id.name, entry);
    else if (entry.type === 'Term') termsById.set(entry.id.name, entry);
  }

  const keptMessageIds = new Set<string>();
  const keptTermIds = new Set<string>();
  const queue: (Message | Term)[] = [];
  for (const entry of resource.body) {
    if (entry.type === 'Message' && matchesNamespace(entry.id.name, namespace)) {
      keptMessageIds.add(entry.id.name);
      queue.push(entry);
    }
  }

  // Follow references transitively. A kept message may rely on another message
  // or on a shared term (`-brand`), and those may reference further entries —
  // dropping any of them leaves a placeable that cannot be resolved, so the
  // pruned catalog renders keys instead of text.
  for (let index = 0; index < queue.length; index++) {
    const { terms, messages: referencedMessages } = referencedEntries(queue[index]);
    if (options.keepTerms !== false) {
      for (const name of terms) {
        const term = termsById.get(name);
        if (term && !keptTermIds.has(name)) {
          keptTermIds.add(name);
          queue.push(term);
        }
      }
    }
    for (const name of referencedMessages) {
      const referenced = messagesById.get(name);
      // A self-reference (`msg = { msg }`) must not queue the same entry twice.
      if (referenced && !keptMessageIds.has(name)) {
        keptMessageIds.add(name);
        queue.push(referenced);
      }
    }
  }

  // Source order is preserved for both kinds, so the output stays diffable
  // against the catalog it was pruned from.
  const output: (Message | Term)[] = [];
  for (const entry of resource.body) {
    if (entry.type === 'Message' && keptMessageIds.has(entry.id.name)) output.push(entry);
    else if (entry.type === 'Term' && keptTermIds.has(entry.id.name)) output.push(entry);
  }

  return new FluentSerializer().serialize(new Resource(output));
}

/** Message ids present in a catalog — useful for tests and the `check` CLI. */
export function listMessageKeys(messages: MessageSource): string[] {
  const source = toFluentSource(messages);
  const combined = typeof source === 'string' ? source : source.join('\n');
  const resource = parseFtl(combined, 'The catalog');
  const keys: string[] = [];
  for (const entry of resource.body) {
    if (entry.type !== 'Message') continue;
    if (entry.value) keys.push(entry.id.name);
    for (const attr of entry.attributes) keys.push(`${entry.id.name}.${attr.id.name}`);
  }
  return keys;
}
