// Browser smoke test: loads dist/ into a real Chrome/Edge, opens the fixture page on localhost
// and walks every UI state, saving screenshots to tests/out/ for visual review.
// The error paths hit the real APIs with fake keys (expecting 401s); the happy path mocks
// ClickUp and Z.ai inside the extension's service worker.
// Usage: node scripts/smoke.mjs [--browser=chrome|edge] [--headed] [--dir=path/to/unpacked/extension]
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixedSizeScript, resizingRecording } from './recording-check.mjs';
import { confettiAlpha, dockState, followers, launcherSpot, partyState, pressAndDrag, spinDock, wiggleDock } from './dock-check.mjs';
import { EMAIL_SPLIT, EMAIL_TASKS, GMAIL_URL, ORIGINAL, clearDue, gmailRoute, mailState, pickPerson, pressSend, reviewCreate, setDue, taskAction, toastButton } from './gmail-check.mjs';
import { HS_ATTACHED, HS_ORIGINAL, HUBSPOT_SPLIT, HUBSPOT_TASKS, HUBSPOT_URL, LUMEN, SHEET, hubspotRoute, hubspotState, pressHubSpotSend } from './hubspot-check.mjs';
import { SEO_HOST, SEO_PATH, SEO_PROJECT, runSeo, seoRoute } from './seo-check.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const browser = args.browser ?? 'chrome';
const executablePath =
  browser === 'edge'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dist = resolve(args.dir ?? 'dist');
const outDir = resolve('tests/out');
mkdirSync(outDir, { recursive: true });
if (!existsSync(resolve(dist, 'manifest.json'))) throw new Error('Run `pnpm build` first');

