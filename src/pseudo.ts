/**
 * Pseudo-localization engine for layout overflow and truncation testing.
 */
import {
  parse,
  serialize,
  Visitor,
  TextElement,
  type Pattern,
} from '@fluent/syntax';

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
  const resource = parse(ftlContent, { withSpans: false });
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
