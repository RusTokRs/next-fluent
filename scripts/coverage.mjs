#!/usr/bin/env node
/**
 * Coverage gate.
 *
 * The audit reports have quoted coverage numbers since pass 15, and every one of
 * them came from an ad-hoc `node --test --experimental-test-coverage` invocation
 * that nothing recorded and nothing enforced. This makes the number a checked
 * artifact.
 *
 * Two decisions worth stating.
 *
 * The report is scoped to `dist/`. Node's `# all files` row otherwise averages in
 * the test files and the scripts that run them, which measures the harness rather
 * than the library — and it moves whenever a test defines a stub callback that is
 * never called. That is not hypothetical: it is exactly how the first version of
 * this gate came to report 95.72% functions for a library that is at 96.80%.
 *
 * The floors are Node's own `--test-coverage-*` thresholds rather than a parsed
 * comparison, so the runner decides and sets the exit code. They sit a little
 * under the current figures rather than on them: a gate that must be edited every
 * time a branch is added teaches people to edit the gate.
 *
 * Coverage is measured against `dist/` because that is what ships; `check-dist`
 * keeps it in sync with `src/`.
 */
import { spawnSync } from 'node:child_process';

const FLOORS = { lines: 97, branches: 93, functions: 96.5 };

const run = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=dist/**',
    `--test-coverage-lines=${FLOORS.lines}`,
    `--test-coverage-branches=${FLOORS.branches}`,
    `--test-coverage-functions=${FLOORS.functions}`,
    'test/*.test.mjs',
  ],
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, cwd: process.cwd() }
);

if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);

if (run.status !== 0) {
  console.error(
    `[next-fluent] Coverage or the test suite failed (exit ${run.status}). ` +
      `Floors for dist/: ${FLOORS.lines}% lines, ${FLOORS.branches}% branches, ${FLOORS.functions}% functions.`
  );
  process.exit(run.status ?? 1);
}

const summary = (run.stdout ?? '')
  .split('\n')
  .find((line) => /^\s*#\s*all files\s*\|/.test(line));

console.log(
  summary
    ? `[next-fluent] Coverage above the floor (dist/ only): ${summary.split('|').slice(1, 4).map((c) => c.trim()).join('% / ')}%.`
    : '[next-fluent] Coverage above the floor.'
);
