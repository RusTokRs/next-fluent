#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pseudoLocalizeFtl } from '../dist/pseudo.js';
import { checkCatalogs, formatCheckReport } from '../dist/check.js';
import { analyzeUsage, formatUsageReport } from '../dist/usage.js';
import {
  collectCatalogFiles,
  collectSourceFiles,
  readCatalog,
  readCatalogsByLocale,
  watchCatalogs,
  writeTypeDeclarations,
  DEFAULT_CATALOG_DIRS,
} from '../dist/catalog-io.js';

const USAGE = `Usage:
  next-fluent typegen [--input <path>] [--output <path>] [--watch]
  next-fluent check   [--input <path>] [--reference <locale>] [--json]
                      [--usage] [--src <dir>] [--allow-unused] [--strict-usage]
  next-fluent pseudo  --input <path> --output <path>

Commands:
  typegen  Generate TypeScript declarations for message keys and arguments
  check    Compare every locale catalog against a reference locale.
           With --usage also report catalog keys no call site references
  pseudo   Generate pseudo-localized catalogs for layout testing

Options:
  -i, --input       Catalog file or directory (default: ./messages, ./locales or ./src/messages)
  -o, --output      Output .d.ts (typegen) or .ftl file/directory (pseudo)
  -r, --reference   Reference locale for "check" (default: first locale, sorted)
  -w, --watch       Regenerate on catalog changes (typegen)
      --json        Machine-readable output (check)
      --usage       Also analyze source code usage against the catalog (check)
      --src         Source directory to scan for --usage (default: app, src, pages or components)
      --allow-unused  Do not report unused catalog keys
      --strict-usage  Make unused keys and dynamic call sites fail the command
  -h, --help        Show this help message`;

const DEFAULT_TYPEGEN_OUTPUT = 'next-fluent.d.ts';

/** Runs a step, turning thrown errors into a readable CLI failure. */
function runGuarded(step) {
  try {
    return step();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

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

const options = {
  input: '',
  output: '',
  reference: '',
  watch: false,
  json: false,
  usage: false,
  src: '',
  allowUnused: false,
  strictUsage: false,
  ignoreUnused: [],
};

for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  /**
   * Reads a flag's value. Returns `null` when this argument is not the flag, so
   * a flag that *is* known but has no value gets its own error instead of being
   * reported as an unknown option.
   */
  const take = (flag, short) => {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    if (short && arg.startsWith(`${short}=`)) return arg.slice(short.length + 1);
    if (arg === flag || (short && arg === short)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        console.error(`Error: "${arg}" requires a value.\n\n${USAGE}`);
        process.exit(1);
      }
      i++;
      return value;
    }
    return null;
  };

  const input = take('--input', '-i');
  if (input !== null) { options.input = input; continue; }
  const output = take('--output', '-o');
  if (output !== null) { options.output = output; continue; }
  const reference = take('--reference', '-r');
  if (reference !== null) { options.reference = reference; continue; }
  const src = take('--src');
  if (src !== null) { options.src = src; continue; }
  const ignoreUnused = take('--ignore-unused');
  if (ignoreUnused !== null) { options.ignoreUnused.push(ignoreUnused); continue; }
  if (arg === '--watch' || arg === '-w') { options.watch = true; continue; }
  if (arg === '--json') { options.json = true; continue; }
  if (arg === '--usage') { options.usage = true; continue; }
  if (arg === '--allow-unused') { options.allowUnused = true; continue; }
  if (arg === '--strict-usage') { options.strictUsage = true; continue; }
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

  const result = runGuarded(() => writeTypeDeclarations(inputPath, output));
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

  const catalogs = runGuarded(() => readCatalogsByLocale(inputPath));

  const locales = Object.keys(catalogs);
  // Cross-locale comparison needs a second catalog to compare against, but
  // usage analysis does not: a project that ships one locale so far should
  // still be able to find dead messages.
  if (locales.length < 1) {
    console.error(
      'Error: "check" found no catalogs. Expected e.g. messages/en.ftl, or messages/en/.'
    );
    process.exit(1);
  }
  if (locales.length < 2 && !options.usage) {
    console.error(
      `Error: "check" needs at least two locales, found ${locales.length}. ` +
        'Expected e.g. messages/en.ftl and messages/ru.ftl, or messages/en/ and messages/ru/.'
    );
    process.exit(1);
  }

  const report = runGuarded(() =>
    checkCatalogs(catalogs, { referenceLocale: options.reference || undefined })
  );

  let usageReport = null;
  if (options.usage) {
    const sourceDirs = (options.src ? [options.src] : ['app', 'src', 'pages', 'components'])
      .map((candidate) => path.resolve(process.cwd(), candidate))
      .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
    if (sourceDirs.length === 0) {
      console.error(
        'Error: --usage needs a source directory to scan. Pass --src <dir> ' +
          '(looked for app, src, pages, components).'
      );
      process.exit(1);
    }
    const files = sourceDirs.flatMap((dir) => collectSourceFiles(dir));
    const sources = files.map((file) => {
      const relative = path.relative(process.cwd(), file);
      return {
        // Outside the working directory a relative path would be all `..`;
        // the absolute one is more readable in a report.
        path: relative.startsWith('..') ? file : relative,
        content: fs.readFileSync(file, 'utf8'),
      };
    });
    usageReport = runGuarded(() =>
      analyzeUsage(catalogs, sources, {
        referenceLocale: options.reference || undefined,
        reportUnused: !options.allowUnused,
        ignore: options.ignoreUnused,
      })
    );
  }

  if (options.json) {
    console.log(JSON.stringify(usageReport ? { ...report, usage: usageReport } : report, null, 2));
  } else {
    console.log(formatCheckReport(report));
    if (usageReport) {
      console.log('');
      console.log(formatUsageReport(usageReport));
    }
  }

  // Locale drift always fails. Usage findings are graded: a key that is used
  // but absent, or an attrs call on a message without attributes, is a defect;
  // unused keys and dynamic call sites are advisories unless --strict-usage.
  const hardUsageIssues = usageReport
    ? usageReport.issues.filter((issue) => issue.kind === 'missing' || issue.kind === 'missing-attributes')
    : [];
  const softUsageIssues = usageReport
    ? usageReport.issues.filter((issue) => issue.kind === 'unused' || issue.kind === 'dynamic')
    : [];
  const failed =
    report.issues.length > 0 ||
    hardUsageIssues.length > 0 ||
    (options.strictUsage && softUsageIssues.length > 0);

  process.exit(failed ? 1 : 0);
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
      fs.writeFileSync(dest, runGuarded(() => pseudoLocalizeFtl(readCatalog(file))), 'utf8');
    }
    console.log(
      `[next-fluent] Generated pseudo-locales for ${files.length} file(s) at: ${outputArg}`
    );
  } else {
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, runGuarded(() => pseudoLocalizeFtl(readCatalog(files[0]))), 'utf8');
    console.log(`[next-fluent] Generated pseudo-locale at: ${outputArg}`);
  }
}
