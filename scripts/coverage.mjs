#!/usr/bin/env node
/**
 * Coverage gate.
 *
 * The audit reports quote coverage numbers, and until now every one of them was
 * produced by an ad-hoc `node --test --experimental-test-coverage` invocation
 * that nothing recorded and nothing enforced. This makes the number a checked
 * artifact: the suite runs under the coverage reporter, the totals are parsed
 * out of Node's own table, and the process fails if they drop below the floor.
 *
 * The floor is deliberately a little under the current figure rather than equal
 * to it. A gate that must be edited every time a branch is added teaches people
 * to edit the gate; one that fails only on a real regression gets left alone.
 *
 * Coverage is measured against `dist/`, because that is what ships and what the
 * build actually produced — see `scripts/check-dist.mjs` for why the two are
 * kept in sync.
 */
import { spawnSync } from 'node:child_process';

const FLOORS = { lines: 96.5, branches: 93.5, functions: 96 };

const run = spawnSync(
  process.execPath,
  ['--test', '--experimental-test-coverage', 'test/*.test.mjs'],
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, cwd: process.cwd() }
);

const stdout = run.stdout ?? '';
process.stdout.write(stdout);
if (run.stderr) process.stderr.write(run.stderr);

if (run.status !== 0) {
  console.error(`[next-fluent] The test suite failed (exit ${run.status}); coverage not scored.`);
  process.exit(run.status ?? 1);
}

// Node's summary row looks like:
//   # all files                            |  96.80 |    93.84 |   96.36 |
const summary = stdout
  .split('\n')
  .find((line) => /^\s*#\s*all files\s*\|/.test(line));

if (!summary) {
  console.error('[next-fluent] Could not find a coverage summary in the reporter output.');
  process.exit(1);
}

const cells = summary.split('|').slice(1, 4).map((cell) => Number.parseFloat(cell.trim()));
if (cells.some((value) => Number.isNaN(value))) {
  console.error(`[next-fluent] Could not parse the coverage summary: ${summary.trim()}`);
  process.exit(1);
}

const [lines, branches, functions] = cells;
const measured = { lines, branches, functions };

const shortfalls = Object.entries(FLOORS)
  .filter(([metric, floor]) => measured[metric] < floor)
  .map(([metric, floor]) => `${metric} ${measured[metric]}% < ${floor}%`);

if (shortfalls.length > 0) {
  console.error(`[next-fluent] Coverage fell below the floor: ${shortfalls.join(', ')}.`);
  process.exit(1);
}

console.log(
  `[next-fluent] Coverage above the floor: ${lines}% lines, ${branches}% branches, ` +
    `${functions}% functions (floors ${FLOORS.lines}/${FLOORS.branches}/${FLOORS.functions}).`
);
