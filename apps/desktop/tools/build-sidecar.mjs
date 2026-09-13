// Builds the standalone evogen sidecar binary via Node.js Single Executable
// Application: bundle the CLI with esbuild, inject the blob into a copy of the
// local Node runtime with postject.
// Output: apps/desktop/src-tauri/resources/binaries/evogen-cli(.exe)
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(desktopDir, '..', '..');
const outDir = join(desktopDir, 'src-tauri', 'resources', 'binaries');
const suffix = process.platform === 'win32' ? '.exe' : '';
const binaryPath = join(outDir, `evogen-cli${suffix}`);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 0. Make sure every workspace package is compiled (CI has no prior build).
execSync('pnpm -r build', { cwd: repoRoot, stdio: 'inherit' });

// 1. Bundle the CLI (pure JS, no native deps) into one CommonJS file.
const bundle = join(outDir, 'evogen-cli.cjs');
execSync(
  `pnpm exec esbuild packages/cli/src/index.ts --bundle --platform=node --format=cjs ` +
    `--outfile="${bundle}" --log-level=warning`,
  { cwd: repoRoot, stdio: 'inherit' },
);

// 2. Produce the SEA blob.
const seaConfig = join(outDir, 'sea-config.json');
const blob = join(outDir, 'evogen-cli.blob');
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execSync(`node --experimental-sea-config "${seaConfig}"`, { stdio: 'inherit' });

// 3. Copy the Node runtime and inject the blob.
copyFileSync(process.execPath, binaryPath);
if (process.platform === 'darwin') {
  execSync(`codesign --remove-signature "${binaryPath}"`, { stdio: 'inherit' });
}
const postject = [
  'postject',
  `"${binaryPath}"`,
  'NODE_SEA_BLOB',
  `"${blob}"`,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite',
];
execSync(`pnpm exec ${postject.join(' ')}`, { cwd: repoRoot, stdio: 'inherit' });
if (process.platform === 'darwin') {
  execSync(`codesign --sign - "${binaryPath}"`, { stdio: 'inherit' });
}

// 4. Keep only the binary.
rmSync(bundle, { force: true });
rmSync(seaConfig, { force: true });
rmSync(blob, { force: true });

console.log(`sidecar written: ${binaryPath}`);
