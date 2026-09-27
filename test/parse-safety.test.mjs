import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFtl } from '../dist/ftl-parse.js';
import { jsonToFluent } from '../dist/catalog.js';
import { pseudoLocalizeFtl } from '../dist/pseudo.js';
import { checkCatalogs } from '../dist/check.js';
import { pickMessages } from '../dist/pick-messages.js';

const deepBraces = `{${'{'.repeat(4000)}}`;

test('parseFtl turns the parser stack overflow into an actionable error', () => {
  assert.throws(
    () => parseFtl(`a = ${deepBraces}\n`, 'The catalog'),
    (error) => {
      assert.equal(error.name, 'FluentError');
      assert.match(error.message, /nested too deeply for the FTL parser/);
      assert.ok(error.cause instanceof RangeError, 'the original error is preserved as cause');
      return true;
    }
  );
});

test('every catalog consumer reports depth instead of crashing', () => {
  const catalog = `a = ${deepBraces}\n`;
  for (const [name, call] of [
    ['checkCatalogs', () => checkCatalogs({ en: catalog, ru: 'a = 1' })],
    ['pickMessages', () => pickMessages(catalog, 'a')],
    ['pseudoLocalizeFtl', () => pseudoLocalizeFtl(catalog)],
  ]) {
    assert.throws(call, /nested too deeply for the FTL parser/, `${name} leaked a raw error`);
  }
});

test('a deeply nested JSON catalog is rejected with a clear error', () => {
  let node = { leaf: 'x' };
  for (let i = 0; i < 5000; i++) node = { [`n${i}`]: node };
  assert.throws(() => jsonToFluent(node), /nested more than 32 levels deep/);
});

test('ordinary nesting depth is unaffected', () => {
  let node = { leaf: 'x' };
  for (let i = 0; i < 10; i++) node = { [`n${i}`]: node };
  assert.match(jsonToFluent(node), /n9-n8-n7-n6-n5-n4-n3-n2-n1-n0-leaf = x/);
  assert.ok(parseFtl('a = { $x }\n', 'test').body.length === 1);
});
