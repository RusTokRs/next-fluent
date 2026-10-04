/**
 * `dist/` freshness gate.
 *
 * `git diff --exit-code dist/` answers "did the build change a *tracked*
 * file?" — a brand-new build artifact (a new module, a new CJS chunk) is
 * untracked and therefore invisible to it. This check uses `git status
 * --porcelain -uall` so a missing commit is caught as well.
 *
 * Run with `npm run check-dist` (part of `npm run ci`); the build is expected
 * to have run already.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const status = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all', '--', 'dist/'],
  { cwd: root, encoding: 'utf8' }
);

if (status.trim().length > 0) {
  console.error('[next-fluent] dist/ differs from the committed build:');
  console.error(status.trimEnd());
  process.exit(1);
}

console.log('[next-fluent] dist/ is in sync with src/.');
