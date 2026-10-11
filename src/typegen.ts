import { Visitor, type Message, type VariableReference } from '@fluent/syntax';
import { junkEntries, parseFtl, unparsableCatalogError } from './ftl-parse';
import { toFluentSource, type MessageSource } from './catalog';
import { withKebabKey } from './utils';

/**
 * FTL AST Key & Variable Extractor for TypeScript declaration generation.
 */

export interface ExtractedMessage {
  id: string;
  dotId: string;
  hasValue: boolean;
  attributes: string[];
  variables: string[];
  valueVariables: string[];
  attributeVariables: Record<string, string[]>;
}

class VariableExtractor extends Visitor {
  public variables = new Set<string>();

  visitVariableReference(node: VariableReference): void {
    if (node.id?.name) {
      this.variables.add(node.id.name);
    }
    this.genericVisit(node);
  }
}

export function extractMessagesFromFtl(ftlContent: MessageSource): ExtractedMessage[] {
  const source = toFluentSource(ftlContent);
  const resource = parseFtl(typeof source === 'string' ? source : source.join('\n'), 'The catalog');
  // Skipping the parser's `Junk` entries would emit declarations that are
  // silently missing the unreadable message, and the call sites would then fail
  // with "not a known key" instead of pointing at the broken catalog.
  const broken = junkEntries(resource);
  if (broken.length > 0) {
    throw unparsableCatalogError(broken, 'The catalog');
  }
  const messages: ExtractedMessage[] = [];

  for (const entry of resource.body) {
    if (entry.type === 'Message') {
      const msg = entry as Message;
      const id = msg.id.name;
      const dotId = id.replace(/-/g, '.');

      const extractor = new VariableExtractor();
      extractor.visit(msg);
      const valueExtractor = new VariableExtractor();
      if (msg.value) valueExtractor.visit(msg.value);

      const attributes: string[] = [];
      const attributeVariables: Record<string, string[]> = {};
      if (msg.attributes) {
        for (const attr of msg.attributes) {
          attributes.push(attr.id.name);
          const attrExtractor = new VariableExtractor();
          attrExtractor.visit(attr.value);
          attributeVariables[attr.id.name] = Array.from(attrExtractor.variables).sort();
        }
      }

      messages.push({
        id,
        dotId,
        hasValue: Boolean(msg.value),
        attributes,
        variables: Array.from(extractor.variables).sort(),
        valueVariables: Array.from(valueExtractor.variables).sort(),
        attributeVariables,
      });
    }
  }

  return messages;
}

