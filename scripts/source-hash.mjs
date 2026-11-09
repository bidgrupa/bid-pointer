// The sources' fingerprint: build.mjs bakes it into every script as the build id, and
// package.mjs checks a build against it before packaging, so the source zip rebuilds it exactly.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function* filesIn(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* filesIn(path);
    else yield path.replace(/\\/g, '/');
  }
}

/** Every source file whose text ends up in a build, as forward-slash paths in a fixed order. */
export const sourceFiles = () => ['manifest.json', 'PRIVACY.md', ...filesIn('src')];

/**
 * A hash of the sources, not the time, so the same sources always build the same files: Mozilla's
 * reviewers rebuild the add-on from its source and expect no difference. Line endings don't count,
 * so a Windows checkout and a Linux one agree.
 */
export function sourceHash() {
  const hash = createHash('sha256');
  for (const file of sourceFiles()) hash.update(`${file}\n${readFileSync(file, 'utf8').replace(/\r\n/g, '\n')}\n`);
  return hash.digest('hex').slice(0, 8);
}

/** The build id a build of these sources carries. */
export const buildId = () => `${JSON.parse(readFileSync('manifest.json', 'utf8')).version}-${sourceHash()}`;
