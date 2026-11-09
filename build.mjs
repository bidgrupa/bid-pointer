// Bundles the extension with esbuild, three times from the same source:
//   dist/          Chrome and Edge (Manifest V3)
//   dist-firefox/  Firefox and Zen (Manifest V2, see firefoxManifest)
//   dist-safari/   Safari on the Mac (Manifest V3, see safariManifest)
// Nothing secret goes in: every key and token is pasted by the person, on the options page.
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { privacyPage } from './scripts/privacy-page.mjs';
import { buildId } from './scripts/source-hash.mjs';

const watch = process.argv.includes('--watch');

/**
 * Firefox and Zen get Manifest V2. In Firefox's Manifest V3, screenshots
 * (tabs.captureVisibleTab) only work with activeTab, which Firefox grants for the toolbar
 * button or the shortcut but not for Pointer's own on-page button; in V2 the all-sites
 * permission covers them. Mozilla has no plans to retire V2.
 * Also: a background script instead of a service worker, a fixed add-on id, and the data
 * collection Mozilla requires new add-ons to declare. Chrome's `key` field is dropped.
 */
function firefoxManifest(chrome) {
  const m = {
    manifest_version: 2,
    name: chrome.name,
    version: chrome.version,
    description: chrome.description,
    icons: chrome.icons,
    browser_action: chrome.action,
    options_ui: chrome.options_ui,
    background: { scripts: ['background.js'], persistent: false },
    content_scripts: chrome.content_scripts,
    permissions: [...chrome.permissions, ...chrome.host_permissions],
    web_accessible_resources: chrome.web_accessible_resources.flatMap((r) => r.resources),
    commands: chrome.commands,
    browser_specific_settings: {
      gecko: {
        id: 'pointer@bid.hr',
        // 140: the first Firefox that asks for data_collection_permissions at install, which
        // stands in for Pointer's own consent screen (Mozilla's policy 6.2.1).
        strict_min_version: '140.0',
        data_collection_permissions: {
          // Sent to ClickUp and Z.ai with each task: the page address, a screenshot and text of
          // the clicked element, and which element was clicked. Send to ClickUp in Gmail and in
          // HubSpot's Help Desk sends the emails it's pressed on: their text, their senders and
          // their images and files, and (HubSpot) the ticket's name, owner and contact. The SEO
          // check sends the findings ticked on a page: its address, tags and texts. The person's
          // own ClickUp token and Z.ai key go to those services with every request.
          required: ['authenticationInfo', 'browsingActivity', 'websiteContent', 'websiteActivity', 'personalCommunications', 'personallyIdentifyingInfo'],
          // The browser and window size in the task footer; Firefox only allows this as optional,
          // and Pointer leaves it out for anyone who declines.
          optional: ['technicalAndInteraction'],
        },
      },
      // Firefox for Android reads data_collection_permissions from 142 on
      gecko_android: { strict_min_version: '142.0' },
    },
  };
  return m;
}

/**
 * Safari takes Chrome's Manifest V3 as it is, `chrome.*` promises included, with three changes:
 * a background page instead of the service worker (the form Safari's own template uses; in V3
 * it's non-persistent all the same), no Chrome `key`, and icons up to 1024 px, because Apple's
 * packager makes the Mac app's icon from the largest one. Safari ignores keys it doesn't know.
 */
function safariManifest(chrome) {
  const { key, background, ...rest } = chrome;
  return {
    ...rest,
    icons: { ...chrome.icons, 512: 'icons/512.png', 1024: 'icons/1024.png' },
    background: { scripts: ['background.js'] },
    browser_specific_settings: { safari: { strict_min_version: '17.0' } },
  };
}

const copyStatic = (outdir, manifest) => {
  writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync('src/options/options.html', `${outdir}/options.html`);
  writeFileSync(`${outdir}/privacy.html`, privacyPage(readFileSync('PRIVACY.md', 'utf8')));
  // only the sizes this build's manifest names: Safari's big ones stay out of the other builds
  for (const icon of new Set(Object.values(manifest.icons))) if (existsSync(icon)) cpSync(icon, `${outdir}/${icon}`);
  if (existsSync('fonts')) cpSync('fonts', `${outdir}/fonts`, { recursive: true });
};

