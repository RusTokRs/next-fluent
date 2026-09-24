/**
 * Pseudo-localization engine for layout overflow and truncation testing.
 */
import { parse, serialize, Visitor, type TextElement } from '@fluent/syntax';

const CHAR_MAP: Record<string, string> = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î',
  j: 'ĵ', k: 'ќ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'q', r: 'ŕ',
  s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ҳ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î',
  J: 'Ĵ', K: 'Ќ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Q', R: 'Ŕ',
  S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ҳ', Y: 'Ý', Z: 'Ž',
};

export interface PseudoOptions {
  /** Prefix added to localized string. Default: `[` */
  prefix?: string;
  /** Suffix added to localized string. Default: `]` */
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

  // Split by Fluent expressions {...} and HTML tags <...>
  const tokenRegex = /(\{[^}]*\}|<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>)/g;
  const parts = text.split(tokenRegex);

  const transformedParts = parts.map((part) => {
    // If it's a variable/expression or HTML tag, preserve as-is
    if (part.startsWith('{') && part.endsWith('}')) {
      return part;
    }
    if (part.startsWith('<') && part.endsWith('>')) {
      return part;
    }

    let res = '';
    for (const ch of part) {
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

/**
 * Transforms an entire FTL file content into pseudo-localized FTL.
 * Preserves message IDs, attributes, selectors, and comments.
 */
export function pseudoLocalizeFtl(ftlContent: string, options: PseudoOptions = {}): string {
  const resource = parse(ftlContent, { withSpans: false });
  class PseudoVisitor extends Visitor {
    visitTextElement(node: TextElement): void {
      if (node.value.trim()) node.value = pseudoLocalizeText(node.value, options);
    }
  }
  new PseudoVisitor().visit(resource);
  return serialize(resource, {});
}
