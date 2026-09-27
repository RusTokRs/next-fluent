/** Real multi-origin browser regression: TLS proxy -> a production Next server. */
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = await mkdtemp(join(root, '.next-integration-domains-'));
let server, proxy, browser;
let serverOutput = '';
const errors = [];
const requests = [];

function run(command, args, cwd = target, env = process.env, stdio = 'inherit') {
  const result = spawnSync(command, args, { cwd, env, stdio });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}
async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '0.0.0.0', resolve));
  return server.address().port;
}
async function freePort() {
  const socket = createTcpServer();
  const port = await listen(socket);
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

try {
  await cp(join(root, 'test/fixtures/next-app'), target, { recursive: true });
  await cp(join(root, 'test/fixtures/domain-app'), target, { recursive: true });
  await mkdir(join(target, 'node_modules'), { recursive: true });
  const nextVersion = process.env.NEXT_FLUENT_NEXT_VERSION;
  if (nextVersion) run('npm', ['install', '--no-save', '--no-audit', '--no-fund', `next@${nextVersion}`, 'react@19', 'react-dom@19']);
  await symlink(root, join(target, 'node_modules/next-fluent'), process.platform === 'win32' ? 'junction' : 'dir');
  const nextRoot = join(nextVersion ? target : root, 'node_modules/next');
  const version = JSON.parse(await readFile(join(nextRoot, 'package.json'), 'utf8')).version;
  if (parseInt(version, 10) >= 16) await rename(join(target, 'middleware.ts'), join(target, 'proxy.ts'));
  const nextCli = join(nextRoot, 'dist/bin/next');
  const backendPort = await freePort();

  // Certificates and keys are ephemeral test artifacts, never shipped or committed.
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=*.next-fluent.test', '-keyout', 'test-key.pem', '-out', 'test-cert.pem'], target, process.env, 'pipe');
  proxy = createHttpsServer({ key: await readFile(join(target, 'test-key.pem')), cert: await readFile(join(target, 'test-cert.pem')) }, (req, res) => {
    const upstream = httpRequest({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method,
      headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', (error) => { res.writeHead(502); res.end(error.message); });
    req.pipe(upstream);
  });
  const port = await listen(proxy);
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_DOMAIN_TEST_PORT: String(port) };
  console.log(`[next-fluent] Domain browser fixture: Next ${version}, TLS port ${port}`);
  run(process.execPath, [nextCli, 'build'], target, env);
  server = spawn(process.execPath, [nextCli, 'start', '--hostname', '0.0.0.0', '--port', String(backendPort)],
    { cwd: target, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Next startup timed out\n${serverOutput}`)), 30000);
    const collect = (data) => {
      serverOutput += data.toString();
      if (serverOutput.includes('Ready in')) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    server.once('error', (error) => { clearTimeout(timeout); reject(error); });
    server.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Next exited: ${code}\n${serverOutput}`)); });
  });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--host-resolver-rules=MAP *.next-fluent.test 127.0.0.1', '--no-proxy-server', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.includes('favicon.ico')) errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().includes('/_next/')) requests.push(`${request.method()} ${request.url()}`);
  });
  const url = (host, path) => `https://${host}.next-fluent.test:${port}/app${path}`;
  async function check(locale, host, path, internal = '/about') {
    await page.locator(`[data-hydrated="true"][data-client-locale="${locale}"]`).waitFor();
    assert.equal(await page.locator('main').getAttribute('data-server-locale'), locale);
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    assert.equal(await page.locator('[data-pathname]').getAttribute('data-pathname'), internal);
    assert.equal(page.url(), url(host, path));
    assert.deepEqual(errors, [], 'browser errors');
  }
  for (const [locale, host, path] of [
    ['en', 'en', '/about-us'], ['es', 'en', '/acerca'], ['de', 'eu', '/uber'],
    ['ru', 'eu', '/lang/ru/o-nas'], ['fr', 'fr', '/francais/a-propos'],
  ]) {
    await context.clearCookies();
    const response = await page.goto(url(host, path));
    assert.equal(response.status(), 200, `${locale} direct navigation: ${page.url()}`);
    await check(locale, host, path);
    const alternates = response.headers().link ?? '';
    for (const language of ['en', 'es', 'de', 'ru', 'fr']) assert.ok(alternates.includes(`hreflang="${language}"`), alternates);
    console.log(`  ✓ direct navigation, hydration, usePathname and alternates: ${locale}`);
  }

  // Custom prefixes must also rewrite roots and paths without localized slugs.
  for (const [locale, host, path, internal] of [
    ['en', 'en', '', '/'], ['de', 'eu', '', '/'], ['ru', 'eu', '/lang/ru', '/'],
    ['fr', 'fr', '/francais', '/'], ['ru', 'eu', '/lang/ru/shared', '/shared'],
    ['fr', 'fr', '/francais/shared', '/shared'],
  ]) {
    await context.clearCookies();
    assert.equal((await page.goto(url(host, path))).status(), 200);
    await check(locale, host, path, internal);
  }
  console.log('  ✓ roots and untranslated paths under custom prefixes');

  // Cross-origin links followed by a same-origin switch to its prefix-less default.
  await page.getByTestId('link-ru').click();
  await check('ru', 'eu', '/lang/ru/o-nas');
  await page.getByTestId('link-de').click();
  await check('de', 'eu', '/uber');
  assert.ok((await context.cookies(url('eu', '/'))).some((cookie) => cookie.name === 'NEXT_LOCALE' && cookie.value === 'de'));
  await page.reload();
  await check('de', 'eu', '/uber');
  console.log('  ✓ cross-domain Link and same-domain default-locale switch persist after reload');

  // In never mode an identical route gives no slug hint: the cookie must change.
  await page.getByTestId('shared-es').click();
  await check('es', 'en', '/shared', '/shared');
  await page.getByTestId('shared-en').click();
  await check('en', 'en', '/shared', '/shared');
  assert.ok((await context.cookies(url('en', '/'))).some((cookie) => cookie.name === 'NEXT_LOCALE' && cookie.value === 'en'));
  await page.reload();
  await check('en', 'en', '/shared', '/shared');
  console.log('  ✓ never locale switches on an ambiguous path persist after reload');

  await page.getByTestId('push-ru').click();
  await check('ru', 'eu', '/lang/ru/o-nas');
  await page.getByTestId('replace-de').click();
  await check('de', 'eu', '/uber');
  console.log('  ✓ router.push / router.replace across domain strategies');

  await context.clearCookies();
  const moved = await page.goto(url('en', '/lang/ru/o-nas?q=1'));
  assert.equal(moved.status(), 200);
  assert.equal(page.url(), url('eu', '/lang/ru/o-nas?q=1'));
  await page.locator('[data-hydrated="true"][data-client-locale="ru"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('  ✓ wrong-domain redirect retains custom prefix, basePath and search');
  // Next's own [id]/[...slug]/static routing must agree with localized links.
  for (const [kind, path, ruPath, value] of [
    ['single', '/docs/42', '/lang/ru/odin/42', '42'],
    ['many', '/docs/a/b', '/lang/ru/vse/a/b', 'a/b'],
    ['static', '/docs/new', '/lang/ru/novyi', 'new'],
  ]) {
    await context.clearCookies();
    const response = await page.goto(url('en', path));
    assert.equal(response.status(), 200);
    await check('en', 'en', path, path);
    assert.equal(await page.locator('main').getAttribute('data-route-kind'), kind);
    assert.ok((response.headers().link ?? '').includes(`<${url('eu', ruPath)}>`));
    await page.getByTestId(`${kind}-ru`).click();
    await check('ru', 'eu', ruPath, path);
    assert.equal(await page.locator('main').getAttribute('data-route-kind'), kind);
    assert.equal(await page.locator('main').getAttribute('data-route-value'), value);
  }
  console.log('  ✓ static / [id] / [...slug] routes, hreflang and locale-switch links agree');
  console.log('[next-fluent] Domain browser checks passed.');
} catch (error) {
  console.error(`Recent requests:\n${requests.slice(-30).join('\n')}\nBrowser errors:\n${errors.join('\n')}\nNext log:\n${serverOutput}`);
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
  if (proxy) { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
  await rm(target, { recursive: true, force: true });
}
