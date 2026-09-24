#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { generateTypeDeclarations } from '../dist/typegen.js';
import { pseudoLocalizeFtl } from '../dist/index.js';

const args = process.argv.slice(2);
const command = args[0];

if (command !== 'typegen' && command !== 'pseudo') {
  console.log(`Usage:
  next-fluent typegen --input <path-to-ftl-or-dir> --output <path-to-dts>
  next-fluent pseudo  --input <path-to-ftl> --output <path-to-ftl>`);
  process.exit(1);
}

let inputPath = '';
let outputPath = '';

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--input' || args[i] === '-i') {
    inputPath = args[++i];
  } else if (args[i] === '--output' || args[i] === '-o') {
    outputPath = args[++i];
  }
}

if (!inputPath || !outputPath) {
  console.error('Error: Both --input and --output are required.');
  process.exit(1);
}

const resolvedInput = path.resolve(process.cwd(), inputPath);
const resolvedOutput = path.resolve(process.cwd(), outputPath);

if (!fs.existsSync(resolvedInput)) {
  console.error(`Error: Input file or directory not found: ${resolvedInput}`);
  process.exit(1);
}

function collectFtlFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return [targetPath];
  }
  const files = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFtlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ftl')) {
      files.push(full);
    }
  }
  return files;
}

const ftlFiles = collectFtlFiles(resolvedInput);
if (ftlFiles.length === 0) {
  console.error(`Error: No .ftl files found in: ${resolvedInput}`);
  process.exit(1);
}

if (command === 'typegen') {
  const contents = ftlFiles.map((file) => fs.readFileSync(file, 'utf8'));
  const dtsContent = generateTypeDeclarations(contents);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, dtsContent, 'utf8');
  console.log(`[next-fluent] Successfully generated types for ${ftlFiles.length} catalog(s) at: ${outputPath}`);
} else if (command === 'pseudo') {
  const ftlContent = fs.readFileSync(ftlFiles[0], 'utf8');
  const pseudoContent = pseudoLocalizeFtl(ftlContent);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, pseudoContent, 'utf8');
  console.log(`[next-fluent] Successfully generated pseudo-locale at: ${outputPath}`);
}
