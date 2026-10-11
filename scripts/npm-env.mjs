/**
 * Environment for the child processes this repository starts itself.
 *
 * npm passes its own configuration to every script it runs as `npm_config_*`
 * environment variables. That is by design, and usually harmless — but a
 * command like `npm publish --dry-run` (or `npm install --dry-run`,
 * `npm_config_offline=true`, `npm_config_ignore_scripts=true`, …) leaks into the
 * test harnesses, and a *nested* `npm install` then reports
 * "added 54 packages in 2s" while writing nothing at all. The symptom is an
 * `ENOENT` on `node_modules/next/package.json` several steps later, far from the
 * cause — and it makes the documented dry run of the release workflow fail.
 *
 * The harnesses therefore build child environments through `cleanNpmEnv()`,
 * which drops that whole namespace (case-insensitively, because CI systems spell
 * it `NPM_CONFIG_*`) and keeps everything else: the config a user set on purpose
 * belongs to the outer npm invocation, not to the throwaway app this repository
 * builds and then deletes.
 */
const NPM_CONFIG_PREFIX = /^npm_config_/i;

/** `npm_config_*` keys inherited from the npm process that started this script. */
export function inheritedNpmConfigKeys() {
  return Object.keys(process.env).filter((key) => NPM_CONFIG_PREFIX.test(key));
}

/** A copy of the current environment without inherited npm configuration. */
export function cleanNpmEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of inheritedNpmConfigKeys()) delete env[key];
  return env;
}