export function generateTypeDeclarations(
  ftlContents: MessageSource | readonly MessageSource[]
): string {
  const contents = (Array.isArray(ftlContents)
    ? (ftlContents as readonly MessageSource[])
    : [ftlContents as MessageSource]) as readonly MessageSource[];
  const allMessages: ExtractedMessage[] = [];
  const seenIds = new Set<string>();

  for (const content of contents) {
    const extracted = extractMessagesFromFtl(content);
    for (const msg of extracted) {
      if (seenIds.has(msg.id)) {
        // Last definition wins, matching runtime allowOverrides semantics
        const idx = allMessages.findIndex((m) => m.id === msg.id);
        if (idx !== -1) {
          allMessages[idx] = msg;
        }
      } else {
        seenIds.add(msg.id);
        allMessages.push(msg);
      }
    }
  }

  allMessages.sort((a, b) => a.id.localeCompare(b.id));

  /** Message ids that `t(id)` can format, mapped to their value's variables. */
  const valueById = new Map<string, string[]>();
  /** Message ids mapped to their attributes, for the `id.attr` key space. */
  const attributesById = new Map<string, Map<string, string[]>>();

  for (const m of allMessages) {
    if (m.hasValue) valueById.set(m.id, m.valueVariables);
    const attributes = new Map<string, string[]>();
    for (const attr of m.attributes) attributes.set(attr, m.attributeVariables[attr] ?? []);
    attributesById.set(m.id, attributes);
  }

  /**
   * Mirrors the runtime's key resolution for a bare (namespace-less) key:
   * candidates are the kebab spelling and the key itself, and each candidate is
   * tried first as a message id, then as an `id.attr` path. `typegen` has to
   * declare the winner's arguments: emitting the arguments of the entry the key
   * is *spelled* after sends callers down a path the runtime does not take.
   *
   * The case that matters is `greeting` (attribute `.formal`) next to a message
   * named `greeting-formal`: `t('greeting.formal')` formats the message, so the
   * key must carry that message's variables.
   */
  const resolveKey = (key: string): { variables: string[]; winner: string } | undefined => {
    const candidates = withKebabKey(key) === key ? [key] : [withKebabKey(key), key];
    for (const candidate of candidates) {
      const value = valueById.get(candidate);
      if (value) return { variables: value, winner: candidate };

      const lastDot = candidate.lastIndexOf('.');
      if (lastDot === -1) continue;
      const owner = candidate.slice(0, lastDot);
      const attribute = candidate.slice(lastDot + 1);
      const attributes =
        attributesById.get(owner) ?? attributesById.get(withKebabKey(owner));
      const variables = attributes?.get(attribute) ?? attributes?.get(withKebabKey(attribute));
      if (variables) return { variables, winner: candidate };
    }
    return undefined;
  };

  const allKeyEntries: { key: string; variables: string[] }[] = [];
  const seenKeys = new Set<string>();
  /** Attributes a message of another id shadows, reported as a comment below. */
  const shadowedAttributes: { key: string; messageId: string; owner: string; attribute: string }[] = [];

  const addKeyEntry = (key: string, declaredVariables: string[]) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const resolved = resolveKey(key);
    allKeyEntries.push({ key, variables: resolved?.variables ?? declaredVariables });
  };

  for (const m of allMessages) {
    // Only messages with a value are addressable by their bare id at runtime;
    // attribute-only messages expose `id.attr` keys exclusively.
    if (m.hasValue) {
      addKeyEntry(m.id, m.valueVariables);
      if (m.dotId !== m.id) {
        addKeyEntry(m.dotId, m.valueVariables);
      }
    }
    if (m.attributes) {
      for (const attr of m.attributes) {
        const variables = m.attributeVariables[attr] ?? [];
        for (const spelling of m.dotId === m.id ? [m.id] : [m.id, m.dotId]) {
          const key = `${spelling}.${attr}`;
          addKeyEntry(key, variables);
          // A message whose id equals the kebab spelling takes the key over.
          const shadowing = valueById.has(withKebabKey(key));
          if (shadowing) {
            shadowedAttributes.push({ key, messageId: withKebabKey(key), owner: m.id, attribute: attr });
          }
        }
      }
    }
  }

  const keyUnion = allKeyEntries.map((e) => `  | '${e.key}'`).join('\n');

  const argsEntries = allKeyEntries.map((e) => {
    if (e.variables.length === 0) {
      return `  '${e.key}'?: Record<string, never>;`;
    }
    const varsType = e.variables
      .map((v) => `'${v}': string | number | Date`)
      .join('; ');
    return `  '${e.key}': { ${varsType} };`;
  });

  // Unique per attribute: both spellings of an attribute produce one note.
  const seenShadowNotes = new Set<string>();
  const shadowNotes = shadowedAttributes
    .filter((entry) => {
      const id = `${entry.owner}.${entry.attribute}`;
      if (seenShadowNotes.has(id)) return false;
      seenShadowNotes.add(id);
      return true;
    })
    .map(
      (entry) =>
        `//   '${entry.key}' resolves to the message "${entry.messageId}" — Fluent resolves the\n` +
        `//   dashed id first. The attribute is reachable only via t.attrs('${entry.owner}').${entry.attribute}.`
    );

  const shadowBlock =
    shadowNotes.length > 0
      ? `// Shadowed attributes (the runtime formats the message, not the attribute):\n` +
        `${shadowNotes.join('\n')}\n\n`
      : '';

  return `// Auto-generated by next-fluent typegen. DO NOT EDIT DIRECTLY.
/* eslint-disable */

${shadowBlock}export type AppMessageKey =
${keyUnion || '  | string'};

export interface AppMessageArgs {
${argsEntries.join('\n')}
}

export interface AppMessages {
${allKeyEntries
  .map((e) => {
    const varsType =
      e.variables.length === 0
        ? 'Record<string, never>'
        : `{ ${e.variables.map((v) => `'${v}': string | number | Date`).join('; ')} }`;
    return `  '${e.key}': ${varsType};`;
  })
  .join('\n')}
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FluentMessages extends AppMessages {}
}
`;
}
