import { cp, mkdir, rm, symlink, unlink, rename } from 'node:fs/promises';
import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'test', 'fixtures', 'next-app');
const target = join(root, `.next-integration-${process.pid}`);
let linked = false;

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function checkBrowser(base) {
  const npmEntry = process.env.npm_execpath;
  if (!npmEntry) throw new Error('Browser integration requires an npm script.');
  const npxCli = join(dirname(npmEntry), 'npx-cli.js');
  const session = `-s=next-fluent-${process.pid}`;
  const run = (...args) => {
    const result = spawnSync(process.execPath, [
      npxCli, '--yes', '--package', '@playwright/cli@0.1.21',
      'playwright-cli', session, ...args,
    ], { cwd: target, encoding: 'utf8', timeout: 45000 });
    if (result.error) throw result.error;
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status !== 0) throw new Error(`Playwright CLI failed: ${args.join(' ')}\n${output}`);
    return output;
  };
  try {
    run('open', `${base}/ru`);
    const snapshot = run('snapshot');
    const link = /link "Switch to English" \[ref=([^\]]+)\]/.exec(snapshot);
    if (!snapshot.includes('heading "Привет') || !snapshot.includes('paragraph') || !link) {
      throw new Error(`Browser did not hydrate the Russian page correctly.\n${snapshot}`);
    }
    const beforeErrors = run('console', 'error').split('\n').filter((line) =>
      line.startsWith('[ERROR]') && !line.includes('/favicon.ico')
    );
    if (beforeErrors.length) throw new Error(`Browser errors before navigation:\n${beforeErrors.join('\n')}`);
    run('click', link[1]);
    const after = run('snapshot');
    if (!after.includes('Page URL:') || !after.includes('/about-us') || !after.includes('About route')) {
      throw new Error(`Browser locale switch failed.\n${after}`);
    }
    if (!run('cookie-get', 'NEXT_LOCALE').includes('NEXT_LOCALE=en')) {
      throw new Error('Browser locale switch did not update the cookie.');
    }
    const afterErrors = run('console', 'error').split('\n').filter((line) =>
      line.startsWith('[ERROR]') && !line.includes('/favicon.ico')
    );
    if (afterErrors.length) throw new Error(`Browser errors after navigation:\n${afterErrors.join('\n')}`);
    console.log('[next-fluent] Browser hydration and locale switch checks passed.');
  } finally {
    try { run('close'); } catch { /* Preserve the original check error. */ }
  }
}

async function checkRuntime(nextCli) {
  const port = await availablePort();
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [nextCli, 'start', '--hostname', 'localhost', '--port', String(port)], {
    cwd: target,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 30000;
    let home;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Next server exited early.\n${output}`);
      try {
        home = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!home) throw new Error(`Next server did not start.\n${output}`);
    const homeHtml = await home.text();
    if (home.status !== 200 || homeHtml.split('Next Fluent').length < 3 || homeHtml.split('Hello').length < 3) {
      throw new Error(`Default locale root failed (${home.status}, location: ${home.headers.get('location')}).\n${output}`);
    }
    const russian = await fetch(`${base}/ru`, { redirect: 'manual' });
    const russianHtml = await russian.text();
    if (russian.status !== 200 || russianHtml.split('Привет').length < 3 ||
        !russianHtml.includes('data-server-locale="ru"') ||
        !russianHtml.includes('data-header-locale="ru"')) {
      throw new Error(`Russian RSC/client locale mismatch (${russian.status}).\n${russianHtml.slice(0, 1500)}\n${output}`);
    }
    const localized = await fetch(`${base}/ru/o-nas`, { redirect: 'manual' });
    const localizedHtml = await localized.text();
    if (localized.status !== 200 || !localizedHtml.includes('About route') || !localizedHtml.includes('lang="ru"')) {
      throw new Error(`Localized route failed (${localized.status}).\n${localizedHtml.slice(0, 500)}\n${output}`);
    }
    const switched = await fetch(`${base}/en/about-us`, {
      redirect: 'manual',
      headers: { cookie: 'NEXT_LOCALE=ru' },
    });
    if (![307, 308].includes(switched.status) || new URL(switched.headers.get('location'), base).pathname !== '/about-us') {
      throw new Error(`Explicit default locale switch failed (${switched.status}).\n${output}`);
    }
    if (!switched.headers.get('set-cookie')?.includes('NEXT_LOCALE=en')) {
      throw new Error('Explicit locale switch did not update the locale cookie.');
    }
    console.log('[next-fluent] Next runtime routing and RSC checks passed.');
    if (process.env.NEXT_FLUENT_BROWSER === '1') checkBrowser(base);
  } finally {
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
}

try {
  await cp(fixture, target, { recursive: true });
  const nextPackage = JSON.parse(readFileSync(join(root, 'node_modules', 'next', 'package.json'), 'utf8'));
  if (Number.parseInt(nextPackage.version, 10) >= 16) {
    await rename(join(target, 'middleware.ts'), join(target, 'proxy.ts'));
  }
  await mkdir(join(target, 'node_modules'), { recursive: true });
  await symlink(root, join(target, 'node_modules', 'next-fluent'),
    process.platform === 'win32' ? 'junction' : 'dir');
  linked = true;
  const nextCli = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const result = spawnSync(process.execPath, [nextCli, 'build'], {
    cwd: target,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Next integration build failed (${result.status}).`);
  await checkRuntime(nextCli);
} finally {
  const resolvedRoot = realpathSync(root);
  const resolvedTarget = existsSync(target) ? realpathSync(target) : target;
  if (!resolvedTarget.toLowerCase().startsWith((resolvedRoot + sep).toLowerCase())) {
    throw new Error('Unsafe integration fixture cleanup path.');
  }
  if (linked) await unlink(join(resolvedTarget, 'node_modules', 'next-fluent'));
  await rm(resolvedTarget, { recursive: true, force: true });
}
