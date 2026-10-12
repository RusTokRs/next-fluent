/**
 * Audit pass 20 — see ENGINEERING_AUDIT_V20.md.
 *
 * The pass found one silent divergence across the RSC boundary, corrected a
 * claim the previous report made about `navigation.js`, and closed two items by
 * measurement rather than by code: the catalog "pseudo-locale" question has no
 * reliable syntactic test, and the usage masker survives the differential fuzz
 * it had never been put through.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import test from 'node:test';

import * as server from '../dist/server.js';
import { FluentServerProvider } from '../dist/server-provider.js';
import { FluentProvider, useTranslations } from '../dist/client.js';
import { createNavigation } from '../dist/navigation.js';
import { collectCallSites } from '../dist/usage.js';
import { canonicalizeLocale } from '../dist/utils.js';

const BASELINE = { locales: ['en'], defaultLocale: 'en' };

/**
 * Runs `body` with `NODE_ENV` pinned, then puts both it and the module-level
 * locale configuration back.
 *
 * `await`ed, not returned: the provider is async, and a synchronous `finally`
 * would restore the environment before the body had run a single line of it.
 */
async function withNodeEnv(value, body) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    server.configureServerI18n(BASELINE);
  }
}

/** Captures what `console.warn` said while `body` ran. Awaited, for the same reason. */
async function captureWarnings(body) {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    return { result: await body(), seen };
  } finally {
    console.warn = original;
  }
}

const FUNCTION_CATALOG = 'price = { BRL(1) }\nplain = Plain\n';

function configureWithFunctions() {
  server.configureServerI18n(BASELINE);
  server.setRequestConfig(async ({ locale }) => ({
    locale,
    messages: FUNCTION_CATALOG,
    functions: { BRL: () => 'R$ 1', USD: () => '$1' },
  }));
}

// ---------------------------------------------------------------------------
// V20-01: custom Fluent functions vanished at the RSC boundary without a word
// ---------------------------------------------------------------------------

test('V20-01: the same message formats on the server and renders its own key on the client', async () => {
  await withNodeEnv('development', async () => {
    configureWithFunctions();

    const t = await server.getTranslations();
    assert.equal(t('price'), 'R$ 1', 'the server applies the request config functions');

    function Client() {
      return React.createElement('span', null, useTranslations()('price'));
    }
    // `FluentServerProvider` cannot forward `functions`, so this is the payload
    // a Client Component actually receives.
    const html = renderToStaticMarkup(
      React.createElement(FluentProvider, { locale: 'en', messages: FUNCTION_CATALOG },
        React.createElement(Client))
    );
    assert.equal(html, '<span>price</span>');
  });
});

test('V20-01: the provider names the functions that cannot cross, in development', async () => {
  await withNodeEnv('development', async () => {
    configureWithFunctions();
    const { seen } = await captureWarnings(() => FluentServerProvider({ children: null, locale: 'en' }));
    const message = seen.join('\n');
    assert.match(message, /cannot cross the Server Component boundary/);
    assert.match(message, /"BRL"/);
    assert.match(message, /"USD"/, 'every dropped function is named, not just the first');
    assert.match(message, /'use client'/, 'and the warning says what to do about it');
  });
});

test('V20-01: production stays silent, and so does a config without functions', async () => {
  await withNodeEnv('production', async () => {
    configureWithFunctions();
    const { seen } = await captureWarnings(() => FluentServerProvider({ children: null, locale: 'en' }));
    assert.deepEqual(seen, [], 'a production bundle must not carry the diagnostic');
  });

  await withNodeEnv('development', async () => {
    server.configureServerI18n(BASELINE);
    server.setRequestConfig(async ({ locale }) => ({ locale, messages: 'plain = Plain\n' }));
    const { seen } = await captureWarnings(() => FluentServerProvider({ children: null, locale: 'en' }));
    assert.deepEqual(seen, [], 'nothing to warn about when the config defines no functions');
  });
});

test('V20-01: the boundary is real — functions are not forwarded, by construction', async () => {
  await withNodeEnv('development', async () => {
    configureWithFunctions();
    const { result } = await captureWarnings(() => FluentServerProvider({ children: null, locale: 'en' }));
    const element = result;
    // A function is code; no serializer would carry it. The prop is absent
    // rather than stripped, which is what makes the warning the only recourse.
    assert.equal('functions' in element.props, false);
    // Everything serializable still crosses.
    assert.equal(element.props.locale, 'en');
    assert.equal(element.props.messages, FUNCTION_CATALOG);
  });
});

// ---------------------------------------------------------------------------
// V20-02: the "pseudo-locale" question, closed by measurement
// ---------------------------------------------------------------------------

test('V20-02: namespace directory names are valid locale tags, so no syntactic test exists', () => {
  // `messages/shared/` is read as a locale called `shared`, which puts a
  // directory nobody configured into the `check` report. Two passes deferred
  // this as "a question for the owner"; the reason it cannot be settled in code
  // is that BCP-47 language subtags are 2–3 or 5–8 letters, so the names a
  // monorepo actually uses parse as tags.
  const acceptedAsLocales = ['shared', 'common', 'app', 'admin', 'ui', 'web'];
  for (const name of acceptedAsLocales) {
    assert.ok(canonicalizeLocale(name), `"${name}" is a valid locale tag, so it cannot be flagged`);
  }
  // Only names outside the subtag lengths are recognisable — and a real locale
  // list contains plenty of those shapes too, so length is not a signal either.
  assert.equal(canonicalizeLocale('components'), undefined);
  assert.equal(canonicalizeLocale('marketing'), undefined);
});