/**
 * CSS imported from TypeScript (the shadow-root styles) is bundled on its own, @imports
 * included, and handed to the script as a string. CSS entry points stay regular CSS files.
 */
const cssAsText = (target) => ({
  name: 'css-as-text',
  setup(build) {
    // The path is relative to the project: esbuild writes it into the bundle as a comment, and an
    // absolute one would name the folder it was built in, so no other machine could rebuild it exactly.
    build.onResolve({ filter: /\.css$/ }, (args) =>
      args.kind === 'import-statement'
        ? { path: relative(process.cwd(), resolve(args.resolveDir, args.path)).replace(/\\/g, '/'), namespace: 'css-text' }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: 'css-text' }, async (args) => {
      const result = await esbuild.build({
        entryPoints: [resolve(args.path)],
        bundle: true,
        write: false,
        minify: !watch,
        metafile: true,
        target,
        logLevel: 'silent',
      });
      return {
        contents: result.outputFiles[0].text,
        loader: 'text',
        watchFiles: Object.keys(result.metafile.inputs).map((p) => resolve(p)),
      };
    });
  },
});

const chromeManifest = () => JSON.parse(readFileSync('manifest.json', 'utf8'));

/**
 * One id per build, baked into the page script and the background alike. If the extension's
 * files are replaced without reloading it (unzipping over it, or loading dist/ while it's rebuilt),
 * new pages get the new page script while the old background keeps running; the page script
 * notices the ids differ and asks for a reload instead of sending things the old one would drop.
 * It comes from the sources, not the clock (see scripts/source-hash.mjs).
 */
const BUILD = buildId();

// Shadow-root CSS for Chrome and Firefox is lowered for both browsers at once.
const CSS_TARGET = ['chrome120', 'firefox140'];
const targets = [
  { outdir: 'dist', browser: 'chrome', target: ['chrome120'], cssTarget: CSS_TARGET, define: {}, manifest: () => chromeManifest() },
  // Firefox's promise-based API is `browser`; in its Manifest V2, `chrome.*` only takes callbacks.
  { outdir: 'dist-firefox', browser: 'firefox', target: ['firefox140'], cssTarget: CSS_TARGET, define: { chrome: 'browser' }, manifest: () => firefoxManifest(chromeManifest()) },
  // Safari 17 (2023) runs on macOS 12 and later.
  { outdir: 'dist-safari', browser: 'safari', target: ['safari17'], cssTarget: ['safari17'], define: {}, manifest: () => safariManifest(chromeManifest()) },
];

const contexts = [];
for (const t of targets) {
  rmSync(t.outdir, { recursive: true, force: true });
  mkdirSync(t.outdir, { recursive: true });
  contexts.push(
    await esbuild.context({
      entryPoints: [
        { in: 'src/content/detector.ts', out: 'detector' },
        { in: 'src/content/index.ts', out: 'content' },
        { in: 'src/gmail/index.ts', out: 'gmail' },
        { in: 'src/hubspot/index.ts', out: 'hubspot' },
        { in: 'src/background/index.ts', out: 'background' },
        { in: 'src/options/options.ts', out: 'options' },
        { in: 'src/options/options.css', out: 'options' },
      ],
      bundle: true,
      format: 'iife',
      target: t.target,
      outdir: t.outdir,
      sourcemap: watch ? 'inline' : false,
      // fonts are referenced by relative url() and copied as-is into <outdir>/fonts
      external: ['*.otf'],
      define: { __POINTER_BROWSER__: JSON.stringify(t.browser), __POINTER_BUILD__: JSON.stringify(BUILD), ...t.define },
      logLevel: 'info',
      plugins: [cssAsText(t.cssTarget), { name: 'copy-static', setup: (b) => b.onEnd(() => copyStatic(t.outdir, t.manifest())) }],
    }),
  );
}

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Pointer: watching for changes… (load dist/ in Chrome or Edge, dist-firefox/ in Firefox or Zen, dist-safari/ in Safari)');
} else {
  for (const c of contexts) {
    await c.rebuild();
    await c.dispose();
  }
}
