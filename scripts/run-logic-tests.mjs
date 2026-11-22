// Bundles scripts/tests/*.test.ts with esbuild (resolving "@/" to src/) and runs them with node.
import { build } from 'esbuild';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'scripts', 'tests');
const out = mkdtempSync(join(tmpdir(), 'pos-tests-'));

const entries = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'));
let failed = false;
for (const file of entries) {
  const outfile = join(out, file.replace(/\.ts$/, '.mjs'));
  await build({
    entryPoints: [join(testsDir, file)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'error',
    alias: { '@': join(root, 'src') },
    define: { 'import.meta.env': '{}' },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  console.log(`\n${file}`);
  try {
    await import(pathToFileURL(outfile).href);
  } catch (err) {
    failed = true;
    console.error(err);
  }
}
// Plain CommonJS tests (for the Electron side) run as they are.
for (const file of readdirSync(testsDir).filter((f) => f.endsWith('.test.cjs'))) {
  console.log(`
${file}`);
  try {
    await import(pathToFileURL(join(testsDir, file)).href);
  } catch (err) {
    failed = true;
    console.error(err);
  }
}
process.exit(failed ? 1 : 0);
