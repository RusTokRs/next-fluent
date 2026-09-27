import { FluentSerializer, Resource, Visitor } from "@fluent/syntax";
import { parseFtl } from "./ftl-parse.js";
import { toFluentSource } from "./catalog.js";
class TermCollector extends Visitor {
  terms = /* @__PURE__ */ new Set();
  visitTermReference(node) {
    if (node.id?.name) this.terms.add(node.id.name);
    this.genericVisit(node);
  }
}
function referencedTerms(entry) {
  const collector = new TermCollector();
  collector.visit(entry);
  return collector.terms;
}
function matchesNamespace(id, namespace) {
  return id === namespace || id.startsWith(`${namespace}.`) || id.startsWith(`${namespace}-`);
}
function pickMessages(messages, namespace, options = {}) {
  const source = toFluentSource(messages);
  const combined = typeof source === "string" ? source : source.join("\n");
  if (!namespace) return combined;
  const resource = parseFtl(combined, "The catalog");
  const kept = resource.body.filter(
    (entry) => entry.type === "Message" && matchesNamespace(entry.id.name, namespace)
  );
  if (options.keepTerms !== false) {
    const wanted = /* @__PURE__ */ new Set();
    for (const entry of kept) {
      for (const term of referencedTerms(entry)) wanted.add(term);
    }
    if (wanted.size > 0) {
      const terms = resource.body.filter((entry) => entry.type === "Term");
      let grew = true;
      while (grew) {
        grew = false;
        for (const term of terms) {
          if (!wanted.has(term.id.name)) continue;
          for (const nested of referencedTerms(term)) {
            if (!wanted.has(nested)) {
              wanted.add(nested);
              grew = true;
            }
          }
        }
      }
      kept.push(...terms.filter((term) => wanted.has(term.id.name)));
    }
  }
  return new FluentSerializer().serialize(new Resource(kept));
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
