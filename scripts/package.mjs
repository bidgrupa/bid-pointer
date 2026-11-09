// Release packages, from the builds in dist*/ (`pnpm release` builds, tests and packages; the
// GitHub release workflow does the same):
//   node scripts/package.mjs [chrome] [firefox] [safari] [source]   (default: all four)
//
//   chrome   release/bid-pointer-chrome-<v>.zip             upload to the Chrome Web Store (and Edge
//                                                         Add-ons), or unzip and "Load unpacked"
//   firefox  release/bid-pointer-firefox-<v>-unsigned.xpi  upload to addons.mozilla.org, which signs it;
//                                                         `web-ext sign` takes dist-firefox/ itself
//   safari   release/bid-pointer-safari-<v>.zip             App Store Connect's packager, or Safari's
//                                                         "Add Temporary Extension…"
//   source   release/bid-pointer-source-<v>.zip             the committed sources (git archive HEAD),
//                                                         which Mozilla's reviewers rebuild from
//
// It refuses a build that isn't from the sources as they are now: the source zip must rebuild it exactly.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { buildId } from './source-hash.mjs';
import { filesOf, walk, writeZip } from './zip.mjs';

const OUT = 'release';

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

const known = ['chrome', 'firefox', 'safari', 'source'];
const targets = process.argv.slice(2);
for (const t of targets) if (!known.includes(t)) fail(`unknown target "${t}" (use ${known.join(', ')})`);
const wanted = (t) => targets.length === 0 || targets.includes(t);

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
for (const dir of ['dist', 'dist-firefox', 'dist-safari']) if (!existsSync(`${dir}/manifest.json`)) fail('no build yet; run `pnpm build`');
const id = buildId();
if (!readFileSync('dist-firefox/background.js', 'utf8').includes(JSON.stringify(id))) {
  fail(`the builds aren't from the sources as they are now (expected build ${id}); run \`pnpm build\``);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Chrome Web Store: the store gives the item its own ID, and refuses the pinned one in `key`. */
function packChrome() {
  const files = filesOf('dist').map((f) => {
    if (f.name !== 'manifest.json') return f;
    const { key, ...manifest } = JSON.parse(f.data.toString('utf8'));
    return { name: f.name, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
  });
  const zip = `${OUT}/bid-pointer-chrome-${version}.zip`;
  writeZip(zip, files);
  return zip;
}

function packFirefox() {
  const xpi = `${OUT}/bid-pointer-firefox-${version}-unsigned.xpi`;
  writeZip(xpi, filesOf('dist-firefox'));
  return xpi;
}

function packSafari() {
  const zip = `${OUT}/bid-pointer-safari-${version}.zip`;
  writeZip(zip, filesOf('dist-safari'));
  return zip;
}

/** The committed sources, as Mozilla's reviewers get them; they rebuild the add-on from this. */
function packSource() {
  const zip = `${OUT}/bid-pointer-source-${version}.zip`;
  rmSync(zip, { force: true });
  let inGit = false;
  try {
    inGit = git('rev-parse', '--is-inside-work-tree') === 'true';
  } catch {
    // not a checkout
  }
  if (inGit) {
    if (git('status', '--porcelain') !== '') console.warn('package: uncommitted changes are NOT in the source zip (it is built from HEAD)');
    git('archive', '--format=zip', `--prefix=bid-pointer-${version}/`, '-o', zip, 'HEAD');
  } else {
    console.warn('package: not a git checkout; zipping the files the build reads instead');
    const own = (path) => ({ name: `bid-pointer-${version}/${path.replace(/\\/g, '/')}`, data: readFileSync(path) });
    const paths = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'build.mjs', 'manifest.json', 'PRIVACY.md', 'README.md'];
    writeZip(zip, [...paths, ...walk('scripts'), ...walk('src'), ...walk('fonts')].map(own));
  }
  return zip;
}

mkdirSync(OUT, { recursive: true });
const outputs = [
  ...(wanted('chrome') ? [packChrome()] : []),
  ...(wanted('firefox') ? [packFirefox()] : []),
  ...(wanted('safari') ? [packSafari()] : []),
  ...(wanted('source') ? [packSource()] : []),
];
console.log(`bid Pointer ${version} (build ${id})`);
for (const file of outputs) console.log(`  ${file}`);
if (/TODO/.test(readFileSync('PRIVACY.md', 'utf8'))) {
  console.warn('package: PRIVACY.md still has TODOs; fill them in before submitting to a store (docs/public-release.md)');
}
