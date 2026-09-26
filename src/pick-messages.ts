import { parse, FluentSerializer, Resource, Visitor, type Message, type TermReference } from '@fluent/syntax';
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

class TermCollector extends Visitor {
  terms = new Set<string>();

  visitTermReference(node: TermReference): void {
    if (node.id?.name) this.terms.add(node.id.name);
    this.genericVisit(node);
  }
}

function referencedTerms(entry: Message): Set<string> {
  const collector = new TermCollector();
  collector.visit(entry);
  return collector.terms;
}

function matchesNamespace(id: string, namespace: string): boolean {
  return id === namespace || id.startsWith(`${namespace}.`) || id.startsWith(`${namespace}-`);
}

export interface PickMessagesOptions {
  /** Keep messages outside the namespace that the namespace's terms reference. */
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

  const resource = parse(combined, { withSpans: false });
  const kept = resource.body.filter(
    (entry): entry is Message => entry.type === 'Message' && matchesNamespace(entry.id.name, namespace)
  );

  if (options.keepTerms !== false) {
    const wanted = new Set<string>();
    for (const entry of kept) {
      for (const term of referencedTerms(entry)) wanted.add(term);
    }
    if (wanted.size > 0) {
      // Terms can reference other terms, so walk until the set is stable.
      const terms = resource.body.filter((entry) => entry.type === 'Term');
      let grew = true;
      while (grew) {
        grew = false;
        for (const term of terms) {
          if (!wanted.has(term.id.name)) continue;
          for (const nested of referencedTerms(term as unknown as Message)) {
            if (!wanted.has(nested)) {
              wanted.add(nested);
              grew = true;
            }
          }
        }
      }
      kept.push(...(terms.filter((term) => wanted.has(term.id.name)) as unknown as Message[]));
    }
  }

  return new FluentSerializer().serialize(new Resource(kept));
}

/** Message ids present in a catalog — useful for tests and the `check` CLI. */
export function listMessageKeys(messages: MessageSource): string[] {
  const source = toFluentSource(messages);
  const combined = typeof source === 'string' ? source : source.join('\n');
  const resource = parse(combined, { withSpans: false });
  const keys: string[] = [];
  for (const entry of resource.body) {
    if (entry.type !== 'Message') continue;
    if (entry.value) keys.push(entry.id.name);
    for (const attr of entry.attributes) keys.push(`${entry.id.name}.${attr.id.name}`);
  }
  return keys;
}
