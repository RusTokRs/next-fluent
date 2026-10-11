import { FluentSerializer, Resource, Visitor } from "@fluent/syntax";
import { junkEntries, parseFtl, unparsableCatalogError } from "./ftl-parse.js";
import { toFluentSource } from "./catalog.js";
class ReferenceCollector extends Visitor {
  terms = /* @__PURE__ */ new Set();
  messages = /* @__PURE__ */ new Set();
  visitTermReference(node) {
    if (node.id?.name) this.terms.add(node.id.name);
    this.genericVisit(node);
  }
  /**
   * Message references (`{ other-message }`) are part of the message's meaning,
   * exactly like term references. Dropping the referenced message leaves a
   * placeable that cannot be resolved, so the pruned catalog renders the key
   * instead of the text.
   */
  visitMessageReference(node) {
    if (node.id?.name) this.messages.add(node.id.name);
    this.genericVisit(node);
  }
}
function referencedEntries(entry) {
  const collector = new ReferenceCollector();
  collector.visit(entry);
  return { terms: collector.terms, messages: collector.messages };
}
function matchesNamespace(id, namespace) {
  return id === namespace || id.startsWith(`${namespace}.`) || id.startsWith(`${namespace}-`);
}
function pickMessages(messages, namespace, options = {}) {
  const source = toFluentSource(messages);
  const combined = typeof source === "string" ? source : source.join("\n");
  if (!namespace) return combined;
  const resource = parseFtl(combined, "The catalog");
  const broken = junkEntries(resource).filter(
    (entry) => entry.id !== void 0 && matchesNamespace(entry.id, namespace)
  );
  if (broken.length > 0) {
    throw unparsableCatalogError(broken, `The "${namespace}" namespace`);
  }
  const messagesById = /* @__PURE__ */ new Map();
  const termsById = /* @__PURE__ */ new Map();
  for (const entry of resource.body) {
    if (entry.type === "Message") messagesById.set(entry.id.name, entry);
    else if (entry.type === "Term") termsById.set(entry.id.name, entry);
  }
  const keptMessageIds = /* @__PURE__ */ new Set();
  const keptTermIds = /* @__PURE__ */ new Set();
  const queue = [];
  for (const entry of resource.body) {
    if (entry.type === "Message" && matchesNamespace(entry.id.name, namespace)) {
      keptMessageIds.add(entry.id.name);
      queue.push(entry);
    }
  }
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
      if (referenced && !keptMessageIds.has(name)) {
        keptMessageIds.add(name);
        queue.push(referenced);
      }
    }
  }
  const output = [];
  for (const entry of resource.body) {
    if (entry.type === "Message" && keptMessageIds.has(entry.id.name)) output.push(entry);
    else if (entry.type === "Term" && keptTermIds.has(entry.id.name)) output.push(entry);
  }
  return new FluentSerializer().serialize(new Resource(output));
}
function listMessageKeys(messages) {
  const source = toFluentSource(messages);
  const combined = typeof source === "string" ? source : source.join("\n");
  const resource = parseFtl(combined, "The catalog");
  const keys = [];
  for (const entry of resource.body) {
    if (entry.type !== "Message") continue;
    if (entry.value) keys.push(entry.id.name);
    for (const attr of entry.attributes) keys.push(`${entry.id.name}.${attr.id.name}`);
  }
  return keys;
}
export {
  listMessageKeys,
  pickMessages
};