// ---------------------------------------------------------------------------
// V20-03a: the navigation tail V19 called unreachable
// ---------------------------------------------------------------------------

function routerFor(config, providerLocale, calls) {
  const nav = createNavigation(config);
  let router;
  function Probe() {
    router = nav.useRouter();
    return null;
  }
  const nextRouter = Object.fromEntries(
    ['push', 'replace', 'prefetch', 'back', 'forward', 'refresh'].map((name) => [
      name,
      (...args) => calls.push([name, ...args]),
    ])
  );
  renderToStaticMarkup(
    React.createElement(
      FluentProvider,
      { locale: providerLocale, messages: 'x = X' },
      React.createElement(AppRouterContext.Provider, { value: nextRouter }, React.createElement(Probe))
    )
  );
  return router;
}

const routing = { locales: ['en', 'ru'], defaultLocale: 'en', localePrefix: 'always', localeDetection: false };

test('V20-03: back, forward and refresh delegate to the router', () => {
  // V19 §7 listed these as reachable only inside the App Router. They are not:
  // they are one-line delegations, and the harness V16 already wrote renders
  // `useRouter()` outside one. Naming them correctly matters, because "only
  // reachable in the App Router" is how a tail gets written off.
  for (const method of ['back', 'forward', 'refresh']) {
    const calls = [];
    routerFor(routing, 'en', calls)[method]();
    assert.deepEqual(calls, [[method]], `${method} must forward to the Next router untouched`);
  }
});

test('V20-03: the three delegations take no arguments and add none', () => {
  const calls = [];
  const router = routerFor(routing, 'en', calls);
  // Whatever a caller passes, the Next router receives exactly what it expects:
  // nothing. A stray argument would be a silent behaviour change upstream.
  router.back('ignored');
  router.refresh('ignored');
  assert.deepEqual(calls, [['back'], ['refresh']]);
});

// ---------------------------------------------------------------------------
// V20-03b: the usage masker under differential fuzz
// ---------------------------------------------------------------------------

/** Non-code that must neither produce call sites nor shift line numbers. */
const NOISE = [
  "// t('in-line-comment')",
  "/* t('in-block-comment') */",
  "/**\n * t('in-jsdoc')\n */",
  "const s = 't(\\'in-single-quote\\')';",
  'const d = "t(\'in-double-quote\')";',
  "const b = `t('in-template')`;",
  "const b2 = `text ${ t('in-template-expr') } text`;",
  "const re = /t\\('in-regex'\\)/;",
  'const re2 = /[/]/g;',
  "const s2 = 'it\\'s t(\\'escaped\\')';",
  "const b3 = `a\\`b t('after-escaped-backtick')`;",
  'const b4 = `${ {a:1}.a }`;',
  '// trailing comment with ` backtick',
  'const q = "he said \\"t(\'x\')\\"";',
  'const div = 10 / 2; const re3 = /a/;',
];

const NOT_A_CALL_SITE = /in-line-comment|in-block-comment|in-jsdoc|in-single-quote|in-double-quote|in-template'|in-regex|escaped'/;

test('V20-03: a live call site keeps its line number behind any amount of non-code', () => {
  for (let blocks = 1; blocks <= NOISE.length; blocks++) {
    for (const method of ['', '.raw', '.rich', '.attrs', '.plain', '.has']) {
      const prefix = NOISE.slice(0, blocks).join('\n');
      const source = `${prefix}\nconst x = t${method}('live-key');\n`;
      const { sites } = collectCallSites({ path: 'f.tsx', content: source });
      const live = sites.filter((site) => site.argument.includes('live-key'));
      assert.equal(
        live.length,
        1,
        `${blocks} noise block(s), method t${method || '()'}: ${live.length} live sites`
      );
      assert.equal(live[0].line, prefix.split('\n').length + 1, `line drifted for t${method}`);
    }
  }
});

test('V20-03: a key that appears only inside non-code is never reported', () => {
  for (const [index, block] of NOISE.entries()) {
    const { sites } = collectCallSites({ path: 'f.tsx', content: `${block}\n` });
    const leaked = sites.filter((site) => NOT_A_CALL_SITE.test(site.argument));
    assert.deepEqual(
      leaked.map((site) => site.argument),
      [],
      `noise #${index} leaked a call site: ${JSON.stringify(block)}`
    );
  }
});

test('V20-03: a call inside a template expression is real code and is collected', () => {
  const source = "const b = `prefix ${ t('inside-expr') } suffix`;\n";
  const { sites } = collectCallSites({ path: 'f.tsx', content: source });
  assert.ok(
    sites.some((site) => site.argument.includes('inside-expr')),
    'the masker must keep ${…} visible'
  );
  // …while the literal text around it stays blanked out.
  assert.ok(!sites.some((site) => site.argument.includes('prefix')));
});
