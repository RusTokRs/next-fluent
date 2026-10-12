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
 * `{count}` / `{$count}` become Fluent variables, so ICU-style catalogs keep
 * working after the move. Whitespace inside the braces is not a variable
 * (`{ and }` stays literal text), and `\{` / `\}` always mean a literal brace.
 * That escape hatch matters for prose like `has {braces}`: without it the value
 * would silently turn into a reference to a variable nobody passes, and the
 * message would render as its own key.
 */
const VARIABLE = /\\[{}]|\{\$?([a-zA-Z][a-zA-Z0-9_]*)\}/g;

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

/**
 * Removes a leading UTF-8 byte-order mark from catalog text.
 *
 * Neither Fluent parser treats U+FEFF as whitespace, so a catalog saved by a
 * Windows editor (or produced by a tool that emits a BOM) silently loses its
 * *first* message: the parser skips the line and only the remaining entries show
 * up. JSON.parse strips the mark, `fs.readFileSync(path, 'utf8')` does not, so
 * the robust place to remove it is here — in the shared funnel every catalog
 * source passes through.
 */
export function stripCatalogBom(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
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
    // Literal runs are always wrapped in a string placeable, so any brace or
    // backslash left in them is inert.
    if (literal !== '') out += `{ "${escapeLiteral(literal)}" }`;
    out += match[1] === undefined ? `{ "${match[0][1]}" }` : `{ $${match[1]} }`;
    last = match.index + match[0].length;
  }

  const tail = text.slice(last);
  if (tail !== '') out += `{ "${escapeLiteral(tail)}" }`;

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

/**
 * Ids already emitted, mapped to the JSON path that produced them.
 *
 * Nested objects and dashes both collapse into the same id: `{ "nav-home" }`
 * and `{ nav: { home } }` are the same Fluent message. Emitting both produced a
 * resource with a duplicate id, which the runtime resolves last-wins (with a
 * console warning) while `typegen` silently dropped one of them.
 */
type EmittedIds = Map<string, string>;

function declareId(seen: EmittedIds, id: string, path: string): void {
  const existing = seen.get(id);
  if (existing !== undefined && existing !== path) {
    throw invalid(
      `JSON catalog keys "${existing}" and "${path}" both map to the Fluent message id ` +
        `"${id}". Rename one of them: a catalog cannot define the same message twice.`,
      path
    );
  }
  seen.set(id, path);
}

function walk(
  value: unknown,
  id: string,
  path: string,
  out: string[],
  depth = 0,
  seen: EmittedIds = new Map()
): void {
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
    declareId(seen, id, path);
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
  if (entries.length === 0) {
    // An empty object is not a message with empty text — it is a message the
    // author has not written yet. Dropping it silently produced a catalog in
    // which every lookup of that id misses (`t('a')` then renders "a"), which is
    // exactly the class of failure the analyzer exists to catch, so the input is
    // rejected with the same guidance as the other impossible shapes.
    throw invalid(
      `JSON catalog value at "${path}" is an empty object. Every message needs a value ` +
        '(`""`), at least one attribute, or nested messages.',
      path
    );
  }
  const hasValue = entries.some(([key]) => key === '');

  if (hasValue) {
    const own = entries.find(([key]) => key === '')?.[1];
    if (typeof own === 'object' && own !== null) {
      throw invalid(
        `JSON catalog value at "${path}" cannot mix a "" value with nested objects.`,
        path
      );
    }
    declareId(seen, id, path);
    out.push(`${id} = ${renderFluentPattern(String(own ?? ''))}`);
    /**
     * Attribute names already emitted for this message, mapped to the JSON path
     * that produced them. The same collision `declareId` guards for message ids
     * exists one level down: `normalizeId` folds `.` into `-`, and a leading
     * `.` is accepted as the attribute marker, so `"label"` and `".label"` —
     * and just as easily `"a.b"` and `"a-b"` — all land on the same FTL
     * attribute. Emitting both produced `.label` twice, the runtime silently
     * kept the last one and `typegen` dropped one of them: the author's other
     * translation was gone with nothing to say so.
     */
    const declaredAttributes = new Map<string, string>();
    for (const [key, attr] of entries) {
      if (key === '') continue;
      if (typeof attr === 'object' && attr !== null) {
        throw invalid(`JSON catalog attribute "${path}.${key}" must be a string.`, `${path}.${key}`);
      }
      // Attributes sit next to the `""` value, so a key can only ever be one. A
      // leading dot — how FTL itself spells an attribute, and therefore what an
      // author porting a `.attr = …` line writes — is accepted as the marker.
      // It cannot collide with anything: `normalizeId` turns a leading dot into
      // `-`, which is not a legal id start, so such a key used to fail with an
      // error about the message id `a..attr` instead of naming the real problem.
      const attributeName = key.startsWith('.') ? key.slice(1) : key;
      const attributePath = `${path}.${key}`;
      const attributeId = normalizeId(attributeName, attributePath);
      const existing = declaredAttributes.get(attributeId);
      if (existing !== undefined) {
        throw invalid(
          `JSON catalog keys "${existing}" and "${attributePath}" both map to the attribute ` +
            `".${attributeId}" of the message "${id}". Rename one of them: a message cannot ` +
            'define the same attribute twice.',
          attributePath
        );
      }
      declaredAttributes.set(attributeId, attributePath);
      out.push(`    .${attributeId} = ${renderFluentPattern(String(attr))}`);
    }
    return;
  }

  for (const [key, nested] of entries) {
    walk(
      nested,
      `${id}-${normalizeId(key, `${path}.${key}`)}`,
      `${path}.${key}`,
      out,
      depth + 1,
      seen
    );
  }
}

/** Converts a JSON catalog object into FTL source. */
export function jsonToFluent(catalog: JsonCatalog): string {
  if (!isPlainObject(catalog)) {
    throw invalid('JSON catalogs must be plain objects.');
  }
  const out: string[] = [];
  const seen: EmittedIds = new Map();
  for (const [key, value] of Object.entries(catalog)) {
    walk(value, normalizeId(key, key), key, out, 0, seen);
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
