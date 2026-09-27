import { FluentError, FluentErrorCode } from './errors';

/**
 * JSON catalog support.
 *
 * Fluent catalogs are `.ftl` text, but a lot of tooling (translation vendors,
 * CMS exports, existing i18n setups) speaks JSON. Accepting a plain object
 * wherever FTL text is accepted makes migration a copy-paste instead of a
 * rewrite: next-intl users can hand over their `en.json` unchanged.
 *
 * Mapping rules:
 * - Nested objects become namespaced ids joined with `-`
 *   (`{ nav: { home } }` → `nav-home`, addressable as `t('nav.home')`).
 * - `{$count}` / `{count}` placeholders become Fluent variables (`{ $count }`).
 * - A `""` key holds the message value; its siblings become attributes, so
 *   JSON can express `.label` / `.aria-label`.
 */

/** Anything accepted where a catalog is expected. */
export type MessageSource = string | readonly string[] | JsonCatalog;

export type JsonCatalog = Record<string, unknown>;

const VALID_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/**
 * `{count}` / `{$count}` become Fluent variables. Whitespace inside the braces
 * is not a variable (`{ and }` stays literal text), which keeps prose that
 * happens to contain braces intact.
 */
const VARIABLE = /\{\$?([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function isPlainObject(value: unknown): value is JsonCatalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Type guard distinguishing a JSON catalog from a `FluentBundle` instance. */
export function isJsonCatalog(value: unknown): value is JsonCatalog {
  return isPlainObject(value);
}

function invalid(message: string, key = '<catalog>'): FluentError {
  return new FluentError({
    code: FluentErrorCode.INVALID_ARGUMENT,
    key,
    message: `[next-fluent] ${message}`,
  });
}

/** Fluent string-literal escaping: only `\` and `"` are escapable. */
function escapeLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function needsQuoting(text: string): boolean {
  return (
    text === '' ||
    text !== text.trim() ||
    /[{}"\\]/.test(text) ||
    /^[.#*[]/.test(text)
  );
}

/**
 * Renders one line of FTL text.
 *
 * Variables become placeables, everything else stays raw unless it contains
 * characters Fluent would parse as syntax — then each literal run is wrapped in
 * a string placeable so the value survives a parse round-trip byte for byte.
 */
function renderInline(text: string): string {
  if (!needsQuoting(text)) return text;

  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  VARIABLE.lastIndex = 0;

  while ((match = VARIABLE.exec(text)) !== null) {
    const literal = text.slice(last, match.index);
    if (literal !== '') out += `{ "${escapeLiteral(literal)}" }`;
    out += `{ $${match[1]} }`;
    last = match.index + match[0].length;
  }

  const tail = text.slice(last);
  if (tail !== '') {
    out += /[{}"\\]/.test(tail)
      ? tail.replace(/[{}"\\]/g, (ch) =>
          ch === '{' || ch === '}' ? `{ "${ch}" }` : `{ "${escapeLiteral(ch)}" }`
        )
      : `{ "${escapeLiteral(tail)}" }`;
  }

  return out === '' ? '{ "" }' : out;
}

/** Renders a value as an inline pattern or an indented block pattern. */
export function renderFluentPattern(text: string): string {
  // Fluent cannot represent a carriage return at all: a raw CR inside a string
  // literal makes the runtime parser drop the entire message. Normalizing line
  // breaks to LF turns the value into a valid multi-line pattern instead.
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized === '') return '{ "" }';
  if (normalized.includes('\n')) {
    return `\n${normalized
      .split('\n')
      .map((line) => `    ${renderInline(line)}`)
      .join('\n')}`;
  }
  return renderInline(normalized);
}

function normalizeId(segment: string, path: string): string {
  const id = segment.replaceAll('.', '-');
  if (!VALID_ID.test(id)) {
    throw invalid(
      `JSON catalog key "${path}" is not a valid Fluent message id. ` +
        'Ids must start with a letter and contain only letters, digits, "-" and "_".',
      path
    );
  }
  return id;
}

/** Guards against a stack overflow turning into an opaque crash. */
const MAX_JSON_DEPTH = 32;

function walk(value: unknown, id: string, path: string, out: string[], depth = 0): void {
  if (depth > MAX_JSON_DEPTH) {
    throw invalid(
      `JSON catalog value at "${path}" is nested more than ${MAX_JSON_DEPTH} levels deep.`,
      path
    );
  }
  if (value === null || value === undefined) {
    throw invalid(
      `JSON catalog value at "${path}" is ${value === null ? 'null' : 'undefined'}. ` +
        'Every message must be a string, a number, a boolean or a nested object.',
      path
    );
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(`${id} = ${renderFluentPattern(String(value))}`);
    return;
  }

  if (Array.isArray(value)) {
    throw invalid(
      `JSON catalog value at "${path}" is an array. Fluent expresses alternatives with ` +
        'selectors, e.g. `items = { $count -> [one] one item *[other] { $count } items }`.',
      path
    );
  }

  if (!isPlainObject(value)) {
    throw invalid(
      `JSON catalog value at "${path}" has an unsupported type: ${typeof value}.`,
      path
    );
  }

  const entries = Object.entries(value);
  const hasValue = entries.some(([key]) => key === '');

  if (hasValue) {
    const own = entries.find(([key]) => key === '')?.[1];
    if (typeof own === 'object' && own !== null) {
      throw invalid(
        `JSON catalog value at "${path}" cannot mix a "" value with nested objects.`,
        path
      );
    }
    out.push(`${id} = ${renderFluentPattern(String(own ?? ''))}`);
    for (const [key, attr] of entries) {
      if (key === '') continue;
      if (typeof attr === 'object' && attr !== null) {
        throw invalid(`JSON catalog attribute "${path}.${key}" must be a string.`, `${path}.${key}`);
      }
      out.push(`    .${normalizeId(key, `${path}.${key}`)} = ${renderFluentPattern(String(attr))}`);
    }
    return;
  }

  for (const [key, nested] of entries) {
    walk(nested, `${id}-${normalizeId(key, `${path}.${key}`)}`, `${path}.${key}`, out, depth + 1);
  }
}

/** Converts a JSON catalog object into FTL source. */
export function jsonToFluent(catalog: JsonCatalog): string {
  if (!isPlainObject(catalog)) {
    throw invalid('JSON catalogs must be plain objects.');
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    walk(value, normalizeId(key, key), key, out);
  }
  return out.length > 0 ? `${out.join('\n')}\n` : '';
}

/**
 * Normalizes any accepted catalog shape to what a `FluentBundle` can consume.
 * JSON objects are converted; strings and arrays pass through untouched.
 */
export function toFluentSource(messages: MessageSource): string | readonly string[] {
  if (typeof messages === 'string') return messages;
  if (Array.isArray(messages)) return messages as readonly string[];
  if (isPlainObject(messages)) return jsonToFluent(messages);
  throw invalid(
    `Catalogs must be FTL text, an array of FTL sources or a JSON object (received ${typeof messages}).`
  );
}
