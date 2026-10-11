/**
 * Tests for the eighth audit pass — see ENGINEERING_AUDIT_V7.md.
 *
 * The pass closed the priorities the sixth report left open: the client bundle
 * budget now measures what an app imports instead of the aggregate facade, the
 * catalog diagnostics cover the browser path in development only, and the
 * dotted-key precedence left from V5-06 is pinned as intended behaviour rather
 * than an open question. Verifying the publish workflow (V7-04) then turned up
 * V7-05: `npm publish --dry-run` leaks `npm_config_dry_run` into the Next
 * integration harness, whose nested `npm install` therefore installs nothing.
 * Those two tests pin the helper that keeps npm's own configuration out of the
 * child processes this repository starts.
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
// V7-05: a nested npm install inherited npm's own configuration
// ---------------------------------------------------------------------------
/** Runs `run` with the given environment variables set, restoring them after. */
function withEnv(vars, run) {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('V7-05: cleanNpmEnv strips the npm config namespace and keeps everything else', async () => {
  const { cleanNpmEnv, inheritedNpmConfigKeys } = await import('../scripts/npm-env.mjs');
  const env = withEnv({ npm_config_dry_run: 'true', NPM_CONFIG_OFFLINE: 'true' }, () =>
    cleanNpmEnv({ NEXT_TELEMETRY_DISABLED: '1' })
  );

  assert.ok(
    !Object.keys(env).some((key) => /^npm_config_/i.test(key)),
    `npm configuration survived: ${Object.keys(env).filter((key) => /^npm_config_/i.test(key)).join(', ')}`
  );
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1');
  assert.equal(env.PATH, process.env.PATH, 'unrelated variables are preserved');

  const inherited = withEnv({ npm_config_dry_run: 'true', NPM_CONFIG_OFFLINE: 'true' }, () =>
    inheritedNpmConfigKeys()
  );
  assert.ok(inherited.includes('npm_config_dry_run'));
  assert.ok(inherited.includes('NPM_CONFIG_OFFLINE'), 'the check is case-insensitive');
});

test('V7-05: both integration harnesses build child environments through the helper', () => {
  for (const file of ['test-next-integration.mjs', 'test-domain-browser.mjs']) {
    const source = fs.readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    assert.ok(source.includes('cleanNpmEnv'), `${file} does not use cleanNpmEnv`);
    assert.ok(
      !source.includes('...process.env'),
      `${file} spreads process.env into a child process again — a nested npm install would ` +
        'inherit `npm_config_dry_run` and install nothing (V7-05)'
    );
  }
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
