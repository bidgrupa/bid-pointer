// Renders the store screenshots (1280×800) and the small promo tile (440×280) into store/chrome/,
// the way webpify does. Run after `pnpm build`:
//   node store/chrome/src/render.mjs
//
// Each screenshot is frame.html: a caption over a browser window. What's in the window is real: the
// built extension, loaded into Chrome, at work on a made-up hotel's staging site (demo/index.html,
// which is also the reviewers' demo page), with the screenshots' made-up agency set up in it.
// ClickUp and Z.ai are answered inside the browser, so nothing reaches them, and the answers are
// what the shots show (people, projects, the rewrite).
//
// Needs Google Chrome; set CHROME to its path if it isn't in the usual place.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seoState } from '../../../scripts/seo-check.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
process.chdir(root);
const OUT = 'store/chrome';
const HOST = 'staging.hotel-pointer.example';
const PAGE_URL = `https://${HOST}/rooms/sea-view`;
const WINDOW = { width: 1136, height: 582 }; // the window in frame.html
/**
 * The page as the window shows it, `scale` its natural size (below 1 fits more), photographed at
 * twice the window's pixels so the frame scales it down crisp.
 */
const view = (scale = 1) => ({ width: Math.round(WINDOW.width / scale), height: Math.round(WINDOW.height / scale), deviceScaleFactor: 2 * scale });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync('dist/manifest.json')) throw new Error('Run `pnpm build` first');

// ---------- The made-up agency, its ClickUp, and the hotel's site ----------

const PROJECT = { listId: '901400000001', label: 'Hotel Pointer › Development' };
const ME = { id: 101, username: 'Ana Kovač', email: 'ana@studio.example' };
const CLICKUP = {
  '/user': { user: ME },
  '/team': {
    teams: [
      {
        id: '9000000001',
        name: 'Studio',
        members: [{ user: ME }, { user: { id: 102, username: 'Marko Horvat' } }, { user: { id: 103, username: 'Ivana Babić' } }],
      },
    ],
  },
  '/team/9000000001/space': { spaces: [{ id: '90000000001', name: 'Websites' }] },
  '/space/90000000001/folder': {
    folders: [
      { id: 'f1', name: 'Hotel Pointer', lists: [{ id: PROJECT.listId, name: 'Development' }, { id: '901400000002', name: 'QA' }] },
      { id: 'f2', name: 'Villa Sora', lists: [{ id: '901400000003', name: 'Development' }] },
    ],
  },
  '/space/90000000001/list': { lists: [{ id: '901400000004', name: 'Café Mira' }] },
};
const REWRITE = {
  title: 'Book a stay opens the homepage instead of booking',
  bullets: ['The Book a stay button in the header goes to the homepage.', 'It should open the booking page, with the dates empty.'],
};
const SETTINGS = {
  consentAt: new Date().toISOString(),
  clickupToken: 'pk_80412557_Q7ZK3F7AMOCKTOKENFORTHESHOTS',
  clickupUser: ME,
  assigneeId: '102',
  assigneeName: 'Marko Horvat',
  spaceId: '90000000001',
  spaceName: 'Studio › Websites',
  codingAgent: false,
  sites: [HOST],
  footerCredit: '',
  zaiKey: 'mock.screenshots',
  reviewBeforeSend: false,
  pageTask: false,
  commentMode: false,
  seoCheck: true,
  hostProjects: { [HOST]: PROJECT },
  domainProjects: {},
  recent: [],
};
const site = readFileSync('demo/index.html', 'utf8');
/** The hotel's staging site: hidden from Google, as staging should be, with robots.txt and a sitemap. */
const ROUTES = {
  '/rooms/sea-view': { type: 'text/html; charset=utf-8', body: site },
  '/robots.txt': { type: 'text/plain', body: `User-agent: *\nDisallow: /admin/\nSitemap: https://${HOST}/sitemap.xml\n` },
  '/sitemap.xml': {
    type: 'application/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.hotel-pointer.example/rooms/sea-view</loc></url></urlset>`,
  },
};

// ---------- A local server for the frames (tokens, fonts, icons) and the captures ----------

