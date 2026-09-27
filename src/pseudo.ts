/**
 * Pseudo-localization engine for layout overflow and truncation testing.
 */
import {
  serialize,
  Visitor,
  TextElement,
  type Pattern,
} from '@fluent/syntax';
import { parseFtl } from './ftl-parse';

const CHAR_MAP: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î',
  j: 'ĵ', k: 'ќ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'q', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ҳ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î',
  J: 'Ĵ', K: 'Ќ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Q', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ҳ', Y: 'Ý', Z: 'Ž',
};

export interface PseudoOptions {
  /** Prefix added to each localized message. Default: `[` */
  prefix?: string;
  /** Suffix added to each localized message. Default: `]` */
  suffix?: string;
  /** Elongate strings by duplicating vowels to simulate text expansion. Default: true */
  elongate?: boolean;
}

/**
 * Transforms a text chunk into pseudo-localized text while preserving
 * variables ({ $var }), Fluent functions ({ NUMBER(...) }), and HTML tags (<tag>).
 */
export function pseudoLocalizeText(text: string, options: PseudoOptions = {}): string {
  if (!text) return '';

  const prefix = options.prefix ?? '[';
  const suffix = options.suffix ?? ']';
  const elongate = options.elongate ?? true;

  const transformedParts = splitPreservedTokens(text).map((part) => {
    // Fluent expressions and HTML tags are structure, not copy — keep them intact.
    if (part.kind !== 'text') {
      return part.value;
    }

    let res = '';
    for (const ch of part.value) {
      const mapped = CHAR_MAP[ch] || ch;
      res += mapped;
      // Elongate vowels if requested
      if (elongate && 'aeiouAEIOU'.includes(ch)) {
        res += mapped;
      }
    }
    return res;
  });

  return `${prefix}${transformedParts.join('')}${suffix}`;
}

type PreservedToken = { kind: 'text' | 'expr' | 'tag'; value: string };

/**
 * Splits text into translatable runs and the tokens that must survive
 * untouched: Fluent placeables and HTML tags.
 *
 * A flat `\{[^}]*\}` pattern breaks on nested placeables — `{ $count ->
 * [one] { NUMBER($count) } }` — because it stops at the first `}` and the rest
 * of the selector gets pseudo-localized. Brace depth (and Fluent string
 * literals) are tracked instead.
 */
export function splitPreservedTokens(text: string): PreservedToken[] {
  const tokens: PreservedToken[] = [];
  let buffer = '';
  let index = 0;

  const flush = () => {
    if (buffer !== '') {
      tokens.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  };

  while (index < text.length) {
    const ch = text[index];

    if (ch === '{') {
      let depth = 0;
      let cursor = index;
      let inString = false;
      while (cursor < text.length) {
        const current = text[cursor];
        if (inString) {
          if (current === '\\') cursor++;
          else if (current === '"') inString = false;
        } else if (current === '"') {
          inString = true;
        } else if (current === '{') {
          depth++;
        } else if (current === '}') {
          depth--;
          if (depth === 0) {
            cursor++;
            break;
          }
        }
        cursor++;
      }
      // Unbalanced braces are plain text, not a placeable.
      if (depth !== 0) {
        buffer += ch;
        index++;
        continue;
      }
      flush();
      tokens.push({ kind: 'expr', value: text.slice(index, cursor) });
      index = cursor;
      continue;
    }

    if (ch === '<') {
      const tag = /^<\/?[a-zA-Z][a-zA-Z0-9_-]*(?:\s[^<>]*)?\/?>/.exec(text.slice(index));
      if (tag) {
        flush();
        tokens.push({ kind: 'tag', value: tag[0] });
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

/**
 * Wraps a pattern in the pseudo prefix/suffix at its true edges — before the
 * first element and after the last one — so rendered output reads `[Hello { $name }!]`
 * rather than `[Hello ]{ $name }[!]`. Patterns without translatable text
 * (e.g. a bare select expression) are left unwrapped.
 */
function wrapPatternEdges(pattern: Pattern, options: PseudoOptions): void {
  const prefix = options.prefix ?? '[';
  const suffix = options.suffix ?? ']';
  const hasText = pattern.elements.some(
    (el) => el.type === 'TextElement' && (el as TextElement).value.trim()
  );
  if (!hasText) return;

  const first = pattern.elements[0];
  if (first && first.type === 'TextElement') {
    (first as TextElement).value = prefix + (first as TextElement).value;
  } else {
    pattern.elements.unshift(new TextElement(prefix));
  }

  const last = pattern.elements[pattern.elements.length - 1];
  if (last && last.type === 'TextElement') {
    (last as TextElement).value = (last as TextElement).value + suffix;
  } else {
    pattern.elements.push(new TextElement(suffix));
  }
}

/**
 * Transforms an entire FTL file content into pseudo-localized FTL.
 * Preserves message IDs, attributes, selectors, and comments. The pseudo
 * prefix/suffix wraps each message (and each select variant) as a whole.
 */
export function pseudoLocalizeFtl(ftlContent: string, options: PseudoOptions = {}): string {
  const resource = parseFtl(ftlContent, 'The catalog');
  const textOptions: PseudoOptions = { ...options, prefix: '', suffix: '' };
  class PseudoVisitor extends Visitor {
    visitTextElement(node: TextElement): void {
      if (node.value.trim()) node.value = pseudoLocalizeText(node.value, textOptions);
    }

    visitPattern(node: Pattern): void {
      // Localize nested text first (including select variants), then bracket
      // this pattern as a whole.
      this.genericVisit(node);
      wrapPatternEdges(node, options);
    }
  }
  new PseudoVisitor().visit(resource);
  return serialize(resource, {});
}
