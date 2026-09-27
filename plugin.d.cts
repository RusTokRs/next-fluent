// CommonJS typings for `next-fluent/plugin`.
//
// `next.config.js` is CommonJS in most apps, so this entry point ships a real
// CJS build whose `module.exports` *is* the factory. `export =` mirrors that,
// where the ESM `.d.ts` uses a default export.
//
// This must be a value import: `import type` would re-export a type only, and
// `require('next-fluent/plugin')(config)` would fail to typecheck (TS1361).
import createNextFluentPlugin from './dist/plugin.js';

export = createNextFluentPlugin;
