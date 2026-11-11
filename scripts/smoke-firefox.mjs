// Firefox smoke test: installs dist-firefox/ into real Firefox (Zen runs the same engine and
// add-on), walks the main flow on a local fixture and on fake live domains, and saves
// screenshots to tests/out/firefox-*. ClickUp and Z.ai are mocked inside the add-on's
// background page; nothing reaches the real APIs.
// Usage: node scripts/smoke-firefox.mjs [--headed] [--firefox=path/to/firefox.exe] [--dir=folder]
// (--dir tests another build of the add-on; its manifest needs the gecko id pointer@bid.hr)
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixedSizeScript, resizingRecording } from './recording-check.mjs';
import { confettiAlpha, dockState, followers, launcherSpot, partyState, pressAndDrag, spinDock, wiggleDock } from './dock-check.mjs';
import { EMAIL_SPLIT, EMAIL_TASKS, GMAIL_URL, ORIGINAL, gmailRoute, mailState, pressSend, reviewCreate, setDue, toastButton } from './gmail-check.mjs';
import { HS_ATTACHED, HS_ORIGINAL, HUBSPOT_SPLIT, HUBSPOT_TASKS, HUBSPOT_URL, LUMEN, SHEET, hubspotRoute, hubspotState, pressHubSpotSend } from './hubspot-check.mjs';
import { SEO_HOST, SEO_PATH, SEO_PROJECT, runSeo, seoRoute } from './seo-check.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const FIREFOX = args.firefox ?? 'C:/Program Files/Mozilla Firefox/firefox.exe';
const dist = resolve(args.dir ?? 'dist-firefox');
const outDir = resolve('tests/out');
mkdirSync(outDir, { recursive: true });
if (!existsSync(resolve(dist, 'manifest.json'))) throw new Error('Run `pnpm build` first');

const UUID = '0b1d0000-0000-4000-8000-0000000b1d01';
const BASE = `moz-extension://${UUID}`;
const PORT = 8766;

// Fake live domains resolve to this machine (network.dns.localDomains below).
const fixture = readFileSync(resolve('tests/fixture/index.html'), 'utf8');
const liveFixture = (footer) =>
  fixture.replace('<span>[ExperiencesListWithFilters - 4821]</span>', '').replace('<footer>Footer without a debug block</footer>', footer);
