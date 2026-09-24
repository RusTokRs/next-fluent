// src/pseudo.ts
import { parse, serialize, Visitor } from "@fluent/syntax";
var CHAR_MAP = {
  a: "\xE5",
  b: "\u0180",
  c: "\xE7",
  d: "\xF0",
  e: "\xE9",
  f: "\u0192",
  g: "\u011D",
  h: "\u0125",
  i: "\xEE",
  j: "\u0135",
  k: "\u045C",
  l: "\u013C",
  m: "\u0271",
  n: "\xF1",
  o: "\xF6",
  p: "\xFE",
  q: "q",
  r: "\u0155",
  s: "\u0161",
  t: "\u0163",
  u: "\xFB",
  v: "\u1E7D",
  w: "\u0175",
  x: "\u04B3",
  y: "\xFD",
  z: "\u017E",
  A: "\xC5",
  B: "\u0181",
  C: "\xC7",
  D: "\xD0",
  E: "\xC9",
  F: "\u0191",
  G: "\u011C",
  H: "\u0124",
  I: "\xCE",
  J: "\u0134",
  K: "\u040C",
  L: "\u013B",
  M: "\u1E40",
  N: "\xD1",
  O: "\xD6",
  P: "\xDE",
  Q: "Q",
  R: "\u0154",
  S: "\u0160",
  T: "\u0162",
  U: "\xDB",
  V: "\u1E7C",
  W: "\u0174",
  X: "\u04B2",
  Y: "\xDD",
  Z: "\u017D"
};
function pseudoLocalizeText(text, options = {}) {
  if (!text) return "";
  const prefix = options.prefix ?? "[";
  const suffix = options.suffix ?? "]";
  const elongate = options.elongate ?? true;
  const tokenRegex = /(\{[^}]*\}|<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>)/g;
  const parts = text.split(tokenRegex);
  const transformedParts = parts.map((part) => {
    if (part.startsWith("{") && part.endsWith("}")) {
      return part;
    }
    if (part.startsWith("<") && part.endsWith(">")) {
      return part;
    }
    let res = "";
    for (const ch of part) {
      const mapped = CHAR_MAP[ch] || ch;
      res += mapped;
      if (elongate && "aeiouAEIOU".includes(ch)) {
        res += mapped;
      }
    }
    return res;
  });
  return `${prefix}${transformedParts.join("")}${suffix}`;
}
function pseudoLocalizeFtl(ftlContent, options = {}) {
  const resource = parse(ftlContent, { withSpans: false });
  class PseudoVisitor extends Visitor {
    visitTextElement(node) {
      if (node.value.trim()) node.value = pseudoLocalizeText(node.value, options);
    }
  }
  new PseudoVisitor().visit(resource);
  return serialize(resource, {});
}
export {
  pseudoLocalizeFtl,
  pseudoLocalizeText
};