const fixture = readFileSync(resolve('tests/fixture/index.html'));
const server = createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
}).listen(8765);
const FIXTURE = 'http://localhost:8765/rooms/superior?x=1';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const savePng = (name, dataUrl) => writeFileSync(`${outDir}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
const inside = (r, vw, vh) => Boolean(r) && r.x >= 7.5 && r.y >= 7.5 && r.right <= vw - 7.5 && r.bottom <= vh - 7.5;

const b = await puppeteer.launch({
  executablePath,
  headless: !('headed' in args),
  enableExtensions: true, // Chrome 137+ ignores --load-extension; this uses the CDP install path instead
  // screen recording: accept sharing without the dialog, and record Chrome's synthetic test screen
  // (never the real one)
  args: ['--no-first-run', '--window-size=1280,900', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

try {
  const extensionId = await b.installExtension(dist);
  console.log('extension id', extensionId);
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const closeOptionsTabs = async () => {
    for (const p of await b.pages()) if (p.url().startsWith(optionsUrl)) await p.close();
  };

  // The options page calls ClickUp itself; this stub answers /user and /team for the tokens
  // pk_good and pk_mock and rejects everything else, like ClickUp does.
  const stubClickUp = (p) =>
    p.evaluateOnNewDocument(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.startsWith('https://api.clickup.com/api/v2/')) return realFetch(input, init);
        const ok = ['pk_good', 'pk_mock', 'pk_8216402_MOCK7Q2ZK3F7A'].includes(init.headers?.Authorization);
        const path = new URL(url).pathname.replace('/api/v2', '');
        let body = { err: 'Token invalid' };
        if (ok && path === '/user') body = { user: { id: 7, username: 'Ana Test', email: 'ana@bid.hr' } };
        if (ok && path === '/team/9014552433/space') body = { spaces: [{ id: '90142472614', name: 'DEVELOPMENT' }] };
        if (ok && path === '/space/90142472614/folder') body = { folders: [{ id: 'f1', name: 'Cresanka', lists: [{ id: '901417200456', name: 'Development' }] }] };
        if (ok && path === '/space/90142472614/list') body = { lists: [{ id: '901407290920', name: 'Bluesun' }] };
        if (ok && path === '/team')
          body = {
            teams: [
              {
                id: '9014552433',
                name: 'bid',
                members: [
                  { user: { id: 118313848, username: 'Mate' } },
                  { user: { id: 82460956, username: 'Tea Babić' } },
                  { user: { id: 106460192, username: 'Leo Babić' } },
                ],
              },
            ],
          };
        return new Response(JSON.stringify(body), { status: ok ? 200 : 401, headers: { 'Content-Type': 'application/json' } });
      };
    });

  // ---------- first run: the setup page ----------
  const setup = await b.newPage();
  await stubClickUp(setup);
  await setup.goto(optionsUrl, { waitUntil: 'load' });
  const worker = await b
    .waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(extensionId), { timeout: 15000 })
    .then((t) => t.worker());
  check('options page renders', (await setup.title()) === 'bid Pointer options', await setup.title());
  const visible = (sel) => setup.$eval(sel, (el) => el.offsetParent !== null);
  const currentStep = () => setup.$eval('#setupSteps .step.is-current', (el) => el.dataset.step).catch(() => null);
  check(
    'first run asks for the OK on what Pointer sends, before anything else',
    (await visible('#consentAgree')) && (await visible('.consent-list')) && !(await visible('#setupSteps')) && !(await visible('#defaultAssignee')),
  );
  check('the privacy policy ships with Pointer', (await setup.$eval('#consentList a[href="privacy.html"]', (el) => el.textContent)) === 'Privacy policy');
  await setup.evaluate(() => document.fonts.ready);
  await setup.screenshot({ path: `${outDir}/0-consent.png`, fullPage: true });
  await setup.click('#consentAgree');
  await delay(150);
  const consentAt = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.consentAt ?? '');
  check('agreeing is remembered, and the walkthrough appears', Boolean(Date.parse(consentAt)) && (await visible('#setupSteps')) && !(await visible('#consentAgree')), consentAt);
  check('what Pointer sends sits last on the page', await setup.evaluate(() => [...document.querySelectorAll('main > section')].at(-1)?.id === 'consentGroup'));
  check(
    'first run shows the three-step walkthrough',
    (await setup.$$eval('#setupSteps .step', (els) => els.length)) === 3 &&
      (await visible('#setupSteps')) &&
      !(await setup.$eval('#setupDone', (el) => el.offsetParent !== null)) &&
      (await currentStep()) === 'open',
  );
  check('first run hides the other settings', !(await visible('#defaultAssignee')) && !(await visible('#reviewBeforeSend')) && !(await visible('#spaceId')) && !(await visible('#zaiKey')));
  await setup.evaluate(() => document.fonts.ready);
  await setup.screenshot({ path: `${outDir}/0-setup.png`, fullPage: true });

  // step 1 opens ClickUp's Apps settings; coming back lands on step 3, ready to paste
  await setup.click('#openClickUp');
  const clickupTab = await b.waitForTarget((t) => t.url().startsWith('https://app.clickup.com/settings/apps'), { timeout: 5000 }).catch(() => null);
  check('step 1 opens ClickUp settings in a new tab', Boolean(clickupTab));
  check('step 2 is next while away', (await currentStep()) === 'copy');
  if (clickupTab) await (await clickupTab.page())?.close();
  await setup.bringToFront();
  await setup.evaluate(() => window.dispatchEvent(new Event('focus'))); // headless doesn't always send it
  await delay(150);
  check(
    'coming back focuses the paste field',
    (await currentStep()) === 'paste' &&
      (await setup.evaluate(() => document.activeElement?.id)) === 'clickupToken' &&
      /to paste your token/.test(await setup.$eval('#tokenStatus', (el) => el.textContent)),
    await setup.$eval('#tokenStatus', (el) => el.textContent),
  );
  await setup.screenshot({ path: `${outDir}/0-setup-paste.png` });
  await setup.type('#clickupToken', 'pk_bad');
  const rejected = await setup
    .waitForFunction(() => /didn't accept/.test(document.querySelector('#tokenStatus').textContent), { timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  check('a wrong token is explained', rejected, await setup.$eval('#tokenStatus', (el) => el.textContent));
  const inputType = () => setup.$eval('#clickupToken', (el) => el.type);
  await setup.click('#revealInput');
  const shownType = await inputType();
  const shownLabel = await setup.$eval('#revealInput', (el) => el.getAttribute('aria-label'));
  await setup.click('#revealInput');
  check('the eye shows and hides the pasted token', shownType === 'text' && shownLabel === 'Hide token' && (await inputType()) === 'password');
  await setup.screenshot({ path: `${outDir}/0-setup-wrong-token.png` });
  await setup.$eval('#clickupToken', (el) => {
    el.value = '';
  });
  await setup.type('#clickupToken', 'pk_good');
  const connected = await setup.waitForFunction(() => !document.querySelector('#setupDone').hidden, { timeout: 5000 }).then(
    () => true,
    () => false,
  );
  check('a good token connects without pressing anything', connected && /Ana Test/.test(await setup.$eval('#setupWho', (el) => el.textContent)));
  check('connecting reveals the other settings', (await visible('#defaultAssignee')) && (await visible('#reviewBeforeSend')) && !(await visible('#setupSteps')));
  const spaceChosen = await setup
    .waitForFunction(() => /2 projects in this space/.test(document.querySelector('#spaceStatus').textContent), { timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  const savedSpace = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings ?? {});
  check(
    'the only space is chosen by itself, with its projects counted',
    spaceChosen && savedSpace.spaceId === '90142472614' && savedSpace.spaceName === 'bid › DEVELOPMENT' && (await setup.$eval('#spaceId', (el) => el.value)) === '90142472614',
    `${savedSpace.spaceId} ${savedSpace.spaceName} ${await setup.$eval('#spaceStatus', (el) => el.textContent)}`,
  );
  check('then the page says all is set', /all set/.test(await setup.$eval('#setupNext', (el) => el.textContent)));
  check('without a Z.ai key, rewriting is off and says so', /Off: notes go to ClickUp as you wrote them/.test(await setup.$eval('#zaiState', (el) => el.textContent)));
  const savedText = () => setup.$eval('#tokenValue', (el) => el.textContent);
  check('the saved token starts hidden', !(await savedText()).includes('good') && /•/.test(await savedText()), await savedText());
  await setup.click('#revealSaved');
  check('the eye shows the saved token', (await savedText()) === 'pk_good', await savedText());
  await setup.screenshot({ path: `${outDir}/0-setup-token-shown.png` });
  await setup.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState; // back to the real value
  });
  check('switching tabs hides it again', (await savedText()) !== 'pk_good' && (await setup.$eval('#revealSaved', (el) => el.getAttribute('aria-pressed'))) === 'false');
  await b.defaultBrowserContext().overridePermissions(new URL(optionsUrl).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
  // The harness won't let a page read the clipboard back, so record what Copy writes.
  await setup.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
    };
  });
  await setup.click('#copyToken');
  await delay(100);
  check(
    'copy puts the token on the clipboard',
    (await setup.evaluate(() => window.__copied)) === 'pk_good' && (await setup.$eval('#copyToken', (el) => el.title)) === 'Copied',
  );
  // Automated profiles never bind extension shortcuts (not even the old default), so the browser
  // reports none here. The binding itself can't be tested; how each case is shown can.
  const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
  const suggested = manifest.commands['toggle-point-mode'].suggested_key.default;
  check('default shortcut is Alt+Shift+P, clear of AltGr', suggested === 'Alt+Shift+P' && !/Ctrl\+Alt|Alt\+Ctrl/.test(suggested), suggested);
  check('settings say when no shortcut is set', /None set/.test(await setup.$eval('#shortcutKeys', (el) => el.textContent)));
  const shortcutShown = async (shortcut) => {
    const p = await b.newPage();
    await p.evaluateOnNewDocument((s) => {
      chrome.commands.getAll = async () => [{ name: 'toggle-point-mode', description: '', shortcut: s }];
    }, shortcut);
    await p.goto(optionsUrl, { waitUntil: 'load' });
    await delay(300);
    const keys = await p.$$eval('#shortcutKeys kbd', (els) => els.map((el) => el.textContent).join('+'));
    const warning = await p.$eval('#shortcutWarning', (el) => el.textContent);
    await p.close();
    return { keys, warning };
  };
  const fresh = await shortcutShown('Alt+Shift+P');
  check('settings show Alt+Shift+P as keycaps', fresh.keys === 'Alt+Shift+P' && !fresh.warning, JSON.stringify(fresh));
  const stale = await shortcutShown('Ctrl+Shift+.');
  check('settings warn about the old Ctrl+Shift+. shortcut', stale.keys === 'Ctrl+Shift+.' && /Copilot/.test(stale.warning), JSON.stringify(stale));
  check(
    'token and its owner are saved',
    await worker.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return settings.clickupToken === 'pk_good' && settings.clickupUser?.username === 'Ana Test';
    }),
  );
  // the default assignee: a dropdown of the workspace, starting on no one (nobody is built in)
  const peopleLoaded = await setup
    .waitForFunction(() => Boolean(document.querySelector('#defaultAssignee option[value="82460956"]')), { timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  check(
    'default assignee lists the team, starting on no one',
    peopleLoaded && (await setup.$eval('#defaultAssignee', (el) => el.value)) === '' && !(await setup.$eval('#defaultAssignee', (el) => el.disabled)),
  );
  await setup.screenshot({ path: `${outDir}/0-setup-done.png`, fullPage: true });
  const savedAssignee = () =>
    worker.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      return `${settings.assigneeId}|${settings.assigneeName}`;
    });
  await setup.select('#defaultAssignee', '118313848');
  await delay(300);
  check('default can be Mate', (await savedAssignee()) === '118313848|Mate', await savedAssignee());
  await setup.select('#defaultAssignee', '');
  await delay(300);
  check('default can be no one', (await savedAssignee()) === '|', await savedAssignee());
  await setup.select('#defaultAssignee', '82460956');
  await delay(300);
  check('default can be someone else', (await savedAssignee()) === '82460956|Tea Babić', await savedAssignee());

  // ---------- setup codes: copy this setup, then paste it into an empty one ----------
  const storedSettings = () => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  const patchStored = (p) =>
    worker.evaluate(async (v) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...v } });
    }, p);
  const team = { assigneeId: '118313848', assigneeName: 'Mate', codingAgent: true, sites: ['*-staging.vercel.app', '*-bid.vercel.app'], footerCredit: 'bid.agency, bid.hr', zaiKey: 'abc123.def456' };
  await patchStored(team);
  await setup.click('#setupCodeWithKey');
  await setup.click('#setupCodeCopy');
  await delay(300);
  const code = await setup.$eval('#setupCodeOut', (el) => el.value);
  check('a setup code is copied, the Z.ai key in it when asked', /^PTR1\.[\w-]+$/.test(code) && (await setup.evaluate(() => window.__copied)) === code, code.slice(0, 24));
  await patchStored({ assigneeId: '', assigneeName: '', codingAgent: false, sites: [], footerCredit: '', zaiKey: '' });
  await setup.reload({ waitUntil: 'load' });
  await delay(300);
  const codeStatus = () => setup.$eval('#setupCodeStatus', (el) => el.textContent);
  await setup.type('#setupCodeIn', 'pk_not_a_code');
  await delay(600);
  check("something that isn't a code is explained", /isn't a Pointer setup code/.test(await codeStatus()) && !(await visible('#setupCodeApply')), await codeStatus());
  await setup.$eval(
    '#setupCodeIn',
    (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input'));
    },
    `${code.slice(0, 60)}\n${code.slice(60)}`,
  );
  await delay(600);
  const preview = await setup.$eval('#setupCodePreview', (el) => el.textContent);
  check(
    'a pasted code shows what it sets before anything changes',
    (await visible('#setupCodeApply')) && /Mate, a coding agent/.test(preview) && /Z\.ai key: included/.test(preview) && (await storedSettings()).sites.length === 0,
    preview,
  );
  await setup.screenshot({ path: `${outDir}/0-setup-code.png`, fullPage: true });
  await Promise.all([setup.waitForNavigation({ waitUntil: 'load' }), setup.click('#setupCodeApply')]);
  await delay(300);
  const after = await storedSettings();
  check(
    "using it takes on the team's setup and keeps the token and the OK",
    after.assigneeId === '118313848' &&
      after.codingAgent === true &&
      after.sites.join() === team.sites.join() &&
      after.footerCredit === team.footerCredit &&
      after.zaiKey === team.zaiKey &&
      after.clickupToken === 'pk_good' &&
      Boolean(after.consentAt),
    JSON.stringify({ ...after, clickupToken: after.clickupToken ? 'set' : '' }),
  );
  check(
    'the page shows the new setup and says it took',
    /team's setup is in/.test(await codeStatus()) &&
      (await setup.$eval('#sites', (el) => el.value)) === team.sites.join('\n') &&
      (await setup.$eval('#codingAgent', (el) => el.checked)),
    await codeStatus(),
  );
  await closeOptionsTabs();

  const page = await b.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('console.error:', m.text());
  });

  // ---------- helpers for the shadow root ----------
  const sh = (sel, prop = 'textContent') =>
    page.evaluate(
      (s, p) => {
        const el = document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(s);
        return el ? (el[p] ?? null) : null;
      },
      sel,
      prop,
    );
  const shHas = (sel, cls) =>
    page.evaluate((s, c) => Boolean(document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(s)?.classList.contains(c)), sel, cls);
  const shRect = (sel) =>
    page.evaluate((s) => {
      const r = document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(s)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : null;
    }, sel);
  const shClick = (sel) => page.evaluate((s) => document.querySelector('#bid-pointer').shadowRoot.querySelector(s).click(), sel);
  const waitFor = (fn, ...a) => page.waitForFunction(fn, { timeout: 15000 }, ...a);
  const waitNote = (open) =>
    waitFor((o) => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note').classList.contains('is-open') === o, open);
  const waitReady = () => waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'));
  const viewport = () => page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.clientHeight]);
  const launcherShot = (name) => page.screenshot({ path: `${outDir}/${name}`, clip: { x: 1280 - 250, y: 800 - 84, width: 250, height: 84 } });
  // bid's own setup, as its people enter it on the options page, under every seed
  const BID_SETUP = { consentAt: new Date().toISOString(), sites: ['*-staging.vercel.app', '*-bid.vercel.app'], footerCredit: 'bid.agency, bid.hr', codingAgent: true };
  const setSettings = (s) => worker.evaluate((v) => chrome.storage.local.set({ settings: v }), { ...BID_SETUP, ...s });
  const patchSettings = (p) =>
    worker.evaluate(async (v) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...v } });
    }, p);
  const ctaCentre = async () => {
    const box = await (await page.$('.btn-primary')).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // ---------- no ClickUp token yet ----------
  await setSettings({ zaiKey: 'fake' });
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  check('content script injected', true);
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').classList.contains('needs-setup'));
  check('launcher flags the missing token', /ClickUp token/.test(await sh('.launcher', 'title')), await sh('.launcher', 'title'));
  check('launcher reads Set up Pointer', (await sh('.launcher-label'))?.trim() === 'Set up Pointer', await sh('.launcher-label'));
  await launcherShot('1-launcher-setup.png');
  await closeOptionsTabs();
  await shClick('.launcher');
  const setupOpened = await b.waitForTarget((t) => t.url().startsWith(optionsUrl), { timeout: 5000 }).then(
    () => true,
    () => false,
  );
  check('launcher opens setup instead of pointing', setupOpened && !(await shHas('.launcher', 'is-active')));
  await closeOptionsTabs();
  await page.bringToFront();
  check(
    'styles adopted as a constructed sheet',
    (await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.adoptedStyleSheets.length)) === 1,
  );

  // data: URL decoding used for the attachment upload
  const decoded = await worker.evaluate(async () => {
    const blob = globalThis.__pointer.dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    return { type: blob.type, size: blob.size };
  });
  check('dataUrlToBlob decodes PNG header', decoded.type === 'image/png' && decoded.size === 8, JSON.stringify(decoded));

  // ---------- fake keys: everything works up to the APIs, which answer 401 ----------
  // Saving a token, as the setup page does, makes an already open page ready without a reload.
  await setSettings({ zaiKey: 'fake', clickupToken: 'pk_fake', assigneeId: '118313848', spaceId: '90142472614', reviewBeforeSend: false, hostProjects: {}, recent: [] });
  const live = await waitFor(() => !document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').classList.contains('needs-setup')).then(
    () => true,
    () => false,
  );
  check('launcher turns ready as soon as a token is saved', live && (await sh('.launcher-label'))?.trim() === 'Pointer');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  check('launcher reads Pointer', (await sh('.launcher-label'))?.trim() === 'Pointer');
  check('launcher tooltip leaves out a shortcut that isn\'t set', !/\(/.test(await sh('.launcher', 'title')), await sh('.launcher', 'title'));
  // with a bound shortcut (stubbed in the worker, see above) the tooltip names it
  await worker.evaluate(() => {
    globalThis.__realGetAll ??= chrome.commands.getAll.bind(chrome.commands);
    chrome.commands.getAll = async () => [{ name: 'toggle-point-mode', description: '', shortcut: 'Alt+Shift+P' }];
  });
  await patchSettings({ _nudge: Date.now() }); // any real settings change makes the page ask again
  const named = await waitFor(() => /\(Alt\+Shift\+P\)/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').title)).then(
    () => true,
    () => false,
  );
  check('launcher tooltip names the shortcut', named, await sh('.launcher', 'title'));
  check('launcher ready (no setup badge)', !(await shHas('.launcher', 'needs-setup')));
  check(
    'Gilroy loaded for the shadow UI',
    await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Pointer Gilroy' && f.status === 'loaded');
    }),
  );
  await launcherShot('1-launcher-idle.png');

  // ---------- the dock goes in any corner (dockdrag.ts, scripts/dock-check.mjs) ----------
  const storedCorner = () => worker.evaluate(async () => (await chrome.storage.local.get('dockCorner')).dockCorner);
  const home = await dockState(page);
  const topLeft = launcherSpot('top-left', home.launcher, home.viewport);
  await pressAndDrag(page, 260, 180);
  await delay(400); // the ring glides over
  const midDrag = await dockState(page);
  await page.screenshot({ path: `${outDir}/1-dock-drag.png` });
  check(
    'dragging the dock shows a line to the nearest corner and a ring where it would land',
    home.corner === 'bottom-right' &&
      midDrag.dragging &&
      midDrag.guide &&
      Math.hypot(midDrag.ring.x - topLeft.x, midDrag.ring.y - topLeft.y) < 2 &&
      Math.hypot(midDrag.lineEnd.x - midDrag.ring.x, midDrag.lineEnd.y - midDrag.ring.y) < 30,
    JSON.stringify({ ring: midDrag.ring, spot: topLeft, lineEnd: midDrag.lineEnd }),
  );
  await page.mouse.up();
  await delay(900);
  const dropped = await dockState(page);
  check(
    'letting go settles it in that corner and remembers it; the drop is not a click',
    dropped.corner === 'top-left' &&
      Math.abs(dropped.launcher.x - 20) < 1 &&
      Math.abs(dropped.launcher.y - 20) < 1 &&
      !dropped.guide &&
      !dropped.dragging &&
      !dropped.active &&
      (await storedCorner()) === 'top-left',
    JSON.stringify({ corner: dropped.corner, at: dropped.launcher, active: dropped.active }),
  );
  const placed = await followers(page);
  check('the recording bar and the review sheet follow it', placed.recbar === '20px,20px' && placed.sheet === '20px,76px', JSON.stringify(placed));
  await page.mouse.click(dropped.launcher.x + dropped.launcher.w / 2, dropped.launcher.y + dropped.launcher.h / 2);
  const clicked = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').classList.contains('is-active')).then(
    () => true,
    () => false,
  );
  check('a plain click on it still turns point mode on', clicked);
  await shClick('.launcher');
  await waitFor(() => !document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').classList.contains('is-active'));
  await pressAndDrag(page, 1000, 650);
  await delay(250);
  const heading = await dockState(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await delay(900);
  const putBack = await dockState(page);
  check(
    'Esc mid-drag puts it back where it was',
    heading.ring && heading.ring.y > 400 && putBack.corner === 'top-left' && Math.abs(putBack.launcher.x - 20) < 1 && !putBack.active && (await storedCorner()) === 'top-left',
    JSON.stringify({ corner: putBack.corner, at: putBack.launcher }),
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  const reloaded = await dockState(page);
  check('it stays in its corner after a reload', reloaded.corner === 'top-left' && Math.abs(reloaded.launcher.y - 20) < 1, JSON.stringify(reloaded.launcher));
  await worker.evaluate(() => chrome.storage.local.set({ dockCorner: 'bottom-left' }));
  const followed = await waitFor(() => document.querySelector('#bid-pointer').dataset.corner === 'bottom-left').then(
    () => true,
    () => false,
  );
  check('moved in another tab, it moves here too', followed);
  // home again for the rest of the run
  await worker.evaluate(() => chrome.storage.local.set({ dockCorner: 'bottom-right' }));
  await waitFor(() => document.querySelector('#bid-pointer').dataset.corner === 'bottom-right');
  await delay(600);

  // ---------- easter egg: spin the button round quickly and it throws confetti (confetti.ts) ----------
  await pressAndDrag(page, 640, 400);
  await wiggleDock(page, { x: 640, y: 400 }, 150, 3, 2500);
  const wiggled = await partyState(page);
  await spinDock(page, { x: 640, y: 400 }, 80, 2, 2500);
  const kickedOff = await partyState(page);
  await spinDock(page, { x: 640, y: 400 }, 80, 2, 5000);
  const wilder = await partyState(page);
  const heldAt = Date.now();
  await page.screenshot({ path: `${outDir}/1-dock-confetti.png` });
  check(
    'shaking the button about does nothing; spinning it round quickly sets it throwing confetti, wilder the longer it spins',
    !wiggled.partying && kickedOff.partying && !kickedOff.wild && wilder.partying && wilder.wild,
    JSON.stringify({ wiggled, kickedOff, wilder }),
  );
  // held still mid-drag, it keeps throwing a while, then stops
  await delay(2500 - (Date.now() - heldAt));
  const stillGoing = (await partyState(page)).partying;
  await page.waitForFunction(() => !document.querySelector('#bid-pointer').classList.contains('is-partying'), { polling: 50, timeout: 10000 }).catch(() => {});
  const heldFor = (Date.now() - heldAt) / 1000;
  check('held still, it keeps throwing a while and stops after three seconds', stillGoing && heldFor > 2.8 && heldFor < 4, `stopped after ${heldFor.toFixed(1)}s held still`);
  // spun up again and let go: it all vanishes the moment the button settles in its corner
  await spinDock(page, { x: 640, y: 400 }, 80, 2, 2500);
  const again = await partyState(page);
  for (let i = 1; i <= 10; i++) await page.mouse.move(720 + i * 20, 400 + i * 20); // off toward the bottom right
  const held = await confettiAlpha(page);
  await page.mouse.up();
  const letGo = Date.now();
  await delay(120);
  const early = await confettiAlpha(page);
  await delay(450);
  const later = await confettiAlpha(page);
  await page.waitForFunction(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.confetti').hidden, { polling: 20, timeout: 5000 }).catch(() => {});
  const goneAfter = (Date.now() - letGo) / 1000;
  check(
    'let go, it stops throwing at once and the confetti fades away from that moment',
    again.partying &&
      held.solid > 0.15 &&
      !early.partying &&
      early.solid < held.solid / 3 &&
      early.mean < held.mean &&
      later.mean < early.mean - 25 &&
      goneAfter > 1 &&
      goneAfter < 1.9 &&
      (await dockState(page)).corner === 'bottom-right' &&
      !(await dockState(page)).active,
    `opacity ${held.mean} (${held.solid} solid) held, ${early.mean} (${early.solid}) at 0.12s, ${later.mean} (${later.solid}) at 0.57s; all gone after ${goneAfter.toFixed(2)}s`,
  );

  // point mode via the launcher
  await shClick('.launcher');
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').classList.contains('is-active'));
  check('point mode on', (await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher').getAttribute('aria-pressed'))) === 'true');

  // hover the CTA inside the Hero block
  const cta = await ctaCentre();
  await page.mouse.move(cta.x, cta.y);
  await delay(200);
  await page.screenshot({ path: `${outDir}/2-hover.png` });
  await launcherShot('2-launcher-active.png');
  check('block outline shown', await shHas('.outline--block', 'is-visible'));
  check('hover tab names the block', (await sh('.outline-tab')) === 'ExperiencesListWithFilters', await sh('.outline-tab'));

  // click: the note opens and the page never sees the click
  await page.evaluate(() => {
    window.__clicked = 0;
    document.querySelector('.btn-primary').addEventListener('click', () => {
      window.__clicked++;
    });
  });
  await page.mouse.click(cta.x, cta.y);
  await waitNote(true);
  await delay(300);
  await page.screenshot({ path: `${outDir}/3-note.png` });
  check('page click swallowed', (await page.evaluate(() => window.__clicked)) === 0);
  check('note names the block, without its id', (await sh('.note-block'))?.trim() === 'ExperiencesListWithFilters', await sh('.note-block'));
  check('no project pre-selected', (await sh('.note-project', 'value')) === '');
  check(
    'note input focused',
    await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.activeElement?.classList.contains('note-input')),
  );
  const pin = await shRect('.pin');
  check(
    "pin's tip sits on the clicked spot",
    pin && Math.abs(pin.x - cta.x) <= 1 && Math.abs(pin.bottom - cta.y) <= 1,
    JSON.stringify(pin),
  );

  // Enter without a project: blocked, note stays in edit state
  await page.keyboard.type('cta gumb ide preko naslova na mobitelu');
  await page.keyboard.press('Enter');
  await delay(200);
  check('blocked without a project', (await sh('.note-input', 'value')) === 'cta gumb ide preko naslova na mobitelu');
  await waitFor(() => /Couldn't load projects/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').textContent));
  check('project error shown in the picker', /ClickUp 401/.test((await sh('.note-project')) ?? ''), (await sh('.note-project'))?.replace(/\s+/g, ' ').slice(0, 120));

  // data-attr block detection on the second block; the draft follows the note
  await page.keyboard.press('Escape');
  await waitNote(false);
  const card = await (await page.$('.card:nth-child(2) h3')).boundingBox();
  await page.mouse.move(card.x + 5, card.y + 5);
  await delay(200);
  check('data-attr block label', (await sh('.outline-tab')) === 'RoomList', await sh('.outline-tab'));
  await page.mouse.click(card.x + 5, card.y + 5);
  await waitNote(true);
  check('draft preserved across notes', (await sh('.note-input', 'value'))?.startsWith('cta gumb'));

  // near the right edge the note flips to the left of the pin and stays on screen
  await page.keyboard.press('Escape');
  await waitNote(false);
  await page.mouse.click(1268, 300);
  await waitNote(true);
  await delay(300);
  const [vw, vh] = await viewport();
  const edgeNote = await shRect('.note');
  check('note stays on screen at the right edge', inside(edgeNote, vw, vh), JSON.stringify(edgeNote));
  check('block outline not hidden when the element is the block', await shHas('.outline--block', 'is-visible') && !(await shHas('.outline--element', 'is-visible')));
  const edgePin = await shRect('.pin');
  check('pin turns away from the right edge', (await shHas('.pin', 'flip-x')) && edgePin.right <= vw && Math.abs(edgePin.right - 1268) <= 1, JSON.stringify(edgePin));
  check('note clears the pin', !(edgeNote.x < edgePin.right && edgeNote.right > edgePin.x && edgeNote.y < edgePin.bottom && edgeNote.bottom > edgePin.y));
  await page.screenshot({ path: `${outDir}/3-note-edge.png` });

  // the pin (and the note) follow the page when it scrolls
  const pinBefore = await shRect('.pin');
  await page.evaluate(() => window.scrollBy(0, 120));
  await delay(200);
  const pinAfter = await shRect('.pin');
  check('pin follows the page on scroll', Math.abs(pinBefore.y - pinAfter.y - 120) <= 1, `${pinBefore.y} → ${pinAfter.y}`);
  check('note stays on screen while scrolling', inside(await shRect('.note'), vw, vh));
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(150);

  // footer: no block, element outline only
  await page.keyboard.press('Escape');
  await waitNote(false);
  await page.evaluate(() => document.querySelector('footer').scrollIntoView({ block: 'center' }));
  await delay(100);
  const footer = await (await page.$('footer')).boundingBox();
  await page.mouse.move(footer.x + 40, footer.y + 40);
  await delay(200);
  check('no block on footer', !(await shHas('.outline--block', 'is-visible')) && (await shHas('.outline--element', 'is-visible')));

  // Escape leaves point mode
  await page.keyboard.press('Escape');
  await delay(100);
  check('escape exits point mode', !(await shHas('.launcher', 'is-active')));

  // capture pipeline, called directly with the CTA rects
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(100);
  const rects = await page.evaluate(() => {
    const el = document.querySelector('.btn-primary').getBoundingClientRect();
    const bl = document.querySelector('.hero').parentElement.getBoundingClientRect();
    const r = (x) => ({ x: x.left, y: x.top, w: x.width, h: x.height });
    return { block: r(bl), element: r(el), click: { x: el.left + 20, y: el.top + 10 }, dpr: devicePixelRatio, viewport: { w: innerWidth, h: innerHeight } };
  });
  const cap = await worker.evaluate(async (capture) => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:8765/*' });
    await chrome.tabs.update(tab.id, { active: true });
    try {
      return { dataUrl: await globalThis.__pointer.captureAndMark(tab.windowId, capture) };
    } catch (e) {
      return { dataUrl: null, error: String(e) };
    }
  }, rects);
  check('captureVisibleTab + crop produced a PNG', typeof cap?.dataUrl === 'string' && cap.dataUrl.startsWith('data:image/png;base64,'), cap?.error);
  if (cap?.dataUrl) savePng('4-capture.png', cap.dataUrl);

  // remembered project, submit: capture → rewrite (401, falls back) → ClickUp 401 → error state
  await patchSettings({ hostProjects: { 'localhost:8765': { listId: '901407290920', label: 'Bluesun' } } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer');
  await waitReady();
  await shClick('.launcher');
  const cta2 = await ctaCentre();
  await page.mouse.click(cta2.x - 50, cta2.y - 10);
  await waitNote(true);
  check('remembered project pre-selected', (await sh('.note-project', 'value')) === '901407290920', await sh('.note-project', 'value'));
  await page.keyboard.type('gumb je krivo poravnat');
  await page.keyboard.press('Enter');
  let thumbSrc = null;
  let alertText = null;
  for (let i = 0; i < 300 && alertText === null; i++) {
    await delay(50);
    const s = await page.evaluate(() => {
      const root = document.querySelector('#bid-pointer').shadowRoot;
      return { thumb: root.querySelector('.note-thumb')?.getAttribute('src') ?? null, alert: root.querySelector('.alert')?.textContent ?? null };
    });
    thumbSrc ??= s.thumb;
    alertText = s.alert;
  }
  if (thumbSrc) savePng('6-flow-capture.png', thumbSrc);
  await delay(250);
  await page.screenshot({ path: `${outDir}/5-error.png` });
  check('screenshot thumbnail shown while busy', Boolean(thumbSrc));
  check('submit reached ClickUp (401 with fake token)', /ClickUp 401/.test(alertText ?? ''), alertText?.replace(/\s+/g, ' ').trim());
  check('note text kept after error', /Your note is kept/.test((await sh('.note-foot')) ?? ''));
  await shClick('[data-action="retry"]');
  await delay(100);
  check('retry restores the draft', (await sh('.note-input', 'value')) === 'gumb je krivo poravnat');

  // review before sending: rewrite fails (fake key) → fallback draft → Enter → ClickUp 401
  await patchSettings({ reviewBeforeSend: true });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer');
  await waitReady();
  await shClick('.launcher');
  const cta3 = await ctaCentre();
  await page.mouse.click(cta3.x - 50, cta3.y - 10);
  await waitNote(true);
  await page.keyboard.type('gumb je krivo poravnat');
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-title')));
  await delay(250);
  await page.screenshot({ path: `${outDir}/7-review.png` });
  const [rvw, rvh] = await viewport();
  const reviewNote = await shRect('.note');
  const reviewPin = await shRect('.pin');
  check(
    'tall note sits beside the pin, not on it',
    inside(reviewNote, rvw, rvh) &&
      !(reviewNote.x < reviewPin.right && reviewNote.right > reviewPin.x && reviewNote.y < reviewPin.bottom && reviewNote.bottom > reviewPin.y),
    `${JSON.stringify(reviewNote)} vs ${JSON.stringify(reviewPin)}`,
  );
  check('review shows fallback title', (await sh('.review-title', 'value')) === 'ExperiencesListWithFilters: gumb je krivo poravnat', await sh('.review-title', 'value'));
  const fullDescription = (await sh('.review-description', 'value')) ?? '';
  check(
    'review shows the whole description, page link included',
    fullDescription.includes('**Where**') && fullDescription.includes(`(${FIXTURE})`) && fullDescription.includes('gumb je krivo poravnat'),
    fullDescription,
  );
  check('review says the rewrite failed', /wasn't rewritten \(Z\.ai 401/.test((await sh('.review-note')) ?? ''), await sh('.review-note'));
  await page.keyboard.press('Escape');
  await delay(100);
  check(
    'escape in review goes back to edit',
    (await page.evaluate(() => {
      const root = document.querySelector('#bid-pointer').shadowRoot;
      return !root.querySelector('.review-title') && root.querySelector('.note-input')?.value;
    })) === 'gumb je krivo poravnat',
  );
  // the × during review abandons it and closes the note; the draft survives
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-title')));
  await shClick('[data-action="close"]');
  await waitNote(false);
  check('× during review closes the note, point mode stays on', await shHas('.launcher', 'is-active'));
  await page.mouse.click(cta3.x - 50, cta3.y - 10);
  await waitNote(true);
  check('reopened note is back in edit with the draft', (await sh('.note-input', 'value')) === 'gumb je krivo poravnat');
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-title')));
  await page.keyboard.press('Enter'); // the title field has focus: Enter creates
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.alert')));
  check('review → create reaches ClickUp', /ClickUp 401/.test((await sh('.alert')) ?? ''));

  // ---------- happy path: ClickUp and Z.ai mocked inside the service worker ----------
  await worker.evaluate(() => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    // openTasks: what ClickUp lists as open Pointer tasks (the test seeds it for Comment Mode)
    const log = (globalThis.__mock = {
      created: [],
      attachments: [],
      deleted: [],
      openTasks: [],
      searched: [],
      closedIds: [],
      comments: [],
      deletedComments: [],
      listDelay: 0,
      // Send to ClickUp (Gmail): what GLM was given, and the split it answers with
      emailPrompts: [],
      emailSplit: null,
      // distinct task ids (mail1, mail2…) instead of smoke1 for everything
      uniqueIds: false,
      // Send to ClickUp (HubSpot): files the background was asked for, and what HubSpot's file server answers (base64)
      hubspotFiles: [],
      hubspotFile: null,
    });
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.startsWith('https://api.z.ai/')) {
        await new Promise((r) => setTimeout(r, 1500)); // long enough to photograph the progress state
        const sent = JSON.parse(init.body).messages;
        if (/list the work it asks for/.test(sent[0].content)) {
          log.emailPrompts.push(JSON.parse(sent[1].content));
          return json({ choices: [{ message: { content: JSON.stringify(log.emailSplit ?? { points: [], questions: [] }) } }] });
        }
        // page-task notes ("page:…") come back recognisably, so the test can tell them apart
        const note = JSON.parse(sent[1].content).note;
        const content = note.startsWith('page:')
          ? JSON.stringify({ title: `Fixed: ${note.slice(5)}`, bullets: [`Rewritten from "${note}".`] })
          : JSON.stringify({
              title: 'ExperiencesListWithFilters: Book now button overlaps the title on mobile',
              bullets: ['The Book now button sits on top of the room title on narrow screens.', 'It should sit below the title, with space between them.'],
            });
        return json({ choices: [{ message: { content } }] });
      }
      if (url.startsWith('https://app-eu1.hubspot.com/api/filemanager/')) {
        log.hubspotFiles.push({ url, credentials: init.credentials ?? 'same-origin' });
        if (!log.hubspotFile) return new Response('Forbidden', { status: 403 });
        return new Response(Uint8Array.from(atob(log.hubspotFile), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } });
      }
      if (!url.startsWith('https://api.clickup.com/')) return realFetch(input, init);
      const path = new URL(url).pathname.replace('/api/v2', '');
      if (path === '/user') return json({ user: { id: 1, username: 'Smoke Test', email: 'smoke@bid.hr' } });
      if (path === '/team')
        return json({
          teams: [
            {
              id: '9014552433',
              members: [
                { user: { id: 118313848, username: 'Mate' } },
                { user: { id: 82460956, username: 'Tea Babić' } },
                { user: { id: 106460192, username: 'Leo Babić' } },
              ],
            },
          ],
        });
      if (/^\/space\/\d+\/folder$/.test(path))
        return json({ folders: [{ id: 'f1', name: 'Cresanka', lists: [{ id: '901417200456', name: 'Development' }, { id: 'q1', name: 'QA' }] }] });
      if (/^\/space\/\d+\/list$/.test(path)) return json({ lists: [{ id: '901407290920', name: 'Bluesun' }, { id: '901400000555', name: 'Lumen' }] });
      if (/^\/list\/\w+\/task$/.test(path) && method === 'POST') {
        const body = JSON.parse(init.body);
        log.created.push(body);
        const id = log.uniqueIds ? `mail${log.created.length}` : 'smoke1';
        return json({ id, url: `https://app.clickup.com/t/${id}`, name: body.name });
      }
      if (/^\/team\/\w+\/task$/.test(path) && method === 'GET') {
        const query = new URL(url).searchParams;
        log.searched.push({ tags: query.getAll('tags[]'), spaces: query.getAll('space_ids[]'), closed: query.get('include_closed') });
        if (log.listDelay < 0) await new Promise(() => {}); // a ClickUp that never answers
        else if (log.listDelay) await new Promise((r) => setTimeout(r, log.listDelay));
        // as if ClickUp ignored the filters: Pointer has to keep to open, tagged tasks itself
        return json({ tasks: log.openTasks, last_page: true });
      }
      if (/^\/task\/\w+$/.test(path) && method === 'GET') {
        const id = path.split('/')[2];
        const known = log.openTasks.find((t) => t.id === id) ?? { id, name: id, url: `https://app.clickup.com/t/${id}`, tags: [{ name: 'pointer' }] };
        const closed = log.closedIds.includes(id);
        return json({ ...known, status: closed ? { status: 'done', type: 'done' } : (known.status ?? { status: 'to do', type: 'open' }), date_closed: closed ? '1' : null });
      }
      if (/^\/task\/\w+\/attachment$/.test(path) && method === 'POST') {
        const file = init.body.get('attachment');
        log.attachments.push({ task: path.split('/')[2], name: file.name, type: file.type, size: file.size });
        return json({ id: 'att1' });
      }
      if (/^\/task\/\w+\/comment$/.test(path) && method === 'POST') {
        const body = JSON.parse(init.body);
        log.comments.push({ task: path.split('/')[2], text: body.comment_text });
        return json({ id: `c${log.comments.length}`, hist_id: 'h1', date: Date.now() });
      }
      if (/^\/comment\/\w+$/.test(path) && method === 'DELETE') {
        log.deletedComments.push(path.split('/')[2]);
        return json({});
      }
      if (/^\/task\/\w+$/.test(path) && method === 'DELETE') {
        log.deleted.push(path);
        return json({});
      }
      return json({ err: `unmocked ${method} ${path}` }, 404);
    };
  });
  await setSettings({
    zaiKey: 'mock',
    clickupToken: 'pk_8216402_MOCK7Q2ZK3F7A',
    clickupUser: { id: 1, username: 'Smoke Test', email: 'smoke@bid.hr' },
    assigneeId: '118313848',
    assigneeName: 'Mate',
    spaceId: '90142472614',
    reviewBeforeSend: false,
    hostProjects: {},
    recent: [],
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer');
  await waitReady();
  await shClick('.launcher');
  const cta4 = await ctaCentre();
  await page.mouse.click(cta4.x, cta4.y);
  await waitNote(true);
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  await page.evaluate(() => {
    const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project');
    select.value = '901417200456';
    select.dispatchEvent(new Event('change'));
  });
  check('choosing a project clears the warning', !(await shHas('.note-project', 'is-empty')));
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee option[value="82460956"]')));
  check(
    'note starts with the default assignee',
    (await sh('.note-assignee', 'value')) === '118313848' &&
      (await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee').selectedOptions[0].textContent)) === 'Mate',
  );
  await page.keyboard.type('cta gumb ide preko naslova na mobitelu, treba bit ispod');
  await delay(150);
  await page.screenshot({ path: `${outDir}/3-note-filled.png` });
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-thumb')));
  await delay(200);
  await page.screenshot({ path: `${outDir}/6-busy.png` });
  check('progress names the current step', /Writing the task/.test((await sh('.progress-label')) ?? ''), await sh('.progress-label'));
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').classList.contains('is-visible'));
  await delay(400);
  await page.screenshot({ path: `${outDir}/8-toast.png` });
  check('toast confirms the task', /Task created/.test((await sh('.toast')) ?? ''), (await sh('.toast'))?.replace(/\s+/g, ' '));
  check('toast links to the task', (await sh('.toast-link', 'href')) === 'https://app.clickup.com/t/smoke1');
  const mock = await worker.evaluate(() => globalThis.__mock);
  const created = mock.created[0];
  check('task uses the rewritten title', created?.name === 'ExperiencesListWithFilters: Book now button overlaps the title on mobile', created?.name);
  check('task links the reported page', created?.markdown_description?.includes(`(${FIXTURE})`));
  check('task is assigned to Mate', created?.assignees?.[0] === 118313848);
  const chromeFooter = created?.markdown_description?.split('\n').at(-1) ?? '';
  check('task footer has the browser and window size', /· \d+×\d+ · (Chrome|Edge) \d+ ·/.test(chromeFooter), chromeFooter);
  const attachment = mock.attachments[0];
  check(
    'screenshot uploaded as a PNG attachment',
    attachment?.type === 'image/png' && attachment.size > 1000 && /^pointer-.+\.png$/.test(attachment.name),
    JSON.stringify(attachment),
  );
  check(
    'project remembered for the site',
    await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.hostProjects['localhost:8765']?.listId === '901417200456'),
  );
  await shClick('[data-action="undo"]');
  await waitFor(() => /Task deleted/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('undo deletes the task', (await worker.evaluate(() => globalThis.__mock.deleted)).includes('/task/smoke1'));

  // ---------- a staging host whose name matches a project ----------
  // Served through request interception, so no DNS, certificate or real Vercel deploy is needed.
  const STAGING = 'https://pages-cresanka-bid.vercel.app/rooms/superior';
  const routes = { 'https://pages-cresanka-bid.vercel.app/': fixture.toString('utf8') };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const body = Object.entries(routes).find(([prefix]) => req.url().startsWith(prefix))?.[1];
    if (body !== undefined) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body });
    else req.continue();
  });
  await page.goto(STAGING, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  await shClick('.launcher');
  const ctaS = await ctaCentre();
  await page.mouse.click(ctaS.x, ctaS.y);
  await waitNote(true);
  const preselected = await waitFor(
    () => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').value === '901417200456',
  ).then(
    () => true,
    () => false,
  );
  check('URL suggestion pre-selected', preselected && !(await shHas('.note-project', 'is-empty')), await sh('.note-project', 'value'));
  check('note says Staging on a staging host', (await sh('.note-env'))?.trim() === 'Staging', await sh('.note-env'));
  await delay(200);
  await page.screenshot({ path: `${outDir}/3-note-suggested.png` });

  // the × closes the note like Esc: point mode stays on and the draft is kept
  await page.keyboard.type('razmak je prevelik');
  await shClick('[data-action="close"]');
  await waitNote(false);
  check('× closes the note, point mode stays on', await shHas('.launcher', 'is-active'));
  await page.mouse.click(ctaS.x, ctaS.y);
  await waitNote(true);
  check('draft kept after closing with ×', (await sh('.note-input', 'value')) === 'razmak je prevelik');

  // a project picked by hand stays picked when the note is closed and opened again
  await page.evaluate(() => {
    const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project');
    select.value = '901407290920';
    select.dispatchEvent(new Event('change'));
  });
  await shClick('[data-action="close"]');
  await waitNote(false);
  await page.mouse.click(ctaS.x, ctaS.y);
  await waitNote(true);
  check('hand-picked project kept across notes', (await sh('.note-project', 'value')) === '901407290920', await sh('.note-project', 'value'));

  // a person picked by hand stays picked for the next note, and goes on the task
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee option[value="82460956"]')));
  await page.evaluate(() => {
    const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee');
    select.value = '82460956';
    select.dispatchEvent(new Event('change'));
  });
  await shClick('[data-action="close"]');
  await waitNote(false);
  await page.mouse.click(ctaS.x, ctaS.y);
  await waitNote(true);
  check('hand-picked assignee kept across notes', (await sh('.note-assignee', 'value')) === '82460956', await sh('.note-assignee', 'value'));
  await delay(150);
  await page.screenshot({ path: `${outDir}/3-note-assignee.png` });
  const createdBefore = await worker.evaluate(() => globalThis.__mock.created.length);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 200 && (await worker.evaluate(() => globalThis.__mock.created.length)) === createdBefore; i++) await delay(50);
  const lastTask = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  check('task goes to the person picked in the note', JSON.stringify(lastTask?.assignees) === '[82460956]', JSON.stringify(lastTask?.assignees));
  check(
    'staging task says Staging',
    lastTask?.markdown_description?.includes('**Environment** Staging') && lastTask?.tags?.includes('staging') && !lastTask?.tags?.includes('production'),
    JSON.stringify(lastTask?.tags),
  );
  await waitNote(false);

  // the site's last-used project wins over the URL suggestion
  await patchSettings({ hostProjects: { 'pages-cresanka': { listId: '901407290920', label: 'Bluesun' } } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  await shClick('.launcher');
  await page.mouse.click(ctaS.x, ctaS.y);
  await waitNote(true);
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  check('last-used project wins over the URL suggestion', (await sh('.note-project', 'value')) === '901407290920', await sh('.note-project', 'value'));
  await page.keyboard.press('Escape');
  await waitNote(false);

  // ---------- the staging alias every project has, <project>-staging.vercel.app ----------
  routes['https://cresanka-staging.vercel.app/'] = fixture.toString('utf8');
  routes['https://someone-else.vercel.app/'] = fixture.toString('utf8').replace('<footer>Footer without a debug block</footer>', '<footer>Made by someone else</footer>');
  await page.goto('https://cresanka-staging.vercel.app/rooms/superior', { waitUntil: 'load' });
  const aliasShown = await page.waitForSelector('#bid-pointer', { timeout: 8000 }).then(
    () => true,
    () => false,
  );
  check('Pointer starts on a <project>-staging.vercel.app host', aliasShown);
  if (aliasShown) {
    await waitReady();
    await shClick('.launcher');
    const ctaA = await ctaCentre();
    await page.mouse.click(ctaA.x, ctaA.y);
    await waitNote(true);
    const aliasPicked = await waitFor(
      () => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').value === '901417200456',
    ).then(
      () => true,
      () => false,
    );
    check('staging alias matches its project', aliasPicked, await sh('.note-project', 'value'));
    check('note says Staging on the staging alias', (await sh('.note-env'))?.trim() === 'Staging', await sh('.note-env'));
    await page.keyboard.press('Escape');
    await waitNote(false);
  }
  await page.goto('https://someone-else.vercel.app/', { waitUntil: 'load' });
  await delay(2500);
  check("someone else's vercel.app site gets no Pointer", !(await page.$('#bid-pointer')));
  // the toolbar button (or shortcut) starts it there by hand
  await page.bringToFront();
  await worker.evaluate(() => globalThis.__pointer.toggleActiveTab());
  const byHand = await page.waitForSelector('#bid-pointer', { timeout: 5000 }).then(
    () => true,
    () => false,
  );
  check('toolbar button starts Pointer by hand where it stayed off', byHand && (await shHas('.launcher', 'is-active')));
  await worker.evaluate(() => globalThis.__pointer.toggleActiveTab());
  check('the toolbar button then toggles it off again', !(await shHas('.launcher', 'is-active')));

  // ---------- live sites ----------
  // Production builds have no debug labels, so the live fixture drops the Hero block's label.
  const liveFixture = (footer) =>
    fixture
      .toString('utf8')
      .replace('<span>[ExperiencesListWithFilters - 4821]</span>', '')
      .replace('<footer>Footer without a debug block</footer>', footer);
  routes['https://www.cresanka.hr/'] = liveFixture('<footer>© 2026 Cresanka d.o.o. Powered by <a href="https://bid.agency/en">bid.</a></footer>');
  routes['https://www.example-hotel.com/'] = liveFixture('<footer>© 2026 Example Hotel. Place a bid for the honeymoon suite.</footer>');
  routes['https://www.late-bid.hr/'] = liveFixture(
    '<footer id="late"></footer><script>setTimeout(() => { document.getElementById("late").innerHTML = "Powered by <span>bid</span>"; }, 1500)</script>',
  );

  await page.goto('https://www.example-hotel.com/sobe', { waitUntil: 'load' });
  await delay(2500);
  check("a site that isn't bid's gets no Pointer", !(await page.$('#bid-pointer')));

  await page.goto('https://www.late-bid.hr/', { waitUntil: 'load' });
  const lateShown = await page.waitForSelector('#bid-pointer', { timeout: 8000 }).then(
    () => true,
    () => false,
  );
  check('a bid footer that renders late still brings Pointer', lateShown);

  await page.goto('https://www.cresanka.hr/sobe', { waitUntil: 'load' });
  const liveShown = await page.waitForSelector('#bid-pointer', { timeout: 8000 }).then(
    () => true,
    () => false,
  );
  check('a live site with a bid footer gets Pointer', liveShown);
  await waitReady();
  await shClick('.launcher');
  const ctaL = await ctaCentre();
  await page.mouse.click(ctaL.x, ctaL.y);
  await waitNote(true);
  const livePicked = await waitFor(
    () => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').value === '901417200456',
  ).then(
    () => true,
    () => false,
  );
  check('live domain matches its project', livePicked, await sh('.note-project', 'value'));
  check('note says Production on a live site', (await sh('.note-env'))?.trim() === 'Production' && (await shHas('.note-env', 'note-env--production')));
  check('live site has no debug labels, so no block', (await sh('.note-block'))?.trim() === 'No block found here', await sh('.note-block'));
  await page.keyboard.type('tekst u footeru je premali');
  await delay(150);
  await page.screenshot({ path: `${outDir}/3-note-production.png` });
  const liveBefore = await worker.evaluate(() => globalThis.__mock.created.length);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 200 && (await worker.evaluate(() => globalThis.__mock.created.length)) === liveBefore; i++) await delay(50);
  const liveTask = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  check(
    'live-site task says Production',
    liveTask?.markdown_description?.includes('**Environment** Production (live site)') &&
      liveTask?.markdown_description?.includes('(https://www.cresanka.hr/sobe)') &&
      liveTask?.tags?.includes('production'),
    JSON.stringify(liveTask?.tags),
  );
  check(
    'live site remembered by its domain',
    await worker.evaluate(async () => Boolean((await chrome.storage.local.get('settings')).settings.hostProjects['cresanka.hr'])),
  );
  await waitNote(false);

  // phone-width window: the note still fits
  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
  await delay(200);
  const ctaNarrow = await ctaCentre();
  await page.mouse.click(ctaNarrow.x, ctaNarrow.y);
  await waitNote(true);
  await delay(300);
  const [nvw, nvh] = await viewport();
  check('note fits a phone-width window', inside(await shRect('.note'), nvw, nvh), JSON.stringify(await shRect('.note')));
  await page.screenshot({ path: `${outDir}/10-narrow.png` });
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  // ---------- page task: several notes on a page, published as one task ----------
  const pins = () => page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin').length);
  const waitPins = (n) => waitFor((k) => document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin').length === k, n);
  const createdCount = () => worker.evaluate(() => globalThis.__mock.created.length);
  const stored = () => worker.evaluate(async () => (await chrome.storage.local.get(null)));
  const pickProject = () =>
    page.evaluate(() => {
      const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project');
      select.value = '901417200456';
      select.dispatchEvent(new Event('change'));
    });
  const dockShot = (name) => page.screenshot({ path: `${outDir}/${name}`, clip: { x: 1280 - 440, y: 800 - 84, width: 440, height: 84 } });
  await patchSettings({ pageTask: true });
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  check('page-task mode is plain on the launcher', (await sh('.launcher-label'))?.trim() === 'Page task' && (await shHas('.launcher', 'is-page')), await sh('.launcher-label'));
  check(
    'Publish task shows, waiting, before any note',
    (await sh('.publish', 'hidden')) === false && (await sh('.publish', 'disabled')) === true && (await sh('.publish-count'))?.trim() === '0',
  );
  await dockShot('11-page-task-empty.png');
  const pageCreatedBefore = await createdCount();
  await shClick('.launcher');
  const spot1 = await ctaCentre();
  await page.mouse.click(spot1.x, spot1.y);
  await waitNote(true);
  check('a page-task note says Add to page task', /Add to page task/.test((await sh('.note-foot')) ?? ''), await sh('.note-foot'));
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  await pickProject();
  await page.keyboard.type('page:one');
  await page.keyboard.press('Enter');
  await waitPins(1);
  await waitNote(false);
  const pin1 = await shRect('.draft-pin');
  check('the note stays on the page as pin 1, and no task is made', (await createdCount()) === pageCreatedBefore && (await sh('.draft-pin'))?.trim() === '1');
  check('pin 1 sits where the note was', Math.abs(pin1.x - spot1.x) < 2 && Math.abs(pin1.bottom - spot1.y) < 2, JSON.stringify({ pin1, spot1 }));
  check('Publish task counts it', (await sh('.publish-count'))?.trim() === '1' && (await sh('.publish', 'disabled')) === false);
  check('point mode stays on for the next note', await shHas('.launcher', 'is-active'));
  const card2 = await (await page.$('.card:nth-child(2)')).boundingBox();
  await page.mouse.click(card2.x + card2.width / 2, card2.y + 40);
  await waitNote(true);
  check('the next note keeps the project', (await sh('.note-project', 'value')) === '901417200456', await sh('.note-project', 'value'));
  await page.keyboard.type('page:two');
  await page.keyboard.press('Enter');
  await waitPins(2);
  await waitNote(false);
  await delay(200);
  await page.screenshot({ path: `${outDir}/11-page-task-pins.png` });
  await dockShot('11-page-task-dock.png');
  const pinsBefore = await page.evaluate(() => [...document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin')].map((p) => [Math.round(p.getBoundingClientRect().x), Math.round(p.getBoundingClientRect().y)]));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  const back = await waitPins(2).then(
    () => true,
    () => false,
  );
  await delay(300);
  const pinsAfter = await page.evaluate(() => [...document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin')].map((p) => [Math.round(p.getBoundingClientRect().x), Math.round(p.getBoundingClientRect().y)]));
  check('notes and pins come back after a reload', back && JSON.stringify(pinsAfter) === JSON.stringify(pinsBefore), `${JSON.stringify(pinsBefore)} → ${JSON.stringify(pinsAfter)}`);

  // a pin reopens its note, which can be changed...
  await shClick('.draft-pin:nth-child(2)');
  await waitNote(true);
  check(
    'a pin reopens its note to change it',
    (await sh('.note-input', 'value')) === 'page:two' && (await sh('.note-num'))?.trim() === 'Note 2' && /Save note/.test((await sh('.note-foot')) ?? '') && (await shHas('.draft-pin:nth-child(2)', 'is-editing')),
  );
  await page.screenshot({ path: `${outDir}/11-page-task-edit.png` });
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('page:two edited');
  await page.keyboard.press('Enter');
  await waitNote(false);
  check('the change is saved', (await stored()).pageTasks?.['localhost:8765/rooms/superior']?.items?.[1]?.note === 'page:two edited');
  // ...or removed
  await shClick('.launcher');
  const h1 = await (await page.$('.hero h1')).boundingBox();
  await page.mouse.click(h1.x + 20, h1.y + h1.height / 2);
  await waitNote(true);
  await page.keyboard.type('page:three');
  await page.keyboard.press('Enter');
  await waitPins(3);
  await waitNote(false);
  await shClick('.draft-pin:nth-child(3)');
  await waitNote(true);
  await shClick('[data-action="remove"]');
  await waitPins(2);
  const shotsLeft = Object.keys(await stored()).filter((k) => k.startsWith('pageShot:')).length;
  check('Remove note takes it and its screenshot away', (await pins()) === 2 && shotsLeft === 2 && (await sh('.publish-count'))?.trim() === '2', `${shotsLeft} screenshots stored`);

  // the options page lists the page as waiting
  const waiting = await b.newPage();
  await stubClickUp(waiting);
  await waiting.goto(optionsUrl, { waitUntil: 'load' });
  await waiting.waitForFunction(() => !document.querySelector('#pageTasksGroup').hidden, { timeout: 5000 }).catch(() => {});
  check(
    'options list the page as waiting to be published',
    /localhost:8765\/rooms\/superior[\s\S]*2 notes/.test(await waiting.$eval('#pageTasks', (el) => el.textContent)) && (await waiting.$eval('#pageTask', (el) => el.checked)),
  );
  await waiting.close();
  await page.bringToFront();

  // Publish task: one task, every note, every screenshot
  const attachmentsBefore = await worker.evaluate(() => globalThis.__mock.attachments.length);
  await shClick('.publish');
  const published = await waitFor(() => /Task created from 2 notes/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  await delay(300);
  await page.screenshot({ path: `${outDir}/11-page-task-published.png` });
  const pageTask = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  const pageShots = await worker.evaluate((n) => globalThis.__mock.attachments.slice(n), attachmentsBefore);
  check('Publish task makes one task, titled after the page', published && (await createdCount()) === pageCreatedBefore + 1 && pageTask?.name === 'Fixture Changes', pageTask?.name);
  check(
    'it lists the notes in order, rewritten, with the originals',
    /\*\*1\. Fixed: one\*\*[\s\S]*> page:one[\s\S]*\*\*2\. Fixed: two edited\*\*[\s\S]*> page:two edited/.test(pageTask?.markdown_description ?? '') &&
      !/page:three/.test(pageTask?.markdown_description ?? '') &&
      pageTask?.markdown_description?.includes(`(${FIXTURE})`) &&
      pageTask?.assignees?.[0] === 118313848, // the default, Mate
    `${JSON.stringify(pageTask?.assignees)} ${JSON.stringify(pageTask?.markdown_description)}`,
  );
  check(
    "each note's screenshot is attached under its number",
    JSON.stringify(pageShots.map((a) => a.name)) === JSON.stringify(['pointer-1-experienceslistwithfilters.png', 'pointer-2-roomlist.png']) && pageShots.every((a) => a.type === 'image/png' && a.size > 1000),
    JSON.stringify(pageShots),
  );
  check('the pins go once published', (await pins()) === 0 && (await sh('.publish-count'))?.trim() === '0' && (await sh('.publish', 'disabled')) === true);
  await shClick('[data-action="undo"]');
  const restored = await waitFor(() => /Your notes are back/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  check('Undo deletes the task and brings the notes back', restored && (await pins()) === 2 && (await worker.evaluate(() => globalThis.__mock.deleted.length)) > 0);
  await shClick('.publish');
  await waitFor(() => /Task created from 2 notes/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('publishing again after Undo works', (await pins()) === 0 && (await createdCount()) === pageCreatedBefore + 2);
  await patchSettings({ pageTask: false });
  const off = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.publish').hidden).then(
    () => true,
    () => false,
  );
  check('with the mode off and nothing waiting, Publish task goes away', off && (await sh('.launcher-label'))?.trim() === 'Pointer');

  // ---------- review: change the task's name and description before it goes out ----------
  const selectAllAndType = async (sel, text) => {
    await page.evaluate((s) => document.querySelector('#bid-pointer').shadowRoot.querySelector(s).focus(), sel);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type(text);
  };
  const appendLine = async (sel, text) => {
    await page.evaluate((s) => {
      const field = document.querySelector('#bid-pointer').shadowRoot.querySelector(s);
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }, sel);
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  };
  const ctrlEnter = async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
  };
  await patchSettings({ reviewBeforeSend: true });
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  await shClick('.launcher');
  const spotR = await ctaCentre();
  await page.mouse.click(spotR.x - 30, spotR.y);
  await waitNote(true);
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  await pickProject();
  await page.keyboard.type('cta gumb ide preko naslova');
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-description')));
  check(
    'review starts with the rewritten name and description',
    (await sh('.review-title', 'value')) === 'ExperiencesListWithFilters: Book now button overlaps the title on mobile' &&
      /- The Book now button sits on top/.test((await sh('.review-description', 'value')) ?? '') &&
      !(await sh('.review-note')),
  );
  await selectAllAndType('.review-title', 'Hero: Book now sits on the title');
  await appendLine('.review-description', 'Checked on an iPhone 15 as well.');
  await delay(150);
  await page.screenshot({ path: `${outDir}/12-review-edit.png` });
  const reviewedBefore = await createdCount();
  await ctrlEnter();
  await waitFor(() => /Task created/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const reviewedTask = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  check(
    'the task goes out with the edited name and description',
    (await createdCount()) === reviewedBefore + 1 &&
      reviewedTask?.name === 'Hero: Book now sits on the title' &&
      reviewedTask?.markdown_description?.endsWith('Checked on an iPhone 15 as well.') &&
      reviewedTask?.markdown_description?.includes('**Where**') &&
      !reviewedTask?.tags?.includes('needs-rewrite'),
    JSON.stringify({ name: reviewedTask?.name, tags: reviewedTask?.tags }),
  );

  // a page task gets the same review when Publish task is pressed
  await patchSettings({ pageTask: true });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Page task');
  const spotP = await ctaCentre();
  await page.mouse.click(spotP.x + 30, spotP.y);
  await waitNote(true);
  await page.keyboard.type('page:four');
  await page.keyboard.press('Enter');
  await waitPins(1);
  await waitNote(false);
  const sheetOpen = () => page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.sheet').classList.contains('is-open'));
  const pageReviewBefore = await createdCount();
  await shClick('.publish');
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.sheet').classList.contains('is-open'));
  check(
    'Publish task opens the review with the page task in it',
    (await sh('.sheet .review-title', 'value')) === 'Fixture Changes' && /\*\*1\. Fixed: four\*\*/.test((await sh('.sheet .review-description', 'value')) ?? '') && (await sh('.sheet .note-num'))?.trim() === '1 note',
    await sh('.sheet .review-description', 'value'),
  );
  await delay(200);
  await page.screenshot({ path: `${outDir}/12-page-review.png` });
  await page.keyboard.press('Escape');
  await delay(200);
  check('Esc leaves the review; nothing is published and the notes stay', !(await sheetOpen()) && (await createdCount()) === pageReviewBefore && (await pins()) === 1);
  await shClick('.publish');
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.sheet').classList.contains('is-open'));
  await selectAllAndType('.sheet .review-title', 'Fixture: launch fixes');
  await appendLine('.sheet .review-description', 'All checked on staging.');
  const pageShotsBefore = await worker.evaluate(() => globalThis.__mock.attachments.length);
  await shClick('[data-action="sheet-publish"]');
  await waitFor(() => /Task created from 1 note/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const pageReviewed = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  const pageReviewedShots = await worker.evaluate((n) => globalThis.__mock.attachments.slice(n), pageShotsBefore);
  check(
    'the page task goes out as reviewed, with its screenshot',
    (await createdCount()) === pageReviewBefore + 1 &&
      pageReviewed?.name === 'Fixture: launch fixes' &&
      /\*\*1\. Fixed: four\*\*[\s\S]*All checked on staging\.$/.test(pageReviewed?.markdown_description ?? '') &&
      pageReviewedShots.length === 1 &&
      !(await sheetOpen()) &&
      (await pins()) === 0,
    JSON.stringify({ name: pageReviewed?.name, shots: pageReviewedShots.map((a) => a.name) }),
  );
  await patchSettings({ pageTask: false, reviewBeforeSend: false });

  // ---------- Comment Mode: a note about something with an open task becomes a comment on it ----------
  // What ClickUp has, written the way it gives tasks back (text_content): one about this block on
  // this page, moved on to QA; a page task for this page; and three that must never be picked: a
  // "done" one, one about the same block on another page, and a newer one not tagged pointer.
  await worker.evaluate(() => {
    const text = (path, env, more) => ['Something to fix', '', 'Where', `🔗 localhost:8765 › ${path}`, env, ...more].join('\n');
    const task = (id, list, updated, description, status = { status: 'in review - staging', type: 'custom' }, closed = null, tags = ['pointer', 'staging']) => ({
      id,
      name: `Task ${id}`,
      url: `https://app.clickup.com/t/${id}`,
      status,
      date_closed: closed,
      date_updated: String(updated),
      text_content: description,
      list: { id: list },
      tags: tags.map((name) => ({ name })),
    });
    const heroLine = 'Block ExperiencesListWithFilters · #4821';
    globalThis.__mock.openTasks = [
      task('open1', 'q1', 1000, text('/rooms/superior?x=1', 'Environment Local', [heroLine])),
      task('pg1', '901417200456', 1500, text('/rooms/superior', 'Environment Local · 2 notes', [`${heroLine} · Element section.hero`])),
      task('done1', '901417200456', 9000, text('/rooms/superior', 'Environment Local', [heroLine]), { status: 'done', type: 'done' }, '9000'),
      task('other1', '901417200456', 9500, text('/rooms/standard', 'Environment Local', [heroLine])),
      // the newest about this block, but not tagged pointer
      task('untagged1', '901417200456', 9900, text('/rooms/superior', 'Environment Local', [heroLine]), undefined, null, ['staging']),
    ];
  });
  await patchSettings({ commentMode: true });
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  await shClick('.launcher');
  const targetText = () => sh('.note-target').then((t) => (t ?? '').replace(/\s+/g, ' ').trim());
  const setListDelay = (ms) => worker.evaluate((v) => (globalThis.__mock.listDelay = v), ms);
  const waitTarget = (re) =>
    waitFor((src) => new RegExp(src).test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-target')?.textContent ?? ''), re.source).then(
      () => true,
      () => false,
    );
  const spotC = await ctaCentre();
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  await pickProject();
  const foundIt = await waitTarget(/Adds a comment to Task open1/);
  check(
    'the note says it goes on the open task tagged pointer, found in the QA list',
    foundIt && /Add comment/.test((await sh('.note-foot')) ?? '') && (await sh('.note-assignee', 'disabled')) === true,
    await targetText(),
  );
  const searches = await worker.evaluate(() => globalThis.__mock.searched);
  const indexed = await worker.evaluate(async () => ((await chrome.storage.local.get('taskIndex')).taskIndex?.tasks ?? []).map((t) => `${t.id}:${t.name}`));
  check(
    'it asks ClickUp once for the open tasks tagged pointer, and keeps them by id and title',
    searches.length === 1 &&
      searches[0].tags.join() === 'pointer' &&
      searches[0].spaces.join() === '90142472614' &&
      searches[0].closed === 'false' &&
      JSON.stringify(indexed.sort()) === JSON.stringify(['open1:Task open1', 'other1:Task other1', 'pg1:Task pg1']),
    `${JSON.stringify(searches)} ${JSON.stringify(indexed)}`,
  );
  await delay(150);
  await page.screenshot({ path: `${outDir}/13-comment-target.png` });
  const createdBeforeComment = await createdCount();
  await page.keyboard.type('page:comment one');
  await page.keyboard.press('Enter');
  const commented = await waitFor(() => /Comment added to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  await delay(300);
  await page.screenshot({ path: `${outDir}/13-comment-toast.png` });
  const firstComment = await worker.evaluate(() => globalThis.__mock.comments.at(-1));
  const commentShot = await worker.evaluate(() => globalThis.__mock.attachments.at(-1));
  check(
    'the note goes on that task as a comment, not a new task',
    commented &&
      firstComment?.task === 'open1' &&
      /^Fixed: comment one\n• Rewritten/.test(firstComment?.text ?? '') &&
      firstComment?.text.includes(`Page: ${FIXTURE}`) &&
      firstComment?.text.includes('Block: ExperiencesListWithFilters · #4821') &&
      (await createdCount()) === createdBeforeComment,
    firstComment?.text,
  );
  check(
    "its screenshot goes in the task's attachments, under the name the comment gives",
    commentShot?.task === 'open1' && commentShot.type === 'image/png' && firstComment?.text.includes(`Screenshot: ${commentShot.name}`),
    JSON.stringify(commentShot),
  );
  await shClick('[data-action="undo"]');
  const commentGone = await waitFor(() => /Comment deleted/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  check('Undo deletes the comment', commentGone && (await worker.evaluate(() => globalThis.__mock.deletedComments.includes('c1'))));

  // with "Review the rewrite" on, the comment's text is shown for a last edit
  await patchSettings({ reviewBeforeSend: true });
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  await waitTarget(/Adds a comment to Task open1/);
  await page.keyboard.type('page:reviewed comment');
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-on')));
  check(
    'the review shows only the comment, and which task it goes on',
    /A comment on Task open1/.test((await sh('.review-on')) ?? '') &&
      !(await sh('.review-title')) &&
      /^Fixed: reviewed comment[\s\S]*Page: /.test((await sh('.review-description', 'value')) ?? '') &&
      /Add comment/.test((await sh('[data-action="create"]')) ?? ''),
  );
  await page.screenshot({ path: `${outDir}/13-comment-review.png` });
  await appendLine('.review-description', 'Seen on the iPad too.');
  await ctrlEnter();
  await waitFor(() => /Comment added to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('the comment goes out as reviewed', (await worker.evaluate(() => globalThis.__mock.comments.at(-1)?.text))?.endsWith('Seen on the iPad too.'));
  await patchSettings({ reviewBeforeSend: false });

  // "New task instead" makes a task after all
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  await waitTarget(/Adds a comment to Task open1/);
  await shClick('[data-action="target-new"]');
  check('"New task instead" switches the note back to a task', /Makes a new task/.test(await targetText()) && /Create task/.test((await sh('.note-foot')) ?? ''));
  await page.keyboard.type('page:separate issue');
  await page.keyboard.press('Enter');
  await waitFor(() => /Task created/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('…and a task is made instead of a comment', (await createdCount()) === createdBeforeComment + 1 && (await worker.evaluate(() => globalThis.__mock.comments.length)) === 2);

  // the task just made is known at once: the next note about this block goes on it
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  check(
    'a task Pointer just made is known right away, without asking ClickUp',
    (await waitTarget(/Adds a comment to Fixed: separate issue/)) && (await worker.evaluate(() => globalThis.__mock.searched.length)) === 1,
    await targetText(),
  );
  // …and if it's closed before the comment goes out, the note says so and makes a new task instead
  await worker.evaluate(() => globalThis.__mock.closedIds.push('smoke1'));
  const commentsBeforeClosed = await worker.evaluate(() => globalThis.__mock.comments.length);
  await page.keyboard.type('page:after it closed');
  await page.keyboard.press('Enter');
  const saysClosed = await waitTarget(/was closed in the meantime, so this makes a new task/);
  check(
    'a task closed in the meantime gets no comment; the note says so and keeps the text',
    saysClosed && (await worker.evaluate(() => globalThis.__mock.comments.length)) === commentsBeforeClosed && (await sh('.note-input', 'value')) === 'page:after it closed',
    await targetText(),
  );
  const createdBeforeClosed = await createdCount();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 200 && (await createdCount()) === createdBeforeClosed; i++) await delay(50);
  check('…and Enter then makes a new task', (await createdCount()) === createdBeforeClosed + 1);
  await waitNote(false);

  // a block with no open task says so, and makes a task as usual
  const cardC = await (await page.$('.card:nth-child(3)')).boundingBox();
  await page.mouse.click(cardC.x + cardC.width / 2, cardC.y + 40);
  await waitNote(true);
  check('a block with no open task says a new task will be made', await waitTarget(/No open task on this block yet/), await targetText());
  await page.keyboard.press('Escape');
  await waitNote(false);

  // with page tasks, the page's open task takes the note straight away
  await patchSettings({ pageTask: true });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Page task');
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  const pageFound = await waitTarget(/Adds a comment to Task pg1/);
  check('with page tasks, the note goes on the page’s open task', pageFound && /Add comment/.test((await sh('.note-foot')) ?? ''), await targetText());
  await page.keyboard.type('page:on the page task');
  await page.keyboard.press('Enter');
  await waitFor(() => /Comment added to Task pg1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check(
    '…as a comment, not a pin waiting for Publish task',
    (await worker.evaluate(() => globalThis.__mock.comments.at(-1)?.task)) === 'pg1' && (await pins()) === 0 && (await sh('.publish-count'))?.trim() === '0',
  );
  check('every note since answered from the local list, without asking ClickUp again', (await worker.evaluate(() => globalThis.__mock.searched.length)) === 1);

  // ClickUp too slow to say whether there's an open task: the note says it's checking, Esc stops
  // the wait, and sending again goes ahead without the check after a few seconds
  await worker.evaluate(() => chrome.storage.local.remove('taskIndex')); // no local list yet, so ClickUp is asked
  await setListDelay(-1); // never answers
  const slowCard = await (await page.$('.card:nth-child(1)')).boundingBox();
  await page.mouse.click(slowCard.x + slowCard.width / 2, slowCard.y + 40);
  await waitNote(true);
  await page.keyboard.type('page:slow lookup');
  await page.keyboard.press('Enter');
  const checking = await waitFor(() => /Checking ClickUp for an open task/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.progress-label')?.textContent ?? '')).then(
    () => true,
    () => false,
  );
  check('while ClickUp is slow, the note says it is checking', checking);
  await page.keyboard.press('Escape');
  const stopped = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-input')?.value === 'page:slow lookup').then(
    () => true,
    () => false,
  );
  check('Esc stops the wait and gives the note back', stopped);
  const pinsBeforeSlow = await pins();
  await page.keyboard.press('Enter');
  const wentAhead = await waitFor(
    () => /added to the page task[\s\S]*Not checked for an open task/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent),
    // the wait is 8 s
  ).then(
    () => true,
    () => false,
  );
  check('after a few seconds it goes ahead without the check, and says so', wentAhead && (await pins()) === pinsBeforeSlow + 1, (await sh('.toast'))?.replace(/\s+/g, ' '));
  await setListDelay(0);
  await worker.evaluate(() => {
    globalThis.__mock.openTasks = [];
  });
  await worker.evaluate(() => chrome.storage.local.set({ pageTasks: {} }));
  await patchSettings({ commentMode: false, pageTask: false });

  // ---------- screen recording, for what a screenshot can't show ----------
  // Real clicks: the browser only shares the screen after one (a script's click doesn't count).
  const press = async (sel) => {
    const r = await shRect(sel);
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  };
  const recordingNow = () => page.evaluate(() => document.querySelector('#bid-pointer').classList.contains('is-recording'));
  const waitPreview = () =>
    waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-video'))).then(
      () => true,
      () => false,
    );
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitReady();
  await shClick('.launcher');
  const spotV = await ctaCentre();
  await page.mouse.click(spotV.x, spotV.y);
  await waitNote(true);
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
  await pickProject();
  check('the note offers Record screen', /Record screen/.test((await sh('[data-action="record"]')) ?? ''));
  await page.keyboard.type('page:hero flickers while scrolling');
  await press('[data-action="record"]');
  const started = await waitFor(() => document.querySelector('#bid-pointer').classList.contains('is-recording')).then(
    () => true,
    () => false,
  );
  check(
    'Record screen starts recording; the note steps aside for the recording bar',
    started && (await sh('.note', 'offsetParent')) === null && /Recording/.test((await sh('.recbar')) ?? ''),
    (await sh('.recbar'))?.replace(/\s+/g, ' '),
  );
  // the page is the person's while recording: a click doesn't open a note somewhere else
  const roomCard = await (await page.$('.card:nth-child(2)')).boundingBox();
  await page.mouse.click(roomCard.x + roomCard.width / 2, roomCard.y + 40);
  await page.mouse.wheel({ deltaY: 300 });
  await delay(1800);
  await page.screenshot({ path: `${outDir}/14-recording.png` });
  check('while recording, clicks go to the page, not to Pointer', (await recordingNow()) && (await sh('.note-block'))?.trim() === 'ExperiencesListWithFilters');
  await press('.recbar-stop');
  const previewed = await waitPreview();
  await page.evaluate(() => window.scrollTo(0, 0));
  await delay(300);
  check(
    'Stop brings the note back with the recording to preview',
    previewed &&
      !(await recordingNow()) &&
      /^blob:/.test((await sh('.note-video', 'src')) ?? '') &&
      /Screen recording · 0:0[1-9]/.test((await sh('.note-media')) ?? '') &&
      (await sh('.note-input', 'value')) === 'page:hero flickers while scrolling',
    (await sh('.note-media'))?.replace(/\s+/g, ' '),
  );
  const playable = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-video').readyState >= 1).then(
    () => true,
    () => false,
  );
  check('the preview plays the recording', playable);
  await page.screenshot({ path: `${outDir}/14-recording-preview.png` });
  // Remove takes it away; Record again makes another
  await shClick('[data-action="remove-video"]');
  check('Remove drops the recording', !(await sh('.note-video')) && /Record screen/.test((await sh('[data-action="record"]')) ?? ''));
  await press('[data-action="record"]');
  await waitFor(() => document.querySelector('#bid-pointer').classList.contains('is-recording'));
  await delay(1500);
  await press('.recbar-stop');
  await waitPreview();
  const shotsBeforeVideo = await worker.evaluate(() => globalThis.__mock.attachments.length);
  const createdBeforeVideo = await createdCount();
  await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-input').focus());
  await page.keyboard.press('Enter');
  for (let i = 0; i < 300 && (await createdCount()) === createdBeforeVideo; i++) await delay(50);
  await waitFor(() => /Screen recording attached/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).catch(() => {});
  const videoTask = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  const videoFiles = await worker.evaluate((n) => globalThis.__mock.attachments.slice(n), shotsBeforeVideo);
  const clip = videoFiles.find((f) => /^video\//.test(f.type));
  check(
    'the task goes out with the recording attached, named in its description, and no screenshot',
    Boolean(clip) &&
      /^pointer-experienceslistwithfilters-\d+\.mp4$/.test(clip.name) &&
      clip.type === 'video/mp4' &&
      clip.size > 10_000 &&
      videoFiles.length === 1 &&
      videoTask?.markdown_description?.includes(`**Video** ${clip.name} (0:0`),
    JSON.stringify(videoFiles),
  );
  check(
    'the toast says the recording is attached, and nothing about a screenshot',
    /Screen recording attached/.test((await sh('.toast')) ?? '') && !/Screenshot/.test((await sh('.toast')) ?? ''),
    (await sh('.toast'))?.replace(/\s+/g, ' '),
  );

  // a page-task note keeps its recording until Publish task; Esc stops a recording too
  await patchSettings({ pageTask: true });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Page task');
  await page.mouse.click(spotV.x, spotV.y);
  await waitNote(true);
  await page.keyboard.type('page:carousel jumps');
  await press('[data-action="record"]');
  await waitFor(() => document.querySelector('#bid-pointer').classList.contains('is-recording'));
  await delay(1500);
  await page.keyboard.press('Escape');
  check('Esc stops the recording', await waitPreview());
  await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-input').focus());
  await page.keyboard.press('Enter');
  await waitPins(1);
  const storedVideo = await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => k.startsWith('pageVideo:')).length);
  check('the page-task note keeps its recording until it is published', storedVideo === 1 && /screen recording/i.test((await sh('.toast')) ?? ''));
  const filesBeforePublish = await worker.evaluate(() => globalThis.__mock.attachments.length);
  await shClick('.publish');
  await waitFor(() => /Task created from 1 note/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const publishedWithVideo = await worker.evaluate(() => globalThis.__mock.created.at(-1));
  const publishedFiles = await worker.evaluate((n) => globalThis.__mock.attachments.slice(n), filesBeforePublish);
  check(
    'Publish task attaches each note’s recording under its number, without a screenshot',
    publishedFiles.length === 1 &&
      publishedFiles[0].name === 'pointer-1-experienceslistwithfilters.mp4' &&
      publishedFiles[0].type === 'video/mp4' &&
      publishedWithVideo?.markdown_description?.includes('**Video** pointer-1-experienceslistwithfilters.mp4') &&
      !publishedWithVideo?.markdown_description?.includes('**Screenshot**'),
    JSON.stringify(publishedFiles),
  );
  await worker.evaluate(() => chrome.storage.local.set({ pageTasks: {} }));
  await patchSettings({ pageTask: false });

  // ---------- a capture that changes size while it's recorded (scripts/recording-check.mjs) ----------
  const resizing = await b.newPage();
  await resizing.goto(FIXTURE, { waitUntil: 'load' });
  await resizing.addScriptTag({ content: await fixedSizeScript() });
  const resized = await resizing.evaluate(resizingRecording);
  await resizing.close();
  await page.bringToFront();
  check(
    'a capture that changes size (the sharing bar, a resized window) records at one size, bottom edge intact',
    !resized.error &&
      resized.mimeType.startsWith('video/mp4') &&
      resized.fixed === '1000x580' &&
      resized.sizes.join() === '1000x580' &&
      resized.frames >= 10 &&
      resized.brokenBottoms === 0,
    JSON.stringify(resized),
  );

  // ---------- a background left over from an older build ----------
  // Files replaced without reloading Pointer: new page script, old background. It says so and
  // sends nothing (an old background would drop a recording, say).
  await worker.evaluate(() => (globalThis.__pointerBuild = 'an-older-build'));
  await patchSettings({ _nudge: Date.now() });
  const saysReload = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Reload Pointer').then(
    () => true,
    () => false,
  );
  if (await shHas('.launcher', 'is-active')) await shClick('.launcher'); // out of point mode first
  await shClick('.launcher');
  await delay(200);
  check(
    'an out-of-date background is caught: the launcher asks for a reload, and says how',
    saysReload && !(await shHas('.launcher', 'is-active')) && /Pointer needs reloading[\s\S]*reload bid Pointer/.test((await sh('.toast')) ?? ''),
    (await sh('.toast'))?.replace(/\s+/g, ' '),
  );
  await worker.evaluate(() => delete globalThis.__pointerBuild);
  await patchSettings({ _nudge: Date.now() });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Pointer');

  // ---------- Send to ClickUp in Gmail (a stand-in conversation at mail.google.com) ----------
  await worker.evaluate((split) => Object.assign(globalThis.__mock, { emailSplit: split, uniqueIds: true }), EMAIL_SPLIT);
  await patchSettings({ reviewBeforeSend: false, domainProjects: {}, zaiKey: 'mock' });
  const mail = await b.newPage();
  const gmailLog = [];
  await mail.setRequestInterception(true);
  mail.on('request', (req) => {
    const hit = gmailRoute(req.url(), gmailLog);
    if (hit) req.respond({ status: 200, contentType: hit.contentType, body: hit.body });
    else req.continue();
  });
  mail.on('pageerror', (e) => console.log('gmail pageerror:', e.message));
  await mail.goto(GMAIL_URL, { waitUntil: 'load' });
  await mail.bringToFront();
  const mailNow = () => mail.evaluate(mailState);
  const mailWait = async (test, ms = 15_000) => {
    for (let i = 0; i < ms / 100; i++) {
      const s = await mailNow();
      if (test(s)) return s;
      await delay(100);
    }
    return mailNow();
  };
  const mocked = (key) => worker.evaluate((k) => globalThis.__mock[k], key);

  let st = await mailWait((s) => s.visible);
  check("Send to ClickUp sits in the expanded email's Reply / Forward row, after Gmail's buttons", st.visible && st.lastInRow && st.label === 'Send to ClickUp' && st.gold, JSON.stringify(st));
  check(
    '…as tall and round as Forward, in its type, level with it and the same gap away',
    st.button.h === st.forward.h && st.button.radius === st.forward.radius && st.button.font === st.forward.font && st.button.size === st.forward.size && st.button.top === st.forward.top && st.gap === 12,
    JSON.stringify({ button: st.button, forward: st.forward, gap: st.gap }),
  );
  await mail.evaluate(() => document.querySelector('.amn').scrollIntoView({ block: 'center' }));
  await delay(100);
  await mail.screenshot({ path: `${outDir}/g1-gmail-button.png` });
  await mail.evaluate(() => window.collapseLatest());
  st = await mailWait((s) => !s.visible);
  check('collapsing the email hides the button', !st.visible && st.hasButton);
  await mail.evaluate(() => window.expandLatest());
  st = await mailWait((s) => s.visible);
  check('expanding it brings the button back', st.visible);

  // review off, a sender Pointer hasn't met: only the project is asked for
  await mail.evaluate(pressSend);
  st = await mailWait((s) => s.toastBar !== null);
  check('with review off, the toast shows a progress bar while the email is read', st.toastBar !== null && /Splitting the email into tasks/.test(st.toast), `${st.toastBar}% · ${st.toast}`);
  st = await mailWait((s) => Boolean(s.sheet));
  check(
    'the first email from a sender asks only for the project, listing the tasks and questions',
    st.sheet?.compact && JSON.stringify(st.sheet.list) === JSON.stringify(EMAIL_TASKS) && st.sheet.createDisabled && st.sheet.questions[0] === 'When will the new spa page be live?',
    JSON.stringify(st.sheet),
  );
  check("pressing it never reached Gmail's row", st.rowClicks === 0, String(st.rowClicks));
  const prompt = (await mocked('emailPrompts')).at(-1);
  const read = prompt?.messages?.map((x) => x.text).join('\n') ?? '';
  check(
    'GLM gets the expanded email only: [image 1] in place, links written out, no trimmed quote or collapsed message',
    prompt?.messages?.length === 1 &&
      /52 m²\. Also "balcony"/.test(read) &&
      /Rooms \(https:\/\/www\.hotel-example\.hr\/en\/rooms\)/.test(read) &&
      /\[image 1\]/.test(read) &&
      !/Old quoted text|brochure|\[image 2\]/.test(read),
    read,
  );
  check(
    '…and is told about both files, the icon and the tracking pixel left out',
    JSON.stringify(prompt?.files?.map((f) => f.name)) === '["rooms-screenshot.png","wellness-hero.jpg"]' && prompt.files[0].where === 'shown as [image 1] in message 1',
    JSON.stringify(prompt?.files),
  );
  await mail.screenshot({ path: `${outDir}/g2-gmail-project.png` });
  const createdBeforeMail = (await mocked('created')).length;
  const filesBeforeMail = (await mocked('attachments')).length;
  await mail.evaluate(reviewCreate, '901417200456');
  st = await mailWait((s) => /4 tasks created/.test(s.toast), 20_000);
  check(
    'the tasks are made; the toast links them and lists the question to answer',
    /4 tasks created in Cresanka › Development/.test(st.toast) && JSON.stringify(st.toastLinks) === JSON.stringify(EMAIL_TASKS) && /To answer: “When will the new spa page be live\?”/.test(st.toast),
    st.toast,
  );
  const made = (await mocked('created')).slice(createdBeforeMail);
  const mailFiles = (await mocked('attachments')).slice(filesBeforeMail);
  check(
    'four tasks with the planned names, tags and people; the price bug high priority',
    made.map((t) => t.name).join('|') === EMAIL_TASKS.join('|') &&
      made.every((t) => t.tags.join() === 'pointer,email' && t.assignees[0] === 1) &&
      made[3].priority === 2 &&
      made.slice(0, 3).every((t) => t.priority === undefined),
    JSON.stringify(made.map((t) => ({ name: t.name, to: t.assignees, priority: t.priority, tags: t.tags }))),
  );
  check(
    'descriptions quote the client, link the page and the email, and name their images',
    made[0]?.markdown_description.includes('> On the Rooms page the Deluxe Suite still says 45 m², it should be 52 m².') &&
      made[0].markdown_description.includes('[Open in Gmail](https://mail.google.com/mail/u/0/#all/FMfcgzQXJWDsKmzVvzRJLhmnZvdPxbMx)') &&
      made[0].markdown_description.includes('**Page** [Rooms page](https://www.hotel-example.hr/en/rooms)') &&
      made[0].markdown_description.includes('**Image** rooms-screenshot.png'),
    made[0]?.markdown_description,
  );
  const id = (i) => `mail${createdBeforeMail + i}`;
  check(
    'each image goes on its task: the original screenshot on Rooms, the photo on Wellness',
    mailFiles.length === 2 &&
      mailFiles[0].task === id(1) &&
      mailFiles[0].name === 'rooms-screenshot.png' &&
      mailFiles[0].size === ORIGINAL.length &&
      mailFiles[1].task === id(3) &&
      mailFiles[1].name === 'wellness-hero.jpg' &&
      mailFiles[1].type === 'image/jpeg',
    JSON.stringify(mailFiles),
  );
  check(
    'files are downloaded the way Gmail does: the screenshot as its original, the attachment as a download',
    gmailLog.some((u) => /attid=0\.1/.test(u) && /view=att/.test(u) && /pointer=/.test(u)) && gmailLog.some((u) => /attid=0\.2/.test(u) && /disp=safe/.test(u) && /pointer=/.test(u)),
    gmailLog.filter((u) => /pointer=/.test(u)).join('\n'),
  );
  st = await mailWait((s) => s.label === 'Sent to ClickUp');
  check('the button now says the email is in ClickUp', st.label === 'Sent to ClickUp', st.label);
  check(
    "the project is remembered for the sender's domain",
    await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.domainProjects['hotel-example.hr']?.listId === '901417200456'),
  );
  await mail.screenshot({ path: `${outDir}/g3-gmail-created.png` });
  await mail.evaluate(toastButton, 'Undo');
  st = await mailWait((s) => /Tasks deleted/.test(s.toast));
  const deletedMail = await mocked('deleted');
  st = await mailWait((s) => s.label === 'Send to ClickUp');
  check(
    'Undo deletes all four, and the email counts as not sent again',
    [1, 2, 3, 4].every((i) => deletedMail.includes(`/task/${id(i)}`)) && st.label === 'Send to ClickUp',
    JSON.stringify(deletedMail.slice(-4)),
  );

  // review on: every task can be changed first; closing keeps the edits
  await patchSettings({ reviewBeforeSend: true });
  const promptsBefore = (await mocked('emailPrompts')).length;
  await mail.evaluate(pressSend);
  st = await mailWait((s) => Boolean(s.progress));
  check(
    'with review on, the sheet opens at once and shows the progress: read, copying the images, splitting',
    st.progress?.steps.length === 3 &&
      st.progress.steps[0] === 'Read the email ✓' &&
      /^Copying 2 images/.test(st.progress.steps[1] ?? '') &&
      /^Splitting it into tasks usually about 15 seconds …$/.test(st.progress.steps[2] ?? '') &&
      st.progress.bar > 0,
    JSON.stringify(st.progress),
  );
  await delay(600);
  await mail.screenshot({ path: `${outDir}/g4-gmail-progress.png` });
  st = await mailWait((s) => Boolean(s.sheet && !s.sheet.compact));
  check(
    'then each task is shown, the remembered project already chosen',
    JSON.stringify(st.sheet?.names) === JSON.stringify(EMAIL_TASKS) &&
      st.sheet.project === '901417200456' &&
      st.sheet.files.join('|') === 'rooms-screenshot.png|wellness-hero.jpg' &&
      /^Suggested: Smoke Test \(CMS content/.test(st.sheet.why[0] ?? ''),
    JSON.stringify(st.sheet),
  );
  check(
    'the review is wide and each task a compact row: its instructions in a few lines, the description folded',
    st.sheet.width >= 900 &&
      st.sheet.rowHeight > 0 &&
      st.sheet.rowHeight <= 160 &&
      st.sheet.descriptionsShown === 0 &&
      JSON.stringify(st.sheet.previews[0]) ===
        JSON.stringify(["On the Rooms page, change the Deluxe Suite's size from 45 m² to 52 m².", 'Correct the spelling of "balcony" in the Superior Room text on the Rooms page.']),
    JSON.stringify({ width: st.sheet.width, rowHeight: st.sheet.rowHeight, shown: st.sheet.descriptionsShown, previews: st.sheet.previews }),
  );
  await mail.screenshot({ path: `${outDir}/g5-gmail-review.png` });
  await mail.evaluate(() => {
    const field = document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll('.mail-task .mail-name')[1];
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  await mail.keyboard.type(' now');
  await mail.evaluate(() => document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-file').click());
  await delay(100);
  st = await mailNow();
  check("typing in the review never reaches Gmail's keyboard shortcuts", st.gmailKeys.length === 0 && st.sheet.names[1] === 'Make Book Now more visible on mobile now', JSON.stringify(st.gmailKeys));
  await mail.keyboard.press('Escape');
  st = await mailWait((s) => !s.sheet);
  await mail.evaluate(pressSend);
  st = await mailWait((s) => Boolean(s.sheet));
  check(
    'closing keeps the edits: reopening shows them, without asking GLM again',
    st.sheet?.names[1] === 'Make Book Now more visible on mobile now' && st.sheet.files[0] === 'rooms-screenshot.png (off)' && (await mocked('emailPrompts')).length === promptsBefore + 1,
    JSON.stringify(st.sheet),
  );
  // people: the tasks after the first take its person until one is picked for them
  check(
    "every task starts with the first task's person, and says so",
    JSON.stringify(st.sheet?.people) === '["1","1","1","1"]' &&
      /^Same person as task 1, unless that's Mate\. Suggested: Smoke Test/.test(st.sheet.why[1] ?? '') &&
      /The other tasks get this person too/.test(st.sheet.why[0] ?? ''),
    JSON.stringify({ people: st.sheet?.people, why: st.sheet?.why }),
  );
  await mail.waitForFunction(() => Boolean(document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-task .mail-person option[value="82460956"]')), { timeout: 10_000 });
  await mail.evaluate(pickPerson, 0, '82460956'); // task 1 → Tea
  st = await mailNow();
  check("changing the first task's person changes every task following it", JSON.stringify(st.sheet?.people) === '["82460956","82460956","82460956","82460956"]', JSON.stringify(st.sheet?.people));
  await mail.evaluate(pickPerson, 2, '106460192'); // task 3 → Leo, by hand
  await mail.evaluate(pickPerson, 0, '118313848'); // task 1 → Mate
  st = await mailNow();
  check(
    "a task picked by hand goes its own way; ones Mate shouldn't take don't follow the first to Mate",
    JSON.stringify(st.sheet?.people) === '["118313848","82460956","106460192","82460956"]' && /^Suggested: Smoke Test/.test(st.sheet.why[2] ?? ''),
    JSON.stringify({ people: st.sheet?.people, why: st.sheet?.why }),
  );
  // each row's own controls: the pencil (or the summary) opens the description, the date chip sets a
  // due date, × leaves the task out and the arrow puts it back
  check('every row starts without a due date, the description folded', JSON.stringify(st.sheet?.dues) === JSON.stringify(Array(4).fill('No due date')) && st.sheet.descriptionsShown === 0, JSON.stringify(st.sheet?.dues));
  await mail.evaluate(taskAction, 0, 'edit');
  const editorOpened = (await mailNow()).sheet?.descriptionsShown === 1;
  await mail.evaluate(taskAction, 0, 'edit');
  const editorClosed = (await mailNow()).sheet?.descriptionsShown === 0;

  // the date chip opens Pointer's own calendar on a real click; Esc closes just the calendar
  const chipAt = await mail.evaluate(() => {
    const r = document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll('.mail-task .mail-due')[2].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await mail.mouse.click(chipAt.x, chipAt.y);
  const calendar = await mail.evaluate(() => {
    const root = document.querySelector('#bid-pointer-mail').shadowRoot;
    const cal = root.querySelector('.mail-cal');
    return cal ? { month: cal.querySelector('.mail-cal-month').textContent, days: cal.querySelectorAll('.mail-cal-day').length, focused: cal.contains(root.activeElement) } : null;
  });
  await mail.screenshot({ path: `${outDir}/g5c-gmail-calendar.png` });
  await mail.keyboard.press('Escape');
  await delay(100);
  st = await mailNow();
  const calendarGone = await mail.evaluate(() => !document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-cal'));
  check(
    'a click on the date chip opens a calendar, focused on a day; Esc closes just the calendar',
    Boolean(calendar && calendar.days === 42 && calendar.focused) && calendarGone && Boolean(st.sheet),
    JSON.stringify({ calendar, calendarGone }),
  );
  await mail.evaluate(setDue, 2, '2026-11-02');
  const picked = (await mailNow()).sheet?.dues[2];
  await mail.evaluate(clearDue, 2);
  st = await mailNow();
  check('picking a day sets the chip; No due date clears it', picked === 'Mon 02.11.2026' && st.sheet?.dues[2] === 'No due date', `${picked} → ${st.sheet?.dues[2]}`);
  await mail.evaluate(setDue, 3, '2026-10-23');
  await mail.evaluate(taskAction, 1, 'out');
  st = await mailNow();
  check(
    'the pencil opens and folds the description, the date chip takes a date, × leaves a task out',
    editorOpened && editorClosed && st.sheet?.dues[3] === 'Fri 23.10.2026' && JSON.stringify(st.sheet.out) === '[false,true,false,false]' && st.sheet.create === 'Create 3 tasks',
    JSON.stringify({ editorOpened, editorClosed, dues: st.sheet?.dues, out: st.sheet?.out, create: st.sheet?.create }),
  );
  await mail.screenshot({ path: `${outDir}/g5b-gmail-row-controls.png` });
  await mail.evaluate(taskAction, 1, 'out');
  st = await mailNow();
  check('the arrow puts the task back', JSON.stringify(st.sheet?.out) === '[false,false,false,false]' && st.sheet.create === 'Create 4 tasks', st.sheet?.create);
  const createdBeforeReview = (await mocked('created')).length;
  const filesBeforeReview = (await mocked('attachments')).length;
  await mail.evaluate(reviewCreate);
  st = await mailWait((s) => /4 tasks created/.test(s.toast), 20_000);
  const reviewed = (await mocked('created')).slice(createdBeforeReview);
  const reviewedFiles = (await mocked('attachments')).slice(filesBeforeReview);
  check(
    'the tasks go out as reviewed: the new name and people, the screenshot left off and out of the description',
    reviewed[1]?.name === 'Make Book Now more visible on mobile now' &&
      JSON.stringify(reviewed.map((t) => t.assignees[0])) === '[118313848,82460956,106460192,82460956]' &&
      !reviewed[0]?.markdown_description.includes('rooms-screenshot.png') &&
      reviewedFiles.length === 1 &&
      reviewedFiles[0].name === 'wellness-hero.jpg',
    JSON.stringify({ names: reviewed.map((t) => t.name), people: reviewed.map((t) => t.assignees), files: reviewedFiles }),
  );
  check(
    '…and the due date set in the review reaches ClickUp and the description',
    reviewed[3]?.due_date === new Date('2026-10-23T12:00:00').getTime() && reviewed[3].due_date_time === false && reviewed[3].markdown_description.includes('**Due** Fri 23.10.2026'),
    JSON.stringify({ due: reviewed[3]?.due_date, time: reviewed[3]?.due_date_time }),
  );

  // in ClickUp already: the button says so, and offers to send again (review off: straight in)
  await patchSettings({ reviewBeforeSend: false });
  await mailWait((s) => s.label === 'Sent to ClickUp');
  await mail.evaluate(pressSend);
  st = await mailWait((s) => /Already in ClickUp/.test(s.toast));
  check('pressing it again says the email is in ClickUp already and links the tasks', /Already in ClickUp/.test(st.toast) && st.toastLinks.length === 4, st.toast);
  const createdBeforeAgain = (await mocked('created')).length;
  await mail.evaluate(toastButton, 'Send again');
  st = await mailWait((s) => /4 tasks created/.test(s.toast), 20_000);
  check('Send again with review off goes straight to ClickUp, into the remembered project', /4 tasks created in Cresanka › Development/.test(st.toast) && !st.sheet && (await mocked('created')).length === createdBeforeAgain + 4, st.toast);

  // an email naming another project (here in its subject) beats the sender's last choice: asked first, not remembered
  await mail.evaluate(() => (document.querySelector('h2.hP').textContent = 'Website changes for Bluesun'));
  await mail.evaluate(pressSend);
  await mailWait((s) => /Already in ClickUp/.test(s.toast));
  await mail.evaluate(toastButton, 'Send again');
  st = await mailWait((s) => Boolean(s.sheet), 20_000);
  check(
    'an email naming another project in its subject is shown first, with that project chosen and why',
    st.sheet?.compact &&
      st.sheet.project === '901407290920' &&
      st.sheet.projectWhy === 'Recognized: its name is in the subject. The last choice for @hotel-example.hr was Cresanka › Development.',
    JSON.stringify({ compact: st.sheet?.compact, project: st.sheet?.project, why: st.sheet?.projectWhy }),
  );
  await delay(400); // the sheet's fade-in
  await mail.screenshot({ path: `${outDir}/g6-gmail-recognized.png` });
  await mail.evaluate(reviewCreate);
  st = await mailWait((s) => /4 tasks created in Bluesun/.test(s.toast), 20_000);
  const usual = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.domainProjects['hotel-example.hr']?.listId);
  check('…the tasks go there, and the sender keeps its usual project', /4 tasks created in Bluesun/.test(st.toast) && usual === '901417200456', `${st.toast} · remembered ${usual}`);
  await mail.close();

  // ---------- Send to ClickUp in HubSpot (a stand-in Help Desk ticket at app-eu1.hubspot.com) ----------
  await worker.evaluate((split, file) => Object.assign(globalThis.__mock, { emailSplit: split, uniqueIds: true, hubspotFile: file }), HUBSPOT_SPLIT, HS_ATTACHED.toString('base64'));
  await patchSettings({ reviewBeforeSend: false, domainProjects: {} });
  const hub = await b.newPage();
  const hubLog = [];
  await hub.setRequestInterception(true);
  hub.on('request', (req) => {
    const hit = hubspotRoute(req.url(), hubLog);
    if (hit) req.respond({ status: hit.status ?? 200, contentType: hit.contentType, body: hit.body });
    else if (req.url().startsWith('https://app-eu1.hubspot.com/')) req.respond({ status: 404, contentType: 'text/plain', body: '' });
    else req.continue();
  });
  hub.on('pageerror', (e) => console.log('hubspot pageerror:', e.message));
  await hub.goto(HUBSPOT_URL, { waitUntil: 'load' });
  await hub.bringToFront();
  const hubNow = () => hub.evaluate(hubspotState);
  const hubWait = async (test, ms = 15_000) => {
    for (let i = 0; i < ms / 100; i++) {
      const s = await hubNow();
      if (test(s)) return s;
      await delay(100);
    }
    return hubNow();
  };

  let hs = await hubWait((s) => s.visible);
  check(
    "Send to ClickUp sits left of the ticket's Actions button in HubSpot",
    hs.visible && hs.beforeActions && hs.label === 'Send to ClickUp' && hs.gold && hs.title === "Turn the ticket's emails into ClickUp tasks",
    JSON.stringify({ visible: hs.visible, before: hs.beforeActions, label: hs.label, title: hs.title }),
  );
  check(
    '…as tall and round as Actions, in its type, level with it and 8 px away',
    hs.button.h === hs.actions.h && hs.button.radius === hs.actions.radius && hs.button.font === hs.actions.font && hs.button.size === hs.actions.size && hs.button.top === hs.actions.top && hs.gap === 8,
    JSON.stringify({ button: hs.button, actions: hs.actions, gap: hs.gap }),
  );
  await hub.evaluate(() => document.fonts.ready);
  await hub.screenshot({ path: `${outDir}/h1-hubspot-button.png` });
  await hub.evaluate(() => window.rerenderTools());
  hs = await hubWait((s) => s.beforeActions);
  check('when HubSpot redraws the row, the button goes back beside Actions', hs.beforeActions && hs.visible);
  await hub.evaluate(() => window.hideThread());
  hs = await hubWait((s) => !s.visible);
  check('a ticket without emails on the page shows no button', !hs.visible && hs.hasButton);
  await hub.evaluate(() => window.showThread());
  hs = await hubWait((s) => s.visible);

  // review off and a sender Pointer hasn't met: the ticket's name says which project, asked once
  const workerFilesBefore = (await mocked('hubspotFiles')).length; // files download while GLM reads
  await hub.evaluate(pressHubSpotSend);
  hs = await hubWait((s) => Boolean(s.sheet));
  check(
    "the project is recognized from the ticket's name and asked once, the tasks listed",
    hs.sheet?.compact &&
      hs.sheet.project === LUMEN.listId &&
      hs.sheet.projectWhy === "Recognized: its name is in the ticket's name." &&
      JSON.stringify(hs.sheet.list) === JSON.stringify(HUBSPOT_TASKS) &&
      /Ticket #100200300400: Redirekcijski lanac Lumen/.test(hs.sheet.from),
    JSON.stringify(hs.sheet),
  );
  check("pressing it never reached HubSpot's header", hs.headerClicks === 0, String(hs.headerClicks));
  const hsPrompt = (await mocked('emailPrompts')).at(-1);
  const hsTexts = hsPrompt?.messages?.map((x) => x.text) ?? [];
  check(
    "GLM reads the ticket: its name as the subject, both client emails, the agent's reply as context only",
    hsPrompt?.subject === 'Redirekcijski lanac Lumen' &&
      hsPrompt.messages.length === 3 &&
      !hsPrompt.messages[0].context_only &&
      hsPrompt.messages[1].context_only === true &&
      !hsPrompt.messages[2].context_only &&
      hsPrompt.messages[0].from === 'Lea Novak <lea@seaside-marketing.example>' &&
      hsPrompt.messages[1].from === 'Tea Babić' &&
      /^\w+day \d{4}-10-22 13:25$/.test(hsPrompt.messages[0].sent) &&
      /^\w+day \d{4}-10-23 09:40$/.test(hsPrompt.messages[2].sent) &&
      hsTexts[0].includes('https://docs.google.com/spreadsheets/d/1ExampleSheet') &&
      /E: lea@seaside-marketing\.example\n+\[image 1\]\n+Before you print/.test(hsTexts[0]) &&
      /\[image 2\]/.test(hsTexts[2]),
    JSON.stringify(hsPrompt?.messages),
  );
  check(
    '…and is told about the logo, the inline screenshot and the attachment; the tiny icon is left out',
    JSON.stringify(hsPrompt?.files?.map((f) => `${f.name} · ${f.where}`)) ===
      JSON.stringify(['image-1.png · shown as [image 1] in message 1', 'image-2.png · shown as [image 2] in message 3', 'redirect-loop.png · attached to message 3']),
    JSON.stringify(hsPrompt?.files),
  );
  await delay(300);
  await hub.screenshot({ path: `${outDir}/h2-hubspot-project.png` });
  const createdBeforeHub = (await mocked('created')).length;
  const filesBeforeHub = (await mocked('attachments')).length;
  await hub.evaluate(reviewCreate);
  hs = await hubWait((s) => /2 tasks created/.test(s.toast), 20_000);
  check('two tasks are made in Lumen', /2 tasks created in Lumen/.test(hs.toast) && JSON.stringify(hs.toastLinks) === JSON.stringify(HUBSPOT_TASKS), hs.toast);
  const hubMade = (await mocked('created')).slice(createdBeforeHub);
  check(
    "the ticket's owner gets the task Mate shouldn't take and Mate the small fix; both high priority as the ticket is; tagged hubspot",
    hubMade.length === 2 &&
      hubMade[0].assignees[0] === 82460956 &&
      hubMade[1].assignees[0] === 118313848 &&
      hubMade.every((t) => t.priority === 2 && t.tags.join() === 'pointer,email,hubspot'),
    JSON.stringify(hubMade.map((t) => ({ name: t.name, to: t.assignees, priority: t.priority, tags: t.tags }))),
  );
  const hubDescription = hubMade[0]?.markdown_description ?? '';
  check(
    'descriptions link the ticket, say what HubSpot says about it, and link the spreadsheet',
    hubDescription.startsWith(
      '🎫 HubSpot [#100200300400](https://app-eu1.hubspot.com/contacts/147607823/record/0-5/100200300400) · Email from **Lea Novak** (lea@seaside-marketing.example) · ',
    ) &&
      hubDescription.includes('\n**Ticket** Redirekcijski lanac Lumen\n**Company** Seaside Marketing · **Owner** Tea Babić\n**Priority** High (HubSpot ticket priority: High)') &&
      hubDescription.includes(`**Link** [Google Sheet](${SHEET})`) &&
      hubDescription.includes('**Image** redirect-loop.png') &&
      hubDescription.includes('> Ljubazno vas molim da provjerite što uzrokuje navedene redirect loopove i možete li ih ispraviti.') &&
      /\nSent from HubSpot with Pointer · /.test(hubDescription),
    hubDescription,
  );
  const hubAttached = (await mocked('attachments')).slice(filesBeforeHub);
  const hubId = (i) => `mail${createdBeforeHub + i}`;
  check(
    'each screenshot goes on its task, the inline one as its original; the signature logo goes on none',
    hubAttached.length === 2 &&
      hubAttached.some((a) => a.task === hubId(1) && a.name === 'redirect-loop.png' && a.size === HS_ATTACHED.length) &&
      hubAttached.some((a) => a.task === hubId(2) && a.name === 'image-2.png' && a.size === HS_ORIGINAL.length),
    JSON.stringify(hubAttached),
  );
  const viaWorker = (await mocked('hubspotFiles')).slice(workerFilesBefore);
  check(
    "files are downloaded as HubSpot does; one HubSpot's file server keeps from the page comes through the background, with the person's session",
    hubLog.some((u) => /\/files\/301\/signed-url-redirect\?&?portalId=147607823$/.test(u)) &&
      hubLog.some((u) => /\/files\/302\//.test(u)) &&
      viaWorker.length === 1 &&
      /\/files\/302\//.test(viaWorker[0].url) &&
      viaWorker[0].credentials === 'include',
    JSON.stringify({ page: hubLog, background: viaWorker }),
  );
  hs = await hubWait((s) => s.label === 'Sent to ClickUp');
  check('the button now says the ticket is in ClickUp', hs.label === 'Sent to ClickUp', hs.label);
  check(
    "a project the ticket's name chose isn't remembered for the sender",
    await worker.evaluate(async () => !(await chrome.storage.local.get('settings')).settings.domainProjects['seaside-marketing.example']),
  );
  await hub.screenshot({ path: `${outDir}/h3-hubspot-created.png` });
  await hub.evaluate(toastButton, 'Undo');
  hs = await hubWait((s) => s.label === 'Send to ClickUp');

  // review on: the owner is named as the reason, and both tasks start high priority
  await patchSettings({ reviewBeforeSend: true });
  await hub.evaluate(pressHubSpotSend);
  hs = await hubWait((s) => Boolean(s.sheet && !s.sheet.compact), 20_000);
  check(
    "with review on, the ticket's owner is the suggested person and the tasks start high priority",
    JSON.stringify(hs.sheet?.names) === JSON.stringify(HUBSPOT_TASKS) &&
      JSON.stringify(hs.sheet.people) === '["82460956","82460956"]' &&
      JSON.stringify(hs.sheet.priorities) === '["high","high"]' &&
      /^Suggested: Tea Babić, the ticket's owner \(more than one small change\)\. The other tasks get this person too/.test(hs.sheet.why[0] ?? '') &&
      JSON.stringify(hs.sheet.files) === '["redirect-loop.png","image-2.png"]',
    JSON.stringify(hs.sheet),
  );
  await delay(400);
  await hub.screenshot({ path: `${outDir}/h4-hubspot-review.png` });
  await hub.keyboard.press('Escape');
  hs = await hubWait((s) => !s.sheet);
  check("Esc in the review closes it without reaching HubSpot's shortcuts", !hs.sheet && hs.hubspotKeys.length === 0, JSON.stringify(hs.hubspotKeys));
  await patchSettings({ reviewBeforeSend: false });
  await hub.close();
  await page.bringToFront();

  // ---------- the SEO check, on a stand-in staging page (scripts/seo-check.mjs) ----------
  // The page and its files are served by request interception; the background's own fetch of the
  // page (is staging behind Vercel's login?) gets the login's 401 from the worker.
  await worker.evaluate((host) => {
    const before = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      new URL(typeof input === 'string' ? input : input.url).hostname === host ? Promise.resolve(new Response('Log in to Vercel', { status: 401 })) : before(input, init);
  }, SEO_HOST);
  await patchSettings({ hostProjects: SEO_PROJECT });
  const seoPage = await b.newPage();
  await seoPage.setRequestInterception(true);
  seoPage.on('request', (req) => {
    const r = seoRoute(req.url());
    if (r) void req.respond(r);
    else void req.continue();
  });
  await seoPage.goto(`https://${SEO_HOST}${SEO_PATH}`, { waitUntil: 'load' });
  await seoPage.bringToFront();
  await seoPage.waitForSelector('#bid-pointer', { timeout: 10000 });
  await runSeo({
    page: seoPage,
    check,
    delay,
    shot: (name) => `${outDir}/${name}`,
    created: () => worker.evaluate(() => globalThis.__mock.created),
    deleted: () => worker.evaluate(() => globalThis.__mock.deleted),
    patchSettings,
  });
  await seoPage.close();
  await page.bringToFront();

  // options page with history, for visual review
  await patchSettings({
    zaiKey: '',
    hostProjects: {
      'localhost:8765': { listId: '901417200456', label: 'Cresanka › Development' },
      'pages-bluesun': { listId: '901407290920', label: 'Bluesun' },
    },
    recent: [
      { id: 'a', url: 'https://app.clickup.com/t/a', name: 'ExperiencesListWithFilters: Book now button overlaps the title on mobile', createdAt: Date.now(), projectLabel: 'Cresanka › Development', screenshot: true },
      { id: 'b', url: 'https://app.clickup.com/t/b', name: 'Hero: Headline is cut off on tablets', createdAt: Date.now() - 3_600_000, projectLabel: 'Bluesun', screenshot: false, screenshotError: 'upload failed: ClickUp 400: Attachment too large' },
      { id: 'c', url: 'https://app.clickup.com/t/c', name: 'RoomList: Prices show without a currency', createdAt: Date.now() - 86_400_000, projectLabel: 'Bluesun' },
    ],
  });
  const filled = await b.newPage();
  filled.on('pageerror', (e) => console.log('options pageerror:', e.message));
  filled.on('console', (m) => {
    if (m.type() === 'error') console.log('options console.error:', m.text());
  });
  await stubClickUp(filled);
  await filled.goto(optionsUrl, { waitUntil: 'load' });
  await filled.waitForFunction(() => Boolean(document.querySelector('#defaultAssignee option[value="82460956"]')), { timeout: 5000 }).catch(() => {});
  await filled.evaluate(() => document.fonts.ready);
  await delay(300);
  await filled.screenshot({ path: `${outDir}/9-options.png`, fullPage: true });
  check('options list recent tasks', (await filled.$$eval('.tasks > li', (els) => els.length)) === 3);
  const masked = await filled.$eval('#tokenValue', (el) => el.textContent);
  check('a real token is masked to its prefix and last four', masked === 'pk_••••••••••••3F7A', masked);
  await filled.close();
} finally {
  await b.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed (${browser})`);
process.exit(failed ? 1 : 0);
