#!/usr/bin/env node
// Gates kernel purity: empty dependencies, no node builtins, no adapters.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const kernelPkgPath = join(root, 'packages', 'kernel', 'package.json');
const kernelSrc = join(root, 'packages', 'kernel', 'src');

function fail(message) {
  process.stderr.write(`kernel purity check failed: ${message}\n`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(kernelPkgPath, 'utf8'));
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  fail('packages/kernel must keep "dependencies" empty');
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const banned = [/from\s+['"]node:/, /require\(/, /['"]@evogen\/adapter-/, /['"]@evogen\/cli/];
for (const file of listFiles(kernelSrc)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of banned) {
      if (pattern.test(line)) {
        fail(`${file}:${index + 1} matches ${pattern}: ${line.trim()}`);
      }
    }
  });
}

process.stdout.write('kernel purity: OK (no dependencies, no node builtins, no adapter imports)\n');
