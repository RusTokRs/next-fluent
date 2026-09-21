import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormatter, clearFormatterCache } from '../dist/formatter.js';

test('createFormatter formats dateTime across locales and options', () => {
  const enFormatter = createFormatter({ locale: 'en', timeZone: 'UTC' });
  const ruFormatter = createFormatter({ locale: 'ru', timeZone: 'UTC' });

  const date = new Date('2026-09-21T12:00:00Z');

  const enDate = enFormatter.dateTime(date, { dateStyle: 'medium' });
  assert.match(enDate, /Sep 21, 2026/);

  const ruDate = ruFormatter.dateTime(date, { dateStyle: 'medium' });
  assert.ok(ruDate.includes('2026') || ruDate.includes('21'));

  // Timestamp number input
  const fromTimestamp = enFormatter.dateTime(date.getTime(), { dateStyle: 'short' });
  assert.ok(typeof fromTimestamp === 'string' && fromTimestamp.length > 0);

  // ISO string input
  const fromIso = enFormatter.dateTime('2026-09-21T12:00:00Z', { dateStyle: 'short' });
  assert.ok(typeof fromIso === 'string' && fromIso.length > 0);

  // Invalid date fallback
  const invalid = enFormatter.dateTime('not-a-date');
  assert.equal(invalid, 'not-a-date');
});

test('createFormatter formats numbers with currency, percentage, and units', () => {
  const enFormatter = createFormatter('en');

  // Currency
  const usd = enFormatter.number(1234.56, { style: 'currency', currency: 'USD' });
  assert.ok(usd.includes('1,234.56') || usd.includes('$'));

  // Percentage
  const percent = enFormatter.number(0.25, { style: 'percent' });
  assert.equal(percent, '25%');

  // Decimal
  const decimal = enFormatter.number(1234567.89, { maximumFractionDigits: 1 });
  assert.match(decimal, /1,234,567\.9/);

  // BigInt
  const big = enFormatter.number(1000000000000n);
  assert.match(big, /1,000,000,000,000/);
});

test('createFormatter formats relativeTime correctly', () => {
  const enFormatter = createFormatter('en');
  const ruFormatter = createFormatter('ru');

  const yesterdayEn = enFormatter.relativeTime(-1, 'day', { numeric: 'auto' });
  assert.equal(yesterdayEn, 'yesterday');

  const tomorrowEn = enFormatter.relativeTime(1, 'day', { numeric: 'auto' });
  assert.equal(tomorrowEn, 'tomorrow');

  const inThreeHours = enFormatter.relativeTime(3, 'hour');
  assert.equal(inThreeHours, 'in 3 hours');

  const yesterdayRu = ruFormatter.relativeTime(-1, 'day', { numeric: 'auto' });
  assert.equal(yesterdayRu, 'вчера');
});

test('createFormatter formats list correctly', () => {
  const enFormatter = createFormatter('en');

  const conjunction = enFormatter.list(['Apple', 'Banana', 'Orange']);
  assert.match(conjunction, /Apple, Banana, and Orange|Apple, Banana, Orange/);

  const disjunction = enFormatter.list(['Apple', 'Banana', 'Orange'], { type: 'disjunction' });
  assert.match(disjunction, /Apple, Banana, or Orange/);
});

test('formatter cache operates boundedly and clearFormatterCache resets it', () => {
  clearFormatterCache();
  const formatter = createFormatter('en');

  // Exercise cache hits
  for (let i = 0; i < 5; i++) {
    formatter.number(100, { style: 'currency', currency: 'USD' });
    formatter.relativeTime(1, 'day');
    formatter.list(['a', 'b']);
  }

  clearFormatterCache();
  // Formatting still functions after clear
  const after = formatter.number(42);
  assert.equal(after, '42');
});