const captures = mkdtempSync(join(tmpdir(), 'pointer-shots-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.otf': 'font/otf' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  const capture = /capture-\d\.png$/.exec(path);
  const file = capture ? join(captures, capture[0]) : join(root, path);
  if (!file.startsWith(capture ? captures : root) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(0);
const local = `http://localhost:${server.address().port}`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let framer = null;
const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  enableExtensions: true,
  args: ['--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb'],
  defaultViewport: view(),
});

try {
  const id = await b.installExtension(join(root, 'dist'));
  const worker = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id)).then((t) => t.worker());
  await delay(800); // Pointer opens its setup tab on install; it isn't wanted here
  for (const p of await b.pages()) if (p.url().startsWith(`chrome-extension://${id}/`)) await p.close();

  // ClickUp, Z.ai and the hotel's site, as the background sees them
  await worker.evaluate(
    (clickup, rewrite, routes, host) => {
      const realFetch = globalThis.fetch.bind(globalThis);
      const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.hostname === 'api.z.ai') return json({ choices: [{ message: { content: JSON.stringify(rewrite) } }] });
        if (url.hostname === host) {
          const r = routes[url.pathname];
          return r ? new Response(r.body, { headers: { 'Content-Type': r.type, 'X-Robots-Tag': 'noindex' } }) : new Response('Not found', { status: 404 });
        }
        if (url.hostname !== 'api.clickup.com') return realFetch(input, init);
        const path = url.pathname.replace('/api/v2', '');
        if ((init.method ?? 'GET').toUpperCase() === 'POST' && /^\/list\/\w+\/task$/.test(path)) return json({ id: 'shot1', url: 'https://app.clickup.com/t/shot1' });
        return json(clickup[path] ?? (/\/task$/.test(path) ? { tasks: [], last_page: true } : {}));
      };
    },
    CLICKUP,
    REWRITE,
    ROUTES,
    HOST,
  );
  /** A clean start for each shot: nothing left from the last one (pins, remembered tasks), and these settings. */
  const settle = (patch = {}) =>
    worker.evaluate(async (s) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ settings: s });
    }, { ...SETTINGS, ...patch });

  /** A tab on the hotel's site with Pointer ready, the site served from ROUTES. */
  async function sitePage(scale = 1) {
    const page = await b.newPage();
    await page.setViewport(view(scale));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      const r = url.hostname === HOST ? ROUTES[url.pathname] : null;
      if (url.hostname === HOST) void req.respond(r ? { status: 200, contentType: r.type, headers: { 'X-Robots-Tag': 'noindex' }, body: r.body } : { status: 404, body: '' });
      else void req.continue();
    });
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#bid-pointer')?.shadowRoot?.querySelector('.launcher')?.title.startsWith('Point at'), { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  const inPointer = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 15000 }, ...args);
  const shadowClick = (page, sel) => page.evaluate((s) => document.querySelector('#bid-pointer').shadowRoot.querySelector(s).click(), sel);
  const centre = async (page, sel) => {
    const box = await (await page.$(sel)).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const noteOpen = (page, open) => inPointer(page, (o) => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note').classList.contains('is-open') === o, open);
  const projectPicked = (page) => inPointer(page, (v) => document.querySelector('#bid-pointer').shadowRoot.querySelector('.note-project')?.value === v, PROJECT.listId);

  /** Points at `sel` and writes `text` in the note that opens. */
  async function note(page, sel, text) {
    const at = await centre(page, sel);
    await page.mouse.move(at.x - 30, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await page.mouse.click(at.x, at.y);
    await noteOpen(page, true);
    await projectPicked(page);
    await page.keyboard.type(text, { delay: 5 });
  }

  const capture = async (page, n) => {
    await delay(400); // transitions
    writeFileSync(join(captures, `capture-${n}.png`), await page.screenshot({ type: 'png' }));
    await page.close();
  };

  // 1. A note on the page
  await settle();
  let page = await sitePage();
  await shadowClick(page, '.launcher');
  await note(page, '.book-outline', 'Book a stay opens the homepage. It should open the booking page.');
  await capture(page, 1);

  // 2. Several notes as pins, waiting to be published as one task
  await settle({ pageTask: true });
  page = await sitePage();
  await shadowClick(page, '.launcher');
  const pins = (n) => inPointer(page, (k) => document.querySelector('#bid-pointer').shadowRoot.querySelectorAll('.draft-pin').length === k, n);
  const notes = [
    ['nav span:nth-child(4)', 'Offers should come before Spa in the menu.'],
    ['h1', 'A little smaller on phones, it wraps into three lines.'],
    ['.btn-light', 'Say "See all rooms", like on the live site.'],
  ];
  for (const [i, [sel, text]] of notes.entries()) {
    await note(page, sel, text);
    await page.keyboard.press('Enter');
    await pins(i + 1);
    await noteOpen(page, false);
  }
  await page.mouse.move(view().width - 20, view().height / 2); // no hover outline over the pins
  // the "Note 3 added" toast goes by itself
  await inPointer(page, () => !document.querySelector('#bid-pointer').shadowRoot.querySelector('.toast.is-visible')).catch(() => {});
  await capture(page, 2);

  // 3. The rewritten task, reviewed before it goes out
  await settle({ reviewBeforeSend: true });
  page = await sitePage(0.85); // the review is taller than the window at full size
  await shadowClick(page, '.launcher');
  await note(page, '.book-outline', 'book a stay btn opens homepage, shud go to booking');
  await page.keyboard.press('Enter');
  await inPointer(page, () => Boolean(document.querySelector('#bid-pointer').shadowRoot.querySelector('.review-title')));
  await page.evaluate(() => document.querySelector('#bid-pointer').shadowRoot.activeElement?.blur());
  await capture(page, 3);

  // 4. The SEO check
  await settle();
  page = await sitePage();
  await inPointer(page, () => {
    const btn = document.querySelector('#bid-pointer').shadowRoot.querySelector('.seo-btn');
    return btn && !btn.hidden;
  });
  await page.mouse.click(...Object.values(await page.evaluate(() => {
    const r = document.querySelector('#bid-pointer').shadowRoot.querySelector('.seo-btn').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })));
  for (let i = 0; i < 100; i++) {
    const s = await page.evaluate(seoState);
    if (s.open && !s.waiting && s.passed.length > 0) break;
    await delay(150);
  }
  await page.mouse.move(40, view().height - 40);
  await capture(page, 4);

  // 5. The settings page, set up; it asks ClickUp itself, so it gets the same answers
  await settle();
  page = await b.newPage();
  await page.setViewport(view());
  await page.evaluateOnNewDocument((clickup) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname !== 'api.clickup.com') return realFetch(input, init);
      const body = clickup[url.pathname.replace('/api/v2', '')] ?? {};
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    };
  }, CLICKUP);
  await page.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('#setupDone').hidden && /projects in this space/.test(document.querySelector('#spaceStatus').textContent), { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await capture(page, 5);

  // ---------- Frame them, and the promo tile ----------

  mkdirSync(OUT, { recursive: true });
  const NAMES = { 1: 'note', 2: 'page-task', 3: 'review', 4: 'seo', 5: 'settings' };
  // a browser without Pointer: it starts by itself on localhost, and would join the picture
  framer = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const frame = await framer.newPage();
  await frame.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  for (const [n, name] of Object.entries(NAMES)) {
    await frame.goto(`${local}/store/chrome/src/frame.html?shot=${n}`, { waitUntil: 'load' });
    await frame.evaluate(() => window.ready);
    await frame.screenshot({ path: `${OUT}/screenshot-${n}-${name}.png` });
    console.log(`${OUT}/screenshot-${n}-${name}.png`);
  }
  await frame.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
  await frame.goto(`${local}/store/chrome/src/promo.html`, { waitUntil: 'load' });
  await frame.screenshot({ path: `${OUT}/promo-small.png` });
  console.log(`${OUT}/promo-small.png`);
} finally {
  await b.close();
  await framer?.close();
  server.close();
  rmSync(captures, { recursive: true, force: true });
}
