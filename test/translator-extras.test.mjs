import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

import { createFluentBundle, createTranslator } from '../dist/bundle.js';
import { FluentErrorCode } from '../dist/errors.js';

const silent = { onError: () => {} };
const strip = (value) => value.replace(/[\u2068\u2069]/g, '');

const FTL = `
login-button = Sign in
    .label = Sign in now
    .aria-label = Sign in as { $user }
    .title = Open the login dialog

rich = Visit <link>our docs</link> today
token-rich = Hello { $who }!

missing-attrs = no attributes here
broken = Broken
    .label = Value: { $nope }
`;

test('t.attrs() returns attributes in declaration order', () => {
  const t = createTranslator(createFluentBundle('en', FTL), silent);

  const attrs = t.attrs('login-button', { user: 'Ada' });
  assert.deepEqual(Object.keys(attrs), ['label', 'aria-label', 'title']);
  assert.equal(attrs.label, 'Sign in now');
  assert.equal(strip(attrs['aria-label']), 'Sign in as Ada');
});

test('t.attrs() follows the same first-match-wins fallback as t()', () => {
  const primary = createFluentBundle('ru', 'login-button = Войти\n    .label = Войти\n');
  const fallback = createFluentBundle('en', FTL);
  const t = createTranslator(primary, { fallbackBundle: fallback });

  // The primary bundle owns the message, so its (partial) attribute set wins —
  // exactly like t(), which never merges two locales for one key.
  assert.deepEqual(Object.keys(t.attrs('login-button')), ['label']);

  // A message the primary bundle lacks entirely resolves from the fallback.
  const partial = createFluentBundle('ru', 'other = Другое\n');
  const withFallback = createTranslator(partial, { fallbackBundle: fallback });
  const attrs = withFallback.attrs('login-button', { user: 'Ada' });
  assert.deepEqual(Object.keys(attrs), ['label', 'aria-label', 'title']);
  assert.equal(strip(attrs['aria-label']), 'Sign in as Ada');

  const errors = [];
  const reporting = createTranslator(createFluentBundle('en', FTL), {
    onError: (error) => errors.push(error),
  });
  assert.deepEqual(reporting.attrs('nope'), {});
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, FluentErrorCode.MISSING_MESSAGE);
  assert.equal(errors[0].key, 'nope');
});

test('t.attrs() reports formatting errors instead of returning partial output', () => {
  const errors = [];
  const t = createTranslator(createFluentBundle('en', FTL), {
    onError: (error) => errors.push(error),
  });

  assert.deepEqual(t.attrs('broken'), {});
  assert.equal(errors[0].code, FluentErrorCode.FORMATTING_ERROR);

  assert.deepEqual(t.attrs('missing-attrs'), {});
  assert.equal(errors[1].code, FluentErrorCode.MISSING_MESSAGE);
});

test('t.plain() drops markup and element tokens', () => {
  const t = createTranslator(createFluentBundle('en', FTL), silent);

  assert.equal(strip(t.plain('rich')), 'Visit our docs today');
  assert.equal(strip(t.plain('token-rich', { who: React.createElement('b', null, 'Ada') })), 'Hello !');
  // Plain text keeps ordinary interpolation and bidi isolates from t().
  assert.equal(strip(t.plain('login-button')), 'Sign in');
});

test('t.plain strips bidi isolation marks even without markup', () => {
  // t.plain is documented for aria-label/title/alt/<meta>. Bidi marks are
  // invisible characters that must not end up in an HTML attribute, and they
  // survive formatting around every placeable — a message with no markup is
  // the common case, so the strip cannot depend on markup being present.
  const bundle = createFluentBundle('en', 'hello = Hello { $name }\nrich = Click <b>here</b>\n');
  const t = createTranslator(bundle);

  const plain = t.plain('hello', { name: 'John' });
  assert.equal(plain, 'Hello John');
  assert.equal(/[\u2068\u2069]/.test(plain), false);

  // The markup path keeps working too.
  assert.equal(t.plain('rich'), 'Click here');
});

test('t.attrs keeps stripping marks, matching t.plain', () => {
  const bundle = createFluentBundle(
    'en',
    'field = Value\n    .aria-label = Label { $name }\n'
  );
  const attrs = createTranslator(bundle).attrs('field', { name: 'John' });
  assert.deepEqual(attrs, { 'aria-label': 'Label John' });
});
