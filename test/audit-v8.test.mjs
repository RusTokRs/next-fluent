/**
 * Tests for the eighth audit pass — see ENGINEERING_AUDIT_V7.md.
 *
 * The pass closed the priorities the sixth report left open: the client bundle
 * budget now measures what an app imports instead of the aggregate facade, the
 * catalog diagnostics cover the browser path in development only, and the
 * dotted-key precedence left from V5-06 is pinned as intended behaviour rather
 * than an open question. The publish workflow's dry run is verified outside this
 * file (`npm publish --dry-run`, see the report).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FluentProvider, FormattedMessage, createFluentBundle, createTranslator } from '../dist/index.js';

const silent = { onError: () => {} };

/** Collects `console.warn` output produced by `run`. */
function captureWarnings(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

/** Runs `run` with `NODE_ENV=production`, restoring the previous value. */
function withProductionEnv(run) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

/** Collects `console.warn` output produced by an async `run`. */
async function captureWarningsAsync(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// V7-01: a client catalog that Fluent cannot fully read is named in development
// ---------------------------------------------------------------------------
test('V7-01: the provider names entries the browser parser dropped', () => {
  // Unique text so the warn-once set cannot hide this render behind an earlier
  // test that used the same catalog.
  const messages = 'ok-v7-01 = Fine\nbroken-v7-01 = { $x -> [one] one }';
  let html;
  const warnings = captureWarnings(() => {
    html = renderToStaticMarkup(
      React.createElement(
        FluentProvider,
        { locale: 'en', messages },
        React.createElement(FormattedMessage, { id: 'ok-v7-01' })
      )
    );
  });

  assert.equal(html, 'Fine');
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /cannot read/);
  assert.match(warnings[0], /"broken-v7-01"/);
});

test('V7-01: a fallback catalog is scanned too', () => {
  const messages = 'primary-v7-01 = Primary';
  const fallbackMessages = 'fallback-v7-01 = { $x -> [one] one }';
  let html;
  const warnings = captureWarnings(() => {
    html = renderToStaticMarkup(
      React.createElement(
        FluentProvider,
        { locale: 'en', messages, fallbackLocale: 'ru', fallbackMessages },
        React.createElement(FormattedMessage, { id: 'primary-v7-01' })
      )
    );
  });

  assert.equal(html, 'Primary');
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /"fallback-v7-01"/);
});

test('V7-01: a readable client catalog stays quiet', () => {
  const messages = [
    'multi-v7-01 = Line one',
    '    line two',
    'selector-v7-01 = { $n ->',
    '    [one] one',
    '   *[other] other',
    '}',
  ].join('\n');
  let html;
  const warnings = captureWarnings(() => {
    html = renderToStaticMarkup(
      React.createElement(
        FluentProvider,
        { locale: 'en', messages },
        React.createElement(FormattedMessage, { id: 'multi-v7-01' })
      )
    );
  });

  assert.equal(html, 'Line one\nline two');
  assert.deepEqual(warnings, []);
});

test('V7-01: a production build stays quiet about dropped entries', () => {
  const messages = 'ok-v7-01-prod = Fine\nbroken-v7-01-prod = { $x -> [one] one }';
  let html;
  const warnings = withProductionEnv(() =>
    captureWarnings(() => {
      html = renderToStaticMarkup(
        React.createElement(
          FluentProvider,
          { locale: 'en', messages },
          React.createElement(FormattedMessage, { id: 'ok-v7-01-prod' })
        )
      );
    })
  );

  assert.equal(html, 'Fine');
  // The scan is development-only: `npm run size` asserts that the guard also
  // removes the module (and its bytes) from a production bundle.
  assert.deepEqual(warnings, []);
});

test('V7-01: the server runtime keeps reporting in production', async () => {
  // The opposite policy on the server: a Next.js app parses every catalog there,
  // so the warning belongs in a production log as well. The development guard
  // must stay in the client call site, not in the shared scan.
  const { forLocale } = await import('../dist/server.js');
  const warnings = await withProductionEnv(() =>
    captureWarningsAsync(() =>
      forLocale('en', { messages: 'broken-v7-01-server = { $x -> [one] one }' })
    )
  );

  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /"broken-v7-01-server"/);
});

// ---------------------------------------------------------------------------
// V5-06 revisit: the shadowed dotted key is reachable, on purpose
// ---------------------------------------------------------------------------
test('V5-06: a message shadowing an attribute is reachable both ways', () => {
  const bundle = createFluentBundle(
    'en',
    [
      'greeting =',
      '    .formal = Good day, { $name }',
      'greeting-formal = Hey { $nick }',
    ].join('\n'),
    { useIsolating: false, disableCache: true }
  );
  const t = createTranslator(bundle, silent);

  // Dashes are matched before the dotted attribute (README: "a dashes key is
  // looked up first"), and typegen declares the arguments of the same winner.
  assert.equal(t('greeting.formal', { nick: 'Ada' }), 'Hey Ada');
  assert.equal(t('greeting-formal', { nick: 'Ada' }), 'Hey Ada');
  // The attribute is not lost — it has its own accessor.
  assert.deepEqual(t.attrs('greeting', { name: 'Ada' }), { formal: 'Good day, Ada' });
  assert.equal(t.has('greeting.formal'), true);
  // And the attribute path resolves when no message shadows it.
  const attributeOnly = createTranslator(
    createFluentBundle('en', 'greeting =\n    .formal = Good day, { $name }', {
      useIsolating: false,
      disableCache: true,
    }),
    silent
  );
  assert.equal(attributeOnly('greeting.formal', { name: 'Ada' }), 'Good day, Ada');
});

// ---------------------------------------------------------------------------
// The size budget measures the whole client surface, or it lies
// ---------------------------------------------------------------------------
test('the size fixture imports every runtime export of the client entries', async () => {
  const fixture = fs.readFileSync(
    new URL('./fixtures/size/client-consumer.ts', import.meta.url),
    'utf8'
  );
  for (const specifier of ['../dist/client.js', '../dist/navigation.js']) {
    const namespace = await import(specifier);
    for (const name of Object.keys(namespace)) {
      assert.ok(
        fixture.includes(name),
        `${specifier} exports "${name}", which the size fixture does not import — add it so ` +
          'the budget keeps counting everything a browser can reach'
      );
    }
  }
});
