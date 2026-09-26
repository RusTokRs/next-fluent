import {
  parse,
  serialize,
  Visitor,
  TextElement
} from "@fluent/syntax";
const CHAR_MAP = {
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
  const transformedParts = splitPreservedTokens(text).map((part) => {
    if (part.kind !== "text") {
      return part.value;
    }
    let res = "";
    for (const ch of part.value) {
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
function splitPreservedTokens(text) {
  const tokens = [];
  let buffer = "";
  let index = 0;
  const flush = () => {
    if (buffer !== "") {
      tokens.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };
  while (index < text.length) {
    const ch = text[index];
    if (ch === "{") {
      let depth = 0;
      let cursor = index;
      let inString = false;
      while (cursor < text.length) {
        const current = text[cursor];
        if (inString) {
          if (current === "\\") cursor++;
          else if (current === '"') inString = false;
        } else if (current === '"') {
          inString = true;
        } else if (current === "{") {
          depth++;
        } else if (current === "}") {
          depth--;
          if (depth === 0) {
            cursor++;
            break;
          }
        }
        cursor++;
      }
      if (depth !== 0) {
        buffer += ch;
        index++;
        continue;
      }
      flush();
      tokens.push({ kind: "expr", value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }
    if (ch === "<") {
      const tag = /^<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^<>]*)?\/?>/.exec(text.slice(index));
      if (tag) {
        flush();
        tokens.push({ kind: "tag", value: tag[0] });
        index += tag[0].length;
        continue;
      }
    }
    buffer += ch;
    index++;
  }
  flush();
  return tokens;
}
function wrapPatternEdges(pattern, options) {
  const prefix = options.prefix ?? "[";
  const suffix = options.suffix ?? "]";
  const hasText = pattern.elements.some(
    (el) => el.type === "TextElement" && el.value.trim()
  );
  if (!hasText) return;
  const first = pattern.elements[0];
  if (first && first.type === "TextElement") {
    first.value = prefix + first.value;
  } else {
    pattern.elements.unshift(new TextElement(prefix));
  }
  const last = pattern.elements[pattern.elements.length - 1];
  if (last && last.type === "TextElement") {
    last.value = last.value + suffix;
  } else {
    pattern.elements.push(new TextElement(suffix));
  }
}
function pseudoLocalizeFtl(ftlContent, options = {}) {
  const resource = parse(ftlContent, { withSpans: false });
  const textOptions = { ...options, prefix: "", suffix: "" };
  class PseudoVisitor extends Visitor {
    visitTextElement(node) {
      if (node.value.trim()) node.value = pseudoLocalizeText(node.value, textOptions);
    }
    visitPattern(node) {
      this.genericVisit(node);
      wrapPatternEdges(node, options);
    }
  }
  new PseudoVisitor().visit(resource);
  return serialize(resource, {});
}
export {
  pseudoLocalizeFtl,
  pseudoLocalizeText,
  splitPreservedTokens
};
