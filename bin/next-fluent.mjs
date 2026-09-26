#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pseudoLocalizeFtl } from '../dist/pseudo.js';
import { checkCatalogs, formatCheckReport } from '../dist/check.js';
import {
  collectCatalogFiles,
  readCatalog,
  readCatalogsByLocale,
  watchCatalogs,
  writeTypeDeclarations,
  DEFAULT_CATALOG_DIRS,
} from '../dist/catalog-io.js';

const USAGE = `Usage:
  next-fluent typegen [--input <path>] [--output <path>] [--watch]
  next-fluent check   [--input <path>] [--reference <locale>] [--json]
  next-fluent pseudo  --input <path> --output <path>

Commands:
  typegen  Generate TypeScript declarations for message keys and arguments
  check    Compare every locale catalog against a reference locale
  pseudo   Generate pseudo-localized catalogs for layout testing

Options:
  -i, --input       Catalog file or directory (default: ./messages, ./locales or ./src/messages)
  -o, --output      Output .d.ts (typegen) or .ftl file/directory (pseudo)
  -r, --reference   Reference locale for "check" (default: first locale, sorted)
  -w, --watch       Regenerate on catalog changes (typegen)
      --json        Machine-readable output (check)
  -h, --help        Show this help message`;

const DEFAULT_TYPEGEN_OUTPUT = 'next-fluent.d.ts';

/** Resolves `--input`, falling back to the conventional catalog directories. */
function resolveInputPath(explicit) {
  if (explicit) {
    const resolved = path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: Input file or directory not found: ${resolved}`);
      process.exit(1);
    }
    return resolved;
  }
  for (const candidate of DEFAULT_CATALOG_DIRS) {
    const full = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(full)) return full;
  }
  console.error(
    `Error: No catalog directory found. Looked for ${DEFAULT_CATALOG_DIRS.join(', ')} — or pass --input <path>.`
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

if (!['typegen', 'check', 'pseudo'].includes(command)) {
  console.error(`Error: Unknown command "${command}".\n\n${USAGE}`);
  process.exit(1);
}

const options = { input: '', output: '', reference: '', watch: false, json: false };

for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  const take = (flag, short) => {
    if (arg === flag || (short && arg === short)) return argv[++i];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    if (short && arg.startsWith(`${short}=`)) return arg.slice(short.length + 1);
    return undefined;
  };

  const input = take('--input', '-i');
  if (input !== undefined) { options.input = input; continue; }
  const output = take('--output', '-o');
  if (output !== undefined) { options.output = output; continue; }
  const reference = take('--reference', '-r');
  if (reference !== undefined) { options.reference = reference; continue; }
  if (arg === '--watch' || arg === '-w') { options.watch = true; continue; }
  if (arg === '--json') { options.json = true; continue; }
  if (arg === '--help' || arg === '-h') { console.log(USAGE); process.exit(0); }

  console.error(`Error: Unknown option "${arg}".\n\n${USAGE}`);
  process.exit(1);
}

const inputPath = resolveInputPath(options.input);

// ---------------------------------------------------------------------------
// typegen
// ---------------------------------------------------------------------------

if (command === 'typegen') {
  const output = path.resolve(process.cwd(), options.output || DEFAULT_TYPEGEN_OUTPUT);
  const files = collectCatalogFiles(inputPath);
  if (files.length === 0) {
    console.error(`Error: No catalogs found in ${inputPath}.`);
    process.exit(1);
  }

  const result = writeTypeDeclarations(inputPath, output);
  console.log(
    result.changed
      ? `[next-fluent] Generated types for ${result.files.length} catalog(s) at: ${path.relative(process.cwd(), result.output)}`
      : `[next-fluent] Types already up to date: ${path.relative(process.cwd(), result.output)}`
  );

  if (!options.watch) process.exit(0);

  console.log(`[next-fluent] Watching ${path.relative(process.cwd(), inputPath)} for changes…`);
  const stop = watchCatalogs(inputPath, output, {
    onUpdate: (next) =>
      console.log(
        `[next-fluent] Regenerated types for ${next.files.length} catalog(s) at: ${path.relative(process.cwd(), next.output)}`
      ),
    onError: (error) => console.error(`[next-fluent] Type generation failed: ${error.message}`),
  });
  const shutdown = () => {
    stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

if (command === 'check') {
  if (!fs.statSync(inputPath).isDirectory()) {
    console.error('Error: "check" needs a directory with one catalog per locale.');
    process.exit(1);
  }

  const catalogs = readCatalogsByLocale(inputPath);

  const locales = Object.keys(catalogs);
  if (locales.length < 2) {
    console.error(
      `Error: "check" needs at least two locales, found ${locales.length}. ` +
        'Expected e.g. messages/en.ftl and messages/ru.ftl, or messages/en/ and messages/ru/.'
    );
    process.exit(1);
  }

  const report = checkCatalogs(catalogs, { referenceLocale: options.reference || undefined });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCheckReport(report));
  }

  process.exit(report.issues.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// pseudo
// ---------------------------------------------------------------------------

if (command === 'pseudo') {
  const outputArg = options.output;
  if (!outputArg) {
    console.error('Error: --output is required for "pseudo".');
    process.exit(1);
  }

  const resolvedOutput = path.resolve(process.cwd(), outputArg);
  const files = collectCatalogFiles(inputPath);
  if (files.length === 0) {
    console.error(`Error: No catalogs found in ${inputPath}.`);
    process.exit(1);
  }

  if (fs.statSync(inputPath).isDirectory()) {
    if (resolvedOutput.endsWith('.ftl')) {
      console.error('Error: --output must be a directory when --input is a directory.');
      process.exit(1);
    }
    for (const file of files) {
      const relative = path.relative(inputPath, file).replace(/\.json$/i, '.ftl');
      const dest = path.join(resolvedOutput, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, pseudoLocalizeFtl(readCatalog(file)), 'utf8');
    }
    console.log(
      `[next-fluent] Generated pseudo-locales for ${files.length} file(s) at: ${outputArg}`
    );
  } else {
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, pseudoLocalizeFtl(readCatalog(files[0])), 'utf8');
    console.log(`[next-fluent] Generated pseudo-locale at: ${outputArg}`);
  }
}