const pages = {
  localhost: fixture,
  'www.cresanka.test': liveFixture('<footer>© 2026 Cresanka d.o.o. Powered by <a href="https://bid.agency/en">bid.</a></footer>'),
  'www.example-hotel.test': liveFixture('<footer>© 2026 Example Hotel. Place a bid for the honeymoon suite.</footer>'),
  'cresanka-staging.vercel.app': fixture,
  'someone-else.vercel.app': fixture.replace('<footer>Footer without a debug block</footer>', '<footer>Made by someone else</footer>'),
};
const server = createServer((req, res) => {
  // the SEO check's stand-in staging site, with its robots.txt, sitemap, images, 404 and redirect
  const seo = seoRoute(`http://${req.headers.host}${req.url}`);
  if (seo) {
    res.writeHead(seo.status, { 'Content-Type': seo.contentType, ...seo.headers });
    return void res.end(seo.body);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pages[(req.headers.host ?? '').split(':')[0]] ?? fixture);
}).listen(PORT);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const info = (text) => console.log(`info ${text}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// Firefox never reports load events for moz-extension:// pages over WebDriver BiDi, so don't
// wait on navigation; wait for the page's own content instead.
const openExtensionPage = async (p, url, ready) => {
  await p.goto(url, { timeout: 3000 }).catch(() => {});
  // waitForFunction compiles with Function(), which the add-on page's CSP blocks; poll instead
  for (let i = 0; i < 150; i++) {
    const ok = await p.evaluate((sel) => document.readyState === 'complete' && Boolean(document.querySelector(sel)), ready).catch(() => false);
    if (ok) return;
    await delay(100);
  }
  throw new Error(`${url} never showed ${ready}`);
};
// Firefox 15x won't screenshot moz-extension:// pages over WebDriver BiDi ("privileged scope");
// web pages still work, so only the options page's screenshots are skipped.
const extensionScreenshot = (p, path) =>
  p.screenshot({ path, fullPage: true }).catch((e) => info(`no screenshot of ${path.split(/[\\/]/).pop()}: ${e.message.split('\n')[0]}`));

const b = await puppeteer.launch({
  browser: 'firefox',
  executablePath: FIREFOX,
  headless: !('headed' in args),
  // Since Firefox 15x, WebDriver BiDi can't open or script moz-extension:// pages without it
  args: ['-remote-allow-system-access'],
  defaultViewport: { width: 1280, height: 800 },
  extraPrefsFirefox: {
    'extensions.webextensions.uuids': JSON.stringify({ 'pointer@bid.hr': UUID }),
    'network.dns.localDomains': [...Object.keys(pages).filter((h) => h !== 'localhost'), SEO_HOST].join(','),
    // .app is on the HSTS preload list; the fake vercel.app hosts are served over plain http
    'network.stricttransportsecurity.preloadlist': false,
    'dom.security.https_first': false,
  },
});

try {
  info(`browser ${await b.version()}`);
  check('add-on installs', (await b.installExtension(dist)) === 'pointer@bid.hr');

  // ---------- options page ----------
  const opts = await b.newPage();
  await openExtensionPage(opts, `${BASE}/options.html`, '#setupSteps');
  await delay(500);
  check('options page renders', (await opts.title()) === 'bid Pointer options', await opts.title());
  check('site access granted at install', await opts.$eval('#accessGroup', (el) => el.hidden));
  check('first run shows the walkthrough', await opts.$eval('#setupSteps', (el) => el.offsetParent !== null));
  await extensionScreenshot(opts, `${outDir}/firefox-0-setup.png`);
  const shown = await opts.$$eval('#shortcutKeys kbd', (els) => els.map((el) => el.textContent).join('+'));
  info(`shortcut Firefox reports: ${shown || '(none bound)'}`);

  // seed settings, and mock ClickUp and Z.ai inside the background page
  await opts.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        // bid's own setup, as its people enter it on the options page (Firefox asked for the OK at install)
        sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
        footerCredit: 'bid.agency, bid.hr',
        codingAgent: true,
        zaiKey: 'mock',
        clickupToken: 'pk_mock',
        clickupUser: { id: 1, username: 'Smoke Test', email: 'smoke@bid.hr' },
        assigneeId: '118313848',
        assigneeName: 'Mate',
        spaceId: '90142472614',
        reviewBeforeSend: false,
        hostProjects: {},
        recent: [],
      },
    });
  });
  const installMocks = () =>
    opts.evaluate(async () => {
      const bg = await browser.runtime.getBackgroundPage();
      if (bg.__mock) return true;
      const realFetch = bg.fetch.bind(bg);
      const json = (body, status = 200) => new bg.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      // emailSplit: Send to ClickUp's answer, kept as text (an object from the options page would die with it)
      const log = (bg.__mock = {
        created: [],
        attachments: [],
        deleted: [],
        openTasks: [],
        searched: [],
        closedIds: [],
        comments: [],
        deletedComments: [],
        listDelay: 0,
        emailPrompts: [],
        emailSplit: '',
        // Send to ClickUp (HubSpot): files the background was asked for, and what HubSpot's file server answers (base64)
        hubspotFiles: [],
        hubspotFile: '',
      });
      bg.fetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init.method ?? 'GET').toUpperCase();
        if (url.startsWith('https://api.z.ai/')) {
          await new Promise((r) => setTimeout(r, 800));
          const sent = JSON.parse(init.body).messages;
          if (/list the work it asks for/.test(sent[0].content)) {
            log.emailPrompts.push(sent[1].content);
            return json({ choices: [{ message: { content: log.emailSplit || '{"points":[],"questions":[]}' } }] });
          }
          // page-task notes ("page:…") come back recognisably
          const note = JSON.parse(sent[1].content).note;
          const content = note.startsWith('page:')
            ? JSON.stringify({ title: `Fixed: ${note.slice(5)}`, bullets: [`Rewritten from "${note}".`] })
            : JSON.stringify({ title: 'Hero: Book now button overlaps the title', bullets: ['The button sits on the title on small screens.'] });
          return json({ choices: [{ message: { content } }] });
        }
        if (url.startsWith('https://app-eu1.hubspot.com/api/filemanager/')) {
          log.hubspotFiles.push({ url, credentials: init.credentials ?? 'same-origin' });
          if (!log.hubspotFile) return new bg.Response('Forbidden', { status: 403 });
          const bytes = bg.Uint8Array.from(bg.atob(log.hubspotFile), (c) => c.charCodeAt(0));
          return new bg.Response(new bg.Blob([bytes], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } });
        }
        if (!url.startsWith('https://api.clickup.com/')) return realFetch(input, init);
        const path = new URL(url).pathname.replace('/api/v2', '');
        if (path === '/team') return json({ teams: [{ id: '9014552433', members: [{ user: { id: 118313848, username: 'Mate' } }, { user: { id: 82460956, username: 'Tea Babić' } }] }] });
        if (/^\/space\/\d+\/folder$/.test(path))
          return json({ folders: [{ id: 'f1', name: 'Cresanka', lists: [{ id: '901417200456', name: 'Development' }, { id: 'q1', name: 'QA' }] }] });
        if (/^\/space\/\d+\/list$/.test(path)) return json({ lists: [{ id: '901407290920', name: 'Bluesun' }, { id: '901400000555', name: 'Lumen' }] });
        if (/^\/list\/\w+\/task$/.test(path) && method === 'POST') {
          const body = JSON.parse(init.body);
          log.created.push(body);
          return json({ id: `ff${log.created.length}`, url: `https://app.clickup.com/t/ff${log.created.length}`, name: body.name });
        }
        if (/^\/team\/\w+\/task$/.test(path) && method === 'GET') {
          const query = new URL(url).searchParams;
          log.searched.push({ tags: query.getAll('tags[]'), spaces: query.getAll('space_ids[]'), closed: query.get('include_closed') });
          if (log.listDelay < 0) await new Promise(() => {}); // a ClickUp that never answers
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
          return json({ id: 'att' });
        }
        if (/^\/task\/\w+\/comment$/.test(path) && method === 'POST') {
          log.comments.push({ task: path.split('/')[2], text: JSON.parse(init.body).comment_text });
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
      return true;
    });
  check('background page reachable for mocks', await installMocks().catch((e) => (console.log(e.message), false)));
  const mockLog = () => opts.evaluate(async () => (await browser.runtime.getBackgroundPage()).__mock);

  // ---------- the note flow on a local page ----------
  const page = await b.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const sh = (sel, prop = 'textContent') =>
    page.evaluate((s, p) => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(s)?.[p] ?? null, sel, prop);
  const shHas = (sel, cls) => page.evaluate((s, c) => Boolean(document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(s)?.classList.contains(c)), sel, cls);
  const shClick = (sel) => page.evaluate((s) => document.querySelector('#bid-pointer').shadowRoot.querySelector(s).click(), sel);
  const waitFor = (fn, ...a) => page.waitForFunction(fn, { timeout: 15000 }, ...a);
  const waitNote = (open) => waitFor((o) => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note').classList.contains('is-open') === o, open);
  const ctaCentre = async () => {
    const box = await (await page.$('.btn-primary')).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  await page.goto(`http://localhost:${PORT}/rooms/superior`, { waitUntil: 'load' });
  check('detector injects Pointer on localhost', await page.waitForSelector('#bid-pointer', { timeout: 10000 }).then(() => true, () => false));
  await waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'));
  const styling = await page.evaluate(() => {
    const root = document.querySelector('#bid-pointer').shadowRoot;
    return { adopted: root.adoptedStyleSheets?.length ?? 0, styleTags: root.querySelectorAll('style').length, bg: getComputedStyle(root.querySelector('.launcher')).backgroundColor };
  });
  check('styles apply in Firefox', styling.bg === 'rgb(29, 28, 44)', JSON.stringify(styling));
  info(`styles delivered by ${styling.adopted ? 'a constructed stylesheet' : 'the <style> fallback'}`);
  info(`Gilroy loaded: ${await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Pointer Gilroy' && f.status === 'loaded');
  })}`);

  // ---------- the dock goes in any corner (dockdrag.ts, scripts/dock-check.mjs) ----------
  const storedCorner = () => opts.evaluate(async () => (await browser.storage.local.get('dockCorner')).dockCorner);
  const home = await dockState(page);
  const topLeft = launcherSpot('top-left', home.launcher, home.viewport);
  await pressAndDrag(page, 260, 180);
  // the ring glides over from the far corner (GLIDE_MS 70: ~450 ms to come within 2 px); 400 ms
  // left it ~3 px short in headless Firefox 158
  await delay(700);
  const midDrag = await dockState(page);
  await page.screenshot({ path: `${outDir}/firefox-dock-drag.png` });
  check(
    'dragging the dock shows a line to the nearest corner and a ring where it would land',
    home.corner === 'bottom-right' &&
      midDrag.dragging &&
      midDrag.guide &&
      Math.hypot(midDrag.ring.x - topLeft.x, midDrag.ring.y - topLeft.y) < 2 &&
      Math.hypot(midDrag.lineEnd.x - midDrag.ring.x, midDrag.lineEnd.y - midDrag.ring.y) < 30,
    JSON.stringify({ ring: midDrag.ring, spot: topLeft }),
  );
  await page.mouse.up();
  await delay(900);
  const dropped = await dockState(page);
  check(
    'letting go settles it in that corner and remembers it; the drop is not a click',
    dropped.corner === 'top-left' && Math.abs(dropped.launcher.x - 20) < 1 && Math.abs(dropped.launcher.y - 20) < 1 && !dropped.guide && !dropped.active && (await storedCorner()) === 'top-left',
    JSON.stringify({ corner: dropped.corner, at: dropped.launcher, active: dropped.active }),
  );
  const placed = await followers(page);
  check('the recording bar and the review sheet follow it', placed.recbar === '20px,20px' && placed.sheet === '20px,76px', JSON.stringify(placed));
  await pressAndDrag(page, 1000, 650);
  await delay(250);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await delay(900);
  const putBack = await dockState(page);
  check('Esc mid-drag puts it back where it was', putBack.corner === 'top-left' && Math.abs(putBack.launcher.x - 20) < 1 && !putBack.active, JSON.stringify(putBack.launcher));
  await opts.evaluate(() => browser.storage.local.set({ dockCorner: 'bottom-right' }));
  const cameHome = await waitFor(() => document.querySelector('#bid-pointer').dataset.corner === 'bottom-right').then(
    () => true,
    () => false,
  );
  check('moved from another tab, it moves here too', cameHome);
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
  await page.screenshot({ path: `${outDir}/firefox-dock-confetti.png` });
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

  await shClick('.launcher');
  const cta = await ctaCentre();
  await page.mouse.move(cta.x, cta.y);
  await delay(250);
  check('hover tab names the block', (await sh('.outline-tab')) === 'ExperiencesListWithFilters', await sh('.outline-tab'));
  await page.mouse.click(cta.x, cta.y);
  await waitNote(true);
  await delay(300);
  check('note opens with the block name', (await sh('.note-block'))?.trim() === 'ExperiencesListWithFilters');
  check('note says Local on localhost', (await sh('.note-env'))?.trim() === 'Local', await sh('.note-env'));
  // Firefox can record (WebM), but under automation it shares the real monitor, never a test
  // source, so the recording itself is only exercised in Chrome's run, on Chrome's fake screen.
  // fixedSize(), for MP4 recordings, is checked here too, on a canvas (further down): Firefox
  // records WebM today, but would go through it the day it records MP4.
  check('the note offers Record screen in Firefox', /Record screen/.test((await sh('[data-action="record"]')) ?? ''));
  const pickersReady = await waitFor(
    () => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')) &&
      Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee option[value="82460956"]')),
  ).then(() => true, () => false);
  check('project and person pickers load', pickersReady);
  check('person picker starts on the default', (await sh('.note-assignee', 'value')) === '118313848');
  const pickerWidth = await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-assignee').getBoundingClientRect().width);
  check('person picker sized to the chosen name', pickerWidth > 20 && pickerWidth < 130, `${Math.round(pickerWidth)}px`);
  await page.evaluate(() => {
    const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project');
    select.value = '901417200456';
    select.dispatchEvent(new Event('change'));
  });
  const heightBefore = await sh('.note-input', 'offsetHeight');
  for (const line of ['gumb ide preko naslova', 'na mobitelu', 'i na tabletu', 'treba bit ispod', 'sa razmakom']) {
    await page.keyboard.type(line);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
  }
  await delay(150);
  const heightAfter = await sh('.note-input', 'offsetHeight');
  check('note field grows with the text', heightAfter > heightBefore, `${heightBefore} → ${heightAfter}`);
  await page.screenshot({ path: `${outDir}/firefox-3-note.png` });

  await installMocks();
  await page.bringToFront();
  await page.keyboard.press('Enter');
  const toast = await waitFor(() => /Task created/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  await delay(300);
  await page.screenshot({ path: `${outDir}/firefox-8-toast.png` });
  check('task created', toast, (await sh('.toast'))?.replace(/\s+/g, ' '));
  const log = await mockLog();
  const task = log?.created?.at(-1);
  check('task uses the rewritten title', task?.name === 'Hero: Book now button overlaps the title', task?.name);
  check('task says Local and is tagged so', task?.markdown_description?.includes('**Environment** Local') && task?.tags?.includes('local'), JSON.stringify(task?.tags));
  const footer = task?.markdown_description?.split('\n').at(-1) ?? '';
  check('technical data left out while Firefox has no consent for it', /^Reported with Pointer · \d{2}\.\d{2}\.\d{4}/.test(footer) && !/Firefox|×/.test(footer), footer);
  const attachment = log?.attachments?.at(-1);
  check('screenshot captured and attached as a PNG', attachment?.type === 'image/png' && attachment.size > 1000, JSON.stringify(attachment));

  // ---------- the staging alias every project has, <project>-staging.vercel.app ----------
  await page.goto(`http://cresanka-staging.vercel.app:${PORT}/rooms/superior`, { waitUntil: 'load' });
  const aliasShown = await page.waitForSelector('#bid-pointer', { timeout: 10000 }).then(() => true, () => false);
  check('Pointer starts on a <project>-staging.vercel.app host', aliasShown, await page.url());
  if (aliasShown) {
    await waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'));
    await shClick('.launcher');
    const ctaA = await ctaCentre();
    await page.mouse.click(ctaA.x, ctaA.y);
    await waitNote(true);
    const aliasPicked = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').value === '901417200456').then(
      () => true,
      () => false,
    );
    check('staging alias matches its project', aliasPicked, await sh('.note-project', 'value'));
    check('note says Staging on the staging alias', (await sh('.note-env'))?.trim() === 'Staging', await sh('.note-env'));
    await page.keyboard.press('Escape');
    await waitNote(false);
  }
  await page.goto(`http://someone-else.vercel.app:${PORT}/`, { waitUntil: 'load' });
  await delay(2500);
  check("someone else's vercel.app site gets no Pointer", !(await page.$('#bid-pointer')));
  // the toolbar button (or shortcut) starts it there by hand
  await page.bringToFront();
  await opts.evaluate(async () => (await browser.runtime.getBackgroundPage()).__pointer.toggleActiveTab());
  const byHand = await page.waitForSelector('#bid-pointer', { timeout: 5000 }).then(() => true, () => false);
  check('toolbar button starts Pointer by hand where it stayed off', byHand && (await shHas('.launcher', 'is-active')));
  await opts.evaluate(async () => (await browser.runtime.getBackgroundPage()).__pointer.toggleActiveTab());
  check('the toolbar button then toggles it off again', !(await shHas('.launcher', 'is-active')));

  // ---------- live sites ----------
  await page.goto(`http://www.example-hotel.test:${PORT}/`, { waitUntil: 'load' });
  await delay(2500);
  check("a site that isn't bid's gets no Pointer", !(await page.$('#bid-pointer')));

  await page.goto(`http://www.cresanka.test:${PORT}/sobe`, { waitUntil: 'load' });
  check('a live site with a bid footer gets Pointer', await page.waitForSelector('#bid-pointer', { timeout: 10000 }).then(() => true, () => false));
  await waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'));
  await shClick('.launcher');
  const ctaL = await ctaCentre();
  await page.mouse.click(ctaL.x, ctaL.y);
  await waitNote(true);
  const livePicked = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project').value === '901417200456').then(
    () => true,
    () => false,
  );
  check('live domain matches its project', livePicked, await sh('.note-project', 'value'));
  check('note says Production on a live site', (await sh('.note-env'))?.trim() === 'Production' && (await shHas('.note-env', 'note-env--production')));
  await page.keyboard.type('footer je premali');
  await delay(150);
  await page.screenshot({ path: `${outDir}/firefox-3-note-production.png` });
  await installMocks();
  await page.bringToFront();
  const before = (await mockLog())?.created?.length ?? 0;
  await page.keyboard.press('Enter');
  for (let i = 0; i < 200 && ((await mockLog())?.created?.length ?? 0) === before; i++) await delay(50);
  const liveTask = (await mockLog())?.created?.at(-1);
  check('live-site task says Production', liveTask?.markdown_description?.includes('**Environment** Production (live site)') && liveTask?.tags?.includes('production'), JSON.stringify(liveTask?.tags));

  // ---------- page task: several notes on a page, published as one task ----------
  const pins = () => page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin').length);
  const waitPins = (n) => waitFor((k) => document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin').length === k, n);
  const stored = () => opts.evaluate(() => browser.storage.local.get(null));
  const patchSettings = (p) =>
    opts.evaluate(async (v) => {
      const { settings } = await browser.storage.local.get('settings');
      await browser.storage.local.set({ settings: { ...settings, ...v } });
    }, p);
  const addNote = async (x, y, text) => {
    const n = await pins();
    await page.mouse.click(x, y);
    await waitNote(true);
    await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project option[value="901417200456"]')));
    await page.evaluate(() => {
      const select = document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project');
      select.value = '901417200456';
      select.dispatchEvent(new Event('change'));
    });
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await waitPins(n + 1);
    await waitNote(false);
  };
  await patchSettings({ pageTask: true });
  await page.goto(`http://localhost:${PORT}/rooms/superior`, { waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher-label')?.textContent.trim() === 'Page task');
  check('page-task mode is plain on the launcher', (await shHas('.launcher', 'is-page')) && (await sh('.publish', 'hidden')) === false && (await sh('.publish', 'disabled')) === true);
  const createdBefore = (await mockLog())?.created?.length ?? 0;
  await shClick('.launcher');
  const spot1 = await ctaCentre();
  await addNote(spot1.x, spot1.y, 'page:one');
  check('the note stays on the page as pin 1, and no task is made', ((await mockLog())?.created?.length ?? 0) === createdBefore && (await sh('.publish-count'))?.trim() === '1');
  const card = await (await page.$('.card:nth-child(2)')).boundingBox();
  await addNote(card.x + card.width / 2, card.y + 40, 'page:two');
  await delay(200);
  await page.screenshot({ path: `${outDir}/firefox-11-page-task.png` });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  check('notes and pins come back after a reload', await waitPins(2).then(() => true, () => false));
  await shClick('.draft-pin:nth-child(2)');
  await waitNote(true);
  check('a pin reopens its note', (await sh('.note-input', 'value')) === 'page:two' && (await sh('.note-num'))?.trim() === 'Note 2');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('page:two edited');
  await page.keyboard.press('Enter');
  await waitNote(false);
  check('the change is saved', (await stored()).pageTasks?.[`localhost:${PORT}/rooms/superior`]?.items?.[1]?.note === 'page:two edited');
  await shClick('.launcher');
  const h1 = await (await page.$('.hero h1')).boundingBox();
  await addNote(h1.x + 20, h1.y + h1.height / 2, 'page:three');
  await shClick('.draft-pin:nth-child(3)');
  await waitNote(true);
  await shClick('[data-action="remove"]');
  await waitPins(2);
  check('Remove note takes it away', (await pins()) === 2 && Object.keys(await stored()).filter((k) => k.startsWith('pageShot:')).length === 2);

  await installMocks();
  await page.bringToFront();
  const attachmentsBefore = (await mockLog())?.attachments?.length ?? 0;
  await shClick('.publish');
  const published = await waitFor(() => /Task created from 2 notes/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  const pageLog = await mockLog();
  const pageTask = pageLog?.created?.at(-1);
  check('Publish task makes one task, titled after the page', published && pageLog.created.length === createdBefore + 1 && pageTask?.name === 'Fixture Changes', pageTask?.name);
  check(
    'it lists the notes in order, rewritten, with the originals',
    /\*\*1\. Fixed: one\*\*[\s\S]*> page:one[\s\S]*\*\*2\. Fixed: two edited\*\*[\s\S]*> page:two edited/.test(pageTask?.markdown_description ?? ''),
    JSON.stringify(pageTask?.markdown_description),
  );
  const shots = pageLog.attachments.slice(attachmentsBefore);
  check(
    "each note's screenshot is attached under its number",
    JSON.stringify(shots.map((a) => a.name)) === JSON.stringify(['pointer-1-experienceslistwithfilters.png', 'pointer-2-roomlist.png']) && shots.every((a) => a.type === 'image/png' && a.size > 1000),
    JSON.stringify(shots),
  );
  check('the pins go once published', (await pins()) === 0 && (await sh('.publish', 'disabled')) === true);
  await shClick('[data-action="undo"]');
  const restored = await waitFor(() => /Your notes are back/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent)).then(
    () => true,
    () => false,
  );
  check('Undo deletes the task and brings the notes back', restored && (await pins()) === 2 && ((await mockLog())?.deleted?.length ?? 0) > 0);

  // ---------- review: change the name and description before it goes out ----------
  const replaceIn = async (sel, text) => {
    await page.evaluate((s) => document.querySelector('#bid-pointer').shadowRoot.querySelector(s).focus(), sel);
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.type(text);
  };
  const ctrlEnter = async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
  };
  await patchSettings({ reviewBeforeSend: true });
  await installMocks();
  await page.bringToFront();
  const beforePageReview = (await mockLog())?.created?.length ?? 0;
  await shClick('.publish');
  const sheetShown = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.sheet').classList.contains('is-open')).then(
    () => true,
    () => false,
  );
  check(
    'Publish task opens the review with the page task in it',
    sheetShown && (await sh('.sheet .review-title', 'value')) === 'Fixture Changes' && /\*\*2\. Fixed: two edited\*\*/.test((await sh('.sheet .review-description', 'value')) ?? ''),
    await sh('.sheet .review-title', 'value'),
  );
  await page.screenshot({ path: `${outDir}/firefox-12-page-review.png` });
  await replaceIn('.sheet .review-title', 'Fixture: two fixes');
  await ctrlEnter();
  await waitFor(() => /Task created from 2 notes/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const pageReviewed = (await mockLog())?.created?.at(-1);
  check('the page task goes out with the reviewed name', ((await mockLog())?.created?.length ?? 0) === beforePageReview + 1 && pageReviewed?.name === 'Fixture: two fixes', pageReviewed?.name);

  await patchSettings({ pageTask: false });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Pointer');
  const spotR = await ctaCentre();
  await page.mouse.click(spotR.x - 30, spotR.y);
  await waitNote(true);
  await page.keyboard.type('cta gumb ide preko naslova');
  await installMocks();
  await page.bringToFront();
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note:not(.sheet) .review-description')));
  check(
    'review shows the rewritten name and the whole description',
    (await sh('.note:not(.sheet) .review-title', 'value')) === 'Hero: Book now button overlaps the title' && /\*\*Where\*\*/.test((await sh('.note:not(.sheet) .review-description', 'value')) ?? ''),
    await sh('.note:not(.sheet) .review-title', 'value'),
  );
  await replaceIn('.note:not(.sheet) .review-title', 'Hero: CTA under the title');
  const beforeReview = (await mockLog())?.created?.length ?? 0;
  await ctrlEnter();
  await waitFor(() => /Task created/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const reviewed = (await mockLog())?.created?.at(-1);
  check('the task goes out with the edited name', ((await mockLog())?.created?.length ?? 0) === beforeReview + 1 && reviewed?.name === 'Hero: CTA under the title', reviewed?.name);
  await patchSettings({ reviewBeforeSend: false });

  // ---------- Comment Mode ----------
  // open tasks as ClickUp lists them: one about the Hero on this page (in the QA list) and this page's page task
  const seedOpenTasks = async () => {
    await installMocks();
    await opts.evaluate(async (port) => {
      const bg = await browser.runtime.getBackgroundPage();
      const text = (env, more) => ['Something to fix', '', `🔗 localhost:${port} › /rooms/superior`, env, ...more].join('\n');
      const task = (id, list, updated, description, tags = ['pointer']) => ({
        id,
        name: `Task ${id}`,
        url: `https://app.clickup.com/t/${id}`,
        status: { status: 'qa', type: 'custom' },
        date_closed: null,
        date_updated: String(updated),
        text_content: description,
        list: { id: list },
        tags: tags.map((name) => ({ name })),
      });
      const hero = 'Block ExperiencesListWithFilters · #4821';
      bg.__mock.openTasks = [
        task('open1', 'q1', 1000, text('Environment Local', [hero])),
        task('pg1', '901417200456', 1500, text('Environment Local · 1 note', [hero])),
        task('untagged1', '901417200456', 9900, text('Environment Local', [hero]), ['staging']), // newest, but not Pointer's
      ];
    }, PORT);
  };
  const lastComment = async () => (await mockLog())?.comments?.at(-1);
  await patchSettings({ commentMode: true, pageTask: false });
  await seedOpenTasks();
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#bid-pointer', { timeout: 10000 });
  await waitFor(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'));
  await shClick('.launcher');
  const spotC = await ctaCentre();
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  const foundOpen = await waitFor(() => /Adds a comment to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-target')?.textContent ?? '')).then(
    () => true,
    () => false,
  );
  check('the note says it goes on the open task tagged pointer, found in the QA list', foundOpen, await sh('.note-target'));
  const ffSearches = (await mockLog())?.searched ?? [];
  check(
    'it asks ClickUp for the open tasks tagged pointer, in one query',
    ffSearches.length === 1 && ffSearches[0].tags.join() === 'pointer' && ffSearches[0].spaces.join() === '90142472614' && ffSearches[0].closed === 'false',
    JSON.stringify(ffSearches),
  );
  await page.screenshot({ path: `${outDir}/firefox-13-comment-target.png` });
  await page.keyboard.type('page:comment in firefox');
  await seedOpenTasks(); // the background page may have been unloaded since
  await page.bringToFront();
  await page.keyboard.press('Enter');
  await waitFor(() => /Comment added to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  const ffComment = await lastComment();
  check(
    'the note goes on that task as a comment, with its screenshot',
    ffComment?.task === 'open1' && /^Fixed: comment in firefox/.test(ffComment.text) && (await mockLog())?.attachments?.at(-1)?.task === 'open1',
    ffComment?.text,
  );

  await patchSettings({ reviewBeforeSend: true });
  await seedOpenTasks();
  await page.bringToFront();
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  await waitFor(() => /Adds a comment to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-target')?.textContent ?? ''));
  await page.keyboard.type('page:reviewed comment');
  await page.keyboard.press('Enter');
  await waitFor(() => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-on')));
  check('the review shows only the comment, and which task it goes on', /A comment on Task open1/.test((await sh('.review-on')) ?? '') && !(await sh('.note:not(.sheet) .review-title')));
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await waitFor(() => /Comment added to Task open1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('the reviewed comment goes on the task', /^Fixed: reviewed comment/.test((await lastComment())?.text ?? ''));
  await patchSettings({ reviewBeforeSend: false });

  await patchSettings({ pageTask: true });
  await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Page task');
  await seedOpenTasks();
  await page.bringToFront();
  await page.mouse.click(spotC.x - 40, spotC.y);
  await waitNote(true);
  const foundPage = await waitFor(() => /Adds a comment to Task pg1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-target')?.textContent ?? '')).then(
    () => true,
    () => false,
  );
  await page.keyboard.type('page:on the page task');
  await page.keyboard.press('Enter');
  await waitFor(() => /Comment added to Task pg1/.test(document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast').textContent));
  check('with page tasks, the note goes on the page’s open task as a comment', foundPage && (await lastComment())?.task === 'pg1' && (await pins()) === 0);
  const setListDelay = async (ms) => {
    await installMocks();
    await opts.evaluate(async (v) => ((await browser.runtime.getBackgroundPage()).__mock.listDelay = v), ms);
    await page.bringToFront();
  };
  // ClickUp too slow to say whether there's an open task: the note says it's checking, Esc stops
  // the wait, and sending again goes ahead without the check after a few seconds
  await opts.evaluate(() => browser.storage.local.remove('taskIndex')); // no local list yet, so ClickUp is asked
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

  await patchSettings({ commentMode: false, pageTask: false });

  // ---------- a capture that changes size while it's recorded (scripts/recording-check.mjs) ----------
  const resizing = await b.newPage();
  await resizing.goto(`http://localhost:${PORT}/rooms/superior`, { waitUntil: 'load' });
  await resizing.addScriptTag({ content: await fixedSizeScript() });
  const resized = await resizing.evaluate(resizingRecording);
  await resizing.close();
  await page.bringToFront();
  check(
    'a capture that changes size records at one size, bottom edge intact',
    !resized.error &&
      resized.fixed === '1000x580' &&
      resized.sizes.join() === '1000x580' &&
      resized.frames >= 10 &&
      resized.brokenBottoms === 0,
    JSON.stringify(resized),
  );

  // ---------- Send to ClickUp in Gmail (a stand-in conversation at mail.google.com) ----------
  await opts.evaluate(async (text) => ((await browser.runtime.getBackgroundPage()).__mock.emailSplit = text), JSON.stringify(EMAIL_SPLIT));
  await patchSettings({ reviewBeforeSend: false, domainProjects: {} });
  const mail = await b.newPage();
  const gmailLog = [];
  let intercepting = true;
  try {
    await mail.setRequestInterception(true);
    mail.on('request', (req) => {
      const hit = gmailRoute(req.url(), gmailLog);
      if (hit) req.respond({ status: 200, contentType: hit.contentType, body: hit.body });
      else req.continue();
    });
  } catch (e) {
    intercepting = false;
    info(`request interception unavailable: ${e.message}`);
  }
  check('Firefox can stand in for Gmail through request interception', intercepting);
  if (intercepting) {
    mail.on('pageerror', (e) => console.log('gmail pageerror:', e.message));
    await mail.goto(GMAIL_URL, { waitUntil: 'load' }).catch((e) => info(`gmail goto: ${e.message}`));
    await mail.bringToFront();
    const mailNow = () => mail.evaluate(mailState);
    const mailWait = async (test, ms = 15_000) => {
      for (let i = 0; i < ms / 100; i++) {
        const s = await mailNow().catch(() => null);
        if (s && test(s)) return s;
        await delay(100);
      }
      return mailNow();
    };
    let st = await mailWait((s) => s.visible);
    check(
      "Send to ClickUp sits in the Reply / Forward row, as tall and round as Forward",
      st.visible && st.lastInRow && st.gold && st.button.h === st.forward.h && st.button.radius === st.forward.radius && st.button.top === st.forward.top,
      JSON.stringify({ button: st.button, forward: st.forward, gap: st.gap }),
    );
    await mail.evaluate(() => document.querySelector('.amn').scrollIntoView({ block: 'center' }));
    await mail.screenshot({ path: `${outDir}/firefox-g1-gmail-button.png` });
    await mail.evaluate(pressSend);
    st = await mailWait((s) => Boolean(s.sheet));
    check('a sender Pointer has not met: the project is asked for, the tasks listed', st.sheet?.compact && JSON.stringify(st.sheet.list) === JSON.stringify(EMAIL_TASKS), JSON.stringify(st.sheet));
    await mail.screenshot({ path: `${outDir}/firefox-g2-gmail-project.png` });
    const before = (await mockLog()).created.length;
    const filesBefore = (await mockLog()).attachments.length;
    await mail.evaluate(reviewCreate, '901417200456');
    st = await mailWait((s) => /4 tasks created/.test(s.toast), 20_000);
    const log = await mockLog();
    const made = log.created.slice(before);
    const files = log.attachments.slice(filesBefore);
    check('the four tasks are made, linked from the toast', /4 tasks created in Cresanka › Development/.test(st.toast) && made.map((t) => t.name).join('|') === EMAIL_TASKS.join('|'), st.toast);
    check(
      'both images reach their tasks, downloaded as the page (the screenshot as its original)',
      files.length === 2 && files[0].name === 'rooms-screenshot.png' && files[0].size === ORIGINAL.length && files[1].name === 'wellness-hero.jpg',
      JSON.stringify(files),
    );
    const prompt = JSON.parse(log.emailPrompts.at(-1) ?? '{}');
    check('GLM reads the expanded email only, the trimmed quote left out', prompt.messages?.length === 1 && /\[image 1\]/.test(prompt.messages[0].text) && !/Old quoted text/.test(prompt.messages[0].text));
    st = await mailWait((s) => s.label === 'Sent to ClickUp');
    check('the button now says the email is in ClickUp', st.label === 'Sent to ClickUp' && st.rowClicks === 0, st.label);
    await mail.screenshot({ path: `${outDir}/firefox-g3-gmail-created.png` });

    // the full review in Firefox, which sizes pickers without field-sizing: still one compact row per task
    await patchSettings({ reviewBeforeSend: true });
    await mailWait((s) => !/4 tasks created/.test(s.toast), 25_000);
    await mail.evaluate(pressSend);
    await mailWait((s) => /Already in ClickUp/.test(s.toast));
    await mail.evaluate(toastButton, 'Send again');
    st = await mailWait((s) => Boolean(s.sheet && !s.sheet.compact), 20_000);
    check(
      'with review on, Firefox shows the wide review, one compact row per task',
      st.sheet?.names.length === 4 && st.sheet.width >= 900 && st.sheet.rowHeight > 0 && st.sheet.rowHeight <= 160 && st.sheet.descriptionsShown === 0,
      JSON.stringify({ names: st.sheet?.names, width: st.sheet?.width, rowHeight: st.sheet?.rowHeight }),
    );
    await mail.screenshot({ path: `${outDir}/firefox-g4-gmail-review.png` });
    // the date chip opens Pointer's own calendar on a real click; a day sets it; Esc closes just the calendar
    const chipAt = await mail.evaluate(() => {
      const r = document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll('.mail-task .mail-due')[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await mail.mouse.click(chipAt.x, chipAt.y);
    const calendarOpen = await mail.evaluate(() => Boolean(document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-cal .mail-cal-day')));
    await mail.screenshot({ path: `${outDir}/firefox-g5-gmail-calendar.png` });
    await mail.keyboard.press('Escape');
    await delay(100);
    const calendarClosed = await mail.evaluate(() => !document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-cal'));
    await mail.evaluate(setDue, 0, '2026-11-02');
    st = await mailNow();
    check(
      'in Firefox too, the date chip opens the calendar, Esc closes only it, and a day sets the chip',
      calendarOpen && calendarClosed && Boolean(st.sheet) && st.sheet.dues[0] === 'Mon 02.11.2026',
      JSON.stringify({ calendarOpen, calendarClosed, due: st.sheet?.dues[0] }),
    );
    await mail.keyboard.press('Escape');
    await patchSettings({ reviewBeforeSend: false });
  }
  await mail.close();

  // ---------- Send to ClickUp in HubSpot (a stand-in Help Desk ticket at app-eu1.hubspot.com) ----------
  await opts.evaluate(
    async (text, file) => Object.assign((await browser.runtime.getBackgroundPage()).__mock, { emailSplit: text, hubspotFile: file }),
    JSON.stringify(HUBSPOT_SPLIT),
    HS_ATTACHED.toString('base64'),
  );
  await patchSettings({ reviewBeforeSend: false, domainProjects: {} });
  const hub = await b.newPage();
  const hubLog = [];
  let hubIntercepting = true;
  try {
    await hub.setRequestInterception(true);
    hub.on('request', (req) => {
      const hit = hubspotRoute(req.url(), hubLog);
      if (hit) req.respond({ status: hit.status ?? 200, contentType: hit.contentType, body: hit.body });
      else if (req.url().startsWith('https://app-eu1.hubspot.com/')) req.respond({ status: 404, contentType: 'text/plain', body: '' });
      else req.continue();
    });
  } catch (e) {
    hubIntercepting = false;
    info(`request interception unavailable: ${e.message}`);
  }
  check('Firefox can stand in for HubSpot through request interception', hubIntercepting);
  if (hubIntercepting) {
    hub.on('pageerror', (e) => console.log('hubspot pageerror:', e.message));
    await hub.goto(HUBSPOT_URL, { waitUntil: 'load' }).catch((e) => info(`hubspot goto: ${e.message}`));
    await hub.bringToFront();
    const hubNow = () => hub.evaluate(hubspotState);
    const hubWait = async (test, ms = 15_000) => {
      for (let i = 0; i < ms / 100; i++) {
        const s = await hubNow().catch(() => null);
        if (s && test(s)) return s;
        await delay(100);
      }
      return hubNow();
    };
    let hs = await hubWait((s) => s.visible);
    check(
      "Send to ClickUp sits left of the ticket's Actions button, as tall and round as it, 8 px away",
      hs.visible && hs.beforeActions && hs.gold && hs.button.h === hs.actions.h && hs.button.radius === hs.actions.radius && hs.button.top === hs.actions.top && hs.gap === 8,
      JSON.stringify({ button: hs.button, actions: hs.actions, gap: hs.gap }),
    );
    await hub.screenshot({ path: `${outDir}/firefox-h1-hubspot-button.png` });
    const hubBefore = await mockLog(); // files download while GLM reads
    await hub.evaluate(pressHubSpotSend);
    hs = await hubWait((s) => Boolean(s.sheet));
    check(
      "the project is recognized from the ticket's name, the tasks listed",
      hs.sheet?.compact && hs.sheet.project === LUMEN.listId && JSON.stringify(hs.sheet.list) === JSON.stringify(HUBSPOT_TASKS),
      JSON.stringify(hs.sheet),
    );
    await hub.screenshot({ path: `${outDir}/firefox-h2-hubspot-project.png` });
    await hub.evaluate(reviewCreate);
    hs = await hubWait((s) => /2 tasks created/.test(s.toast), 20_000);
    const hubAfter = await mockLog();
    const hubMade = hubAfter.created.slice(hubBefore.created.length);
    const hubFiles = hubAfter.attachments.slice(hubBefore.attachments.length);
    const viaBackground = hubAfter.hubspotFiles.slice(hubBefore.hubspotFiles.length);
    check(
      "two high-priority tasks in Lumen: the ticket's owner gets one, Mate the small fix; the ticket and spreadsheet linked",
      /2 tasks created in Lumen/.test(hs.toast) &&
        hubMade.length === 2 &&
        hubMade[0].assignees[0] === 82460956 &&
        hubMade[1].assignees[0] === 118313848 &&
        hubMade.every((t) => t.priority === 2 && t.tags.join() === 'pointer,email,hubspot') &&
        hubMade[0].markdown_description.startsWith('🎫 HubSpot [#100200300400](https://app-eu1.hubspot.com/contacts/147607823/record/0-5/100200300400)') &&
        hubMade[0].markdown_description.includes(`**Link** [Google Sheet](${SHEET})`),
      JSON.stringify({ toast: hs.toast, made: hubMade.map((t) => ({ name: t.name, to: t.assignees, priority: t.priority })) }),
    );
    check(
      "both screenshots reach their tasks: the inline one as its original, the one HubSpot's file server keeps from the page through the background, with the session",
      hubFiles.length === 2 &&
        hubFiles.some((f) => f.name === 'redirect-loop.png' && f.size === HS_ATTACHED.length) &&
        hubFiles.some((f) => f.name === 'image-2.png' && f.size === HS_ORIGINAL.length) &&
        viaBackground.length === 1 &&
        viaBackground[0].credentials === 'include',
      JSON.stringify({ files: hubFiles, background: viaBackground, page: hubLog }),
    );
    hs = await hubWait((s) => s.label === 'Sent to ClickUp');
    check('the button now says the ticket is in ClickUp, and no press reached the header', hs.label === 'Sent to ClickUp' && hs.headerClicks === 0, hs.label);
    await hub.screenshot({ path: `${outDir}/firefox-h3-hubspot-created.png` });
  }
  await hub.close();
  await page.bringToFront();

  // ---------- the SEO check, on a stand-in staging page (scripts/seo-check.mjs) ----------
  await patchSettings({ hostProjects: SEO_PROJECT });
  const seoPage = await b.newPage();
  await seoPage.goto(`http://${SEO_HOST}:${PORT}${SEO_PATH}`, { waitUntil: 'load' });
  await seoPage.bringToFront();
  await seoPage.waitForSelector('#bid-pointer', { timeout: 10000 });
  await runSeo({
    page: seoPage,
    check,
    delay,
    shot: (name) => `${outDir}/firefox-${name}`,
    created: async () => (await mockLog()).created,
    deleted: async () => (await mockLog()).deleted,
    patchSettings,
  });
  await seoPage.close();
  await page.bringToFront();

  // ---------- a background left over from an older build ----------
  await opts.evaluate(async () => ((await browser.runtime.getBackgroundPage()).__pointerBuild = 'an-older-build'));
  await patchSettings({ _nudge: Date.now() });
  const ffReload = await waitFor(() => document.querySelector('#bid-pointer').shadowRoot.querySelector('.launcher-label').textContent.trim() === 'Reload Pointer').then(
    () => true,
    () => false,
  );
  check('an out-of-date background is caught: the launcher asks for a reload', ffReload);
  await opts.evaluate(async () => delete (await browser.runtime.getBackgroundPage()).__pointerBuild);
  await patchSettings({ _nudge: Date.now() });

  // ---------- options page after setup ----------
  await openExtensionPage(opts, `${BASE}/options.html?again`, '#setupWho');
  await delay(600);
  check('options show the connected account', /Smoke Test/.test(await opts.$eval('#setupWho', (el) => el.textContent)));
  await extensionScreenshot(opts, `${outDir}/firefox-9-options.png`);
} finally {
  await b.close();
  server.close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed (firefox)`);
process.exit(failed ? 1 : 0);
