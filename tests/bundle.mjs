// Bundles TypeScript modules for the pure-logic tests, since node can't import .ts by itself.
import * as esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every export of the given source files (paths from the repo root), as one module. */
export async function load(...files) {
  const dir = mkdtempSync(join(tmpdir(), 'pointer-test-'));
  const entry = join(dir, 'entry.ts');
  const src = (p) => join(process.cwd(), p).replace(/\\/g, '/');
  writeFileSync(entry, files.map((f) => `export * from '${src(f)}';`).join('\n'));
  const out = join(dir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    logLevel: 'silent',
    define: { __POINTER_BROWSER__: '"chrome"', __POINTER_BUILD__: '"test"' },
  });
  return import(pathToFileURL(out).href);
}
