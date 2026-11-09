// Pure-logic tests. Run with `pnpm test` (bundles the shared modules with esbuild first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pointer-test-'));
const entry = join(dir, 'entry.ts');
const src = (p) => join(process.cwd(), p).replace(/\\/g, '/');
writeFileSync(
  entry,
  `export * from '${src('src/shared/page.ts')}';
   export * from '${src('src/shared/format.ts')}';
   export * from '${src('src/shared/site.ts')}';
   export * from '${src('src/shared/match.ts')}';
   export * from '${src('src/shared/corner.ts')}';
   export * from '${src('src/shared/spin.ts')}';
   export { suggest, bestSuggestion, normalizeName } from '${src('src/background/projects.ts')}';
   export { isOpenPointerTask } from '${src('src/background/clickup.ts')}';`,
);
const out = join(dir, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const m = await import(pathToFileURL(out).href);

test('slugCandidates handles production, branch and hash hosts', () => {
  assert.deepEqual(m.slugCandidates('pages-bluesun-bid.vercel.app'), ['pages-bluesun']);
  assert.deepEqual(m.slugCandidates('pages-bluesun-git-staging-bid.vercel.app'), ['pages-bluesun']);
  assert.deepEqual(m.slugCandidates('pages-bluesun-git-fix-minor-fix-bid.vercel.app'), ['pages-bluesun']);
  assert.deepEqual(m.slugCandidates('pages-bluesun-a1b2c3d4e-bid.vercel.app'), ['pages-bluesun-a1b2c3d4e', 'pages-bluesun']);
  assert.deepEqual(m.slugCandidates('pages-maslinica-bid.vercel.app'), ['pages-maslinica', 'pages']);
  assert.deepEqual(m.slugCandidates('localhost'), []);
});

test('slugCandidates gives every host of a project the same name', () => {
  // real hosts from the team's repos
  assert.deepEqual(m.slugCandidates('cresanka-staging.vercel.app'), ['cresanka']);
  assert.deepEqual(m.slugCandidates('armanihotels-staging.vercel.app'), ['armanihotels']);
  assert.deepEqual(m.slugCandidates('cresanka-git-fix-style-fixes-bid.vercel.app'), ['cresanka']);
  assert.deepEqual(m.slugCandidates('cresanka-git-cu-86bc6wf75dodavanje-hide-title-from-h-3393e6-bid.vercel.app'), ['cresanka']);
  assert.deepEqual(m.slugCandidates('cresanka-staging-git-fix-bid.vercel.app'), ['cresanka']);
  assert.deepEqual(m.slugCandidates('beach-blue-sun.vercel.app'), ['beach-blue-sun']);
});

test('browserLabel prefers Edge over Chrome', () => {
  assert.equal(m.browserLabel('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56'), 'Edge 130');
  assert.equal(m.browserLabel('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'), 'Chrome 130');
});

test('browserLabel names Safari by its Version, not its WebKit build', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
  assert.equal(m.browserLabel(safari), 'Safari 26');
  assert.equal(m.browserLabel('Mozilla/5.0 (Windows NT 10.0; rv:144.0) Gecko/20100101 Firefox/144.0'), 'Firefox 144');
});

test('sanitizePrepared keeps sentences whole, caps the bullet count, falls back to the note', () => {
  const long = 'A rather long sentence that must never be cut off in the middle because that reads badly.';
  const p = m.sanitizePrepared({ title: long, bullets: ['- a', long, 'c', 'd', 5, ''] }, 'note');
  assert.equal(p.title, long);
  assert.deepEqual(p.bullets, ['a', long, 'c']);
  assert.deepEqual(m.sanitizePrepared({ title: 'T', bullets: [] }, 'raw note').bullets, ['raw note']);
  assert.equal(m.sanitizePrepared({ bullets: ['a'] }, 'n'), null);
  assert.equal(m.sanitizePrepared('nope', 'n'), null);
});

test('extractJson tolerates fences and prose', () => {
  assert.deepEqual(m.extractJson('```json\n{"title":"t","bullets":["a"]}\n```'), { title: 't', bullets: ['a'] });
  assert.deepEqual(m.extractJson('Here you go: {"title":"t"} thanks'), { title: 't' });
  assert.equal(m.extractJson('no json'), null);
});

test('fallbackTitle uses the first line and the block name', () => {
  assert.equal(m.fallbackTitle('\n  gumb ide preko naslova\ndruga linija', 'Hero'), 'Hero: gumb ide preko naslova');
  assert.equal(m.fallbackTitle('x', 'N/A'), 'x');
});

const submission = {
  note: 'cta gumb ide preko naslova\nna mobitelu',
  block: { name: 'Hero', id: '4821', source: 'debug-span' },
  element: { selector: 'section > button.btn-primary', text: 'Book now' },
  page: {
    url: 'https://pages-bluesun-git-staging-bid.vercel.app/rooms/superior?x=1',
    host: 'pages-bluesun-git-staging-bid.vercel.app',
    path: '/rooms/superior?x=1',
    title: 'Superior',
    projectKey: 'pages-bluesun',
    repoLabel: 'pages-bluesun',
    slugCandidates: ['pages-bluesun'],
    environment: 'staging',
  },
  projectLabel: 'Bluesun',
  project: { listId: '1', label: 'Bluesun' },
  prepared: { title: 'Hero: CTA preklapa naslov na mobitelu', bullets: ['CTA gumb preklapa naslov ispod 390 px.', 'Očekivano: gumb ispod naslova.'] },
  screenshot: null,
  viewport: { w: 390, h: 844 },
  browser: 'Chrome 130',
};

test('buildDescription is neat and links the reported page', () => {
  const d = m.buildDescription(submission, new Date(2026, 8, 17, 12, 34));
  assert.equal(
    d,
    [
      '- CTA gumb preklapa naslov ispod 390 px.',
      '- Očekivano: gumb ispod naslova.',
      '',
      '**Where**',
      '🔗 [pages-bluesun › /rooms/superior?x=1](https://pages-bluesun-git-staging-bid.vercel.app/rooms/superior?x=1)',
      '**Environment** Staging',
      '**Block** Hero · #4821',
      '**Element** `section > button.btn-primary` — "Book now"',
      '',
      '**Original note**',
      '> cta gumb ide preko naslova',
      '> na mobitelu',
      '',
      '---',
      'Reported with Pointer · 390×844 · Chrome 130 · 17.09.2026 12:34',
    ].join('\n'),
  );
});

test('buildDescription without a rewrite uses the raw note once', () => {
  const d = m.buildDescription({ ...submission, prepared: null, block: { name: '', id: '', source: 'none' } }, new Date(2026, 0, 1));
  assert.ok(d.startsWith('cta gumb ide preko naslova\nna mobitelu\n\n**Where**'));
  assert.ok(!d.includes('Original note'));
  assert.ok(!d.includes('**Block**'));
});

const projects = [
  { listId: 'bluesun', label: 'Bluesun' },
  { listId: 'cres', label: 'Cresanka › Development' },
  { listId: 'bid', label: 'bid. › Development' },
  { listId: 'bidcms', label: 'BID CMS' },
  { listId: 'hvar', label: 'Sunčani Hvar' },
  { listId: 'ilirija', label: 'Ilirija' },
  { listId: 'manora', label: 'Manora' },
  { listId: 'imperiale', label: 'Imperiale - Forte de Marmi' },
  { listId: 'bristol', label: 'The Bristol' },
  { listId: '901418360025', label: 'Hotel Dubrovnik Zagreb › Development' },
];
const page = (host) => ({ url: '', host, path: '/', title: '', projectKey: host, repoLabel: host, slugCandidates: m.slugCandidates(host) });

test('suggest matches names, diacritics, containment and aliases', () => {
  const top = (host) => m.suggest(page(host), projects).map((p) => p.listId);
  assert.deepEqual(top('pages-bluesun-bid.vercel.app'), ['bluesun']);
  assert.deepEqual(top('pages-cresanka-git-staging-bid.vercel.app'), ['cres']);
  assert.deepEqual(top('pages-suncanihvar-bid.vercel.app'), ['hvar']);
  assert.deepEqual(top('pages-ilirijabiograd-bid.vercel.app'), ['ilirija']);
  assert.deepEqual(top('pages-manora-losinj-bid.vercel.app'), ['manora']);
  assert.deepEqual(top('pages-imperiale-bid.vercel.app'), ['imperiale']);
  assert.deepEqual(top('pages-bristol-bid.vercel.app'), ['bristol']);
  assert.deepEqual(top('pages-hdz-bid.vercel.app'), ['901418360025']); // alias table
  assert.deepEqual(top('pages-bid-bid.vercel.app'), ['bid']); // exact only, "BID CMS" must not match
  assert.deepEqual(top('localhost'), []);
});

test('bestSuggestion pre-selects only a clear winner', () => {
  const best = (host, list = projects) => m.bestSuggestion(page(host), list)?.listId ?? null;
  assert.equal(best('pages-cresanka-git-staging-bid.vercel.app'), 'cres');
  assert.equal(best('pages-suncanihvar-bid.vercel.app'), 'hvar');
  assert.equal(best('pages-hdz-bid.vercel.app'), '901418360025'); // alias beats name matches
  assert.equal(best('localhost'), null);
  // a folder without a Development list offers each of its lists: equally good, so ask
  const tied = [
    { listId: 'qa', label: 'Foo › QA' },
    { listId: 'design', label: 'Foo › Design' },
  ];
  assert.equal(best('pages-foo-bid.vercel.app', tied), null);
});

test('environmentOf tells staging, production and local apart', () => {
  assert.equal(m.environmentOf('pages-bluesun-git-staging-bid.vercel.app'), 'staging');
  assert.equal(m.environmentOf('pages-bluesun-bid.vercel.app'), 'staging');
  assert.equal(m.environmentOf('localhost'), 'local');
  assert.equal(m.environmentOf('www.bluesunhotels.com'), 'production');
  assert.equal(m.environmentOf('cresanka-staging.vercel.app'), 'staging');
  assert.equal(m.environmentOf('beach-blue-sun.vercel.app'), 'staging'); // live sites never run on vercel.app
  // the person's own sites count as staging, wherever they're hosted
  assert.equal(m.environmentOf('staging.example.com'), 'production');
  assert.equal(m.environmentOf('staging.example.com', ['staging.example.com']), 'staging');
});

// bid's own setup, as its people enter it on the options page
const BID_SITES = ['*-staging.vercel.app', '*-bid.vercel.app'];
const BID_CREDIT = 'bid.agency, bid.hr';

test('startsByItself: localhost and the site list, nothing else', () => {
  assert.ok(m.startsByItself('cresanka-staging.vercel.app', BID_SITES));
  assert.ok(m.startsByItself('Armanihotels-Staging.vercel.app', BID_SITES));
  assert.ok(m.startsByItself('cresanka-git-fix-style-fixes-bid.vercel.app', BID_SITES));
  assert.ok(m.startsByItself('pages-bluesun-bid.vercel.app', BID_SITES));
  assert.ok(m.startsByItself('localhost', []));
  assert.ok(!m.startsByItself('someone-else.vercel.app', BID_SITES)); // needs the footer credit
  assert.ok(!m.startsByItself('www.cresanka.hr', BID_SITES)); // needs the footer credit
  assert.ok(!m.startsByItself('staging.example.com', BID_SITES));
  assert.ok(!m.startsByItself('cresanka-staging.vercel.app', [])); // a fresh install: only localhost
});

test('onSiteList takes pasted addresses and * wildcards, matched whole', () => {
  assert.ok(m.onSiteList('staging.example.com', ['https://Staging.Example.com/rooms?x=1']));
  assert.ok(m.onSiteList('staging.example.com', ['staging.example.com:3000']));
  assert.ok(m.onSiteList('a.b.example.com', ['*.example.com']));
  assert.ok(!m.onSiteList('example.com', ['*.example.com']));
  assert.ok(!m.onSiteList('staging.example.com.evil.test', ['staging.example.com']));
  assert.ok(!m.onSiteList('stagingXexample.com', ['staging.example.com'])); // the dot is a dot, not "any character"
  assert.ok(!m.onSiteList('anything.test', ['', '   ']));
  assert.equal(m.sitePattern('  HTTPS://www.Example.com:8080/path#x '), 'www.example.com');
});

test('creditsFooter recognises every way bid sites credit bid, and nothing looser', () => {
  const s = (text, links = [], shortTexts = []) => ({ text, links, shortTexts });
  const bid = (sample) => m.creditsFooter(sample, BID_CREDIT);
  assert.ok(bid(s('© 2026 Bluesun Powered by bid.'))); // pages-*, hotel-kastelet
  assert.ok(bid(s('Ilirija Resort, All rights reserved © 2022 | Powered by bid.hr'))); // ilirija
  assert.ok(bid(s('Copyright © 2026. Powered by', ['https://bid.agency']))); // imperiale: logo link
  assert.ok(bid(s('Lumen', ['https://bid.hr']))); // a client's site
  assert.ok(bid(s('Powered by bid', [], ['bid']))); // maslinica, manora: <span>bid</span>
  assert.ok(bid(s('Mon Perin', ['https://www.bid.agency/en']))); // subdomain
  assert.ok(bid(s('Design: x', [], ['bid.']))); // the name on its own
  assert.ok(!bid(s('Place a bid on this lot. Bidding closes Friday.')));
  assert.ok(!bid(s('Follow us', ['https://www.facebook.com/Bid.hr', 'https://notbid.agency.example.com'])));
  assert.ok(!bid(s('Powered by bidfood')));
  // no credit set up: nothing counts
  assert.ok(!m.creditsFooter(s('Powered by bid', ['https://bid.hr'], ['bid']), ''));
  // any agency, any name
  assert.ok(m.creditsFooter(s('Site by Acme Studio', ['https://acme-studio.co.uk/']), 'acme-studio.co.uk'));
  assert.ok(m.creditsFooter(s('Powered by acme-studio'), 'acme-studio.co.uk'));
  assert.deepEqual(m.creditDomains(' bid.agency; https://bid.hr/ , notadomain '), ['bid.agency', 'bid.hr']);
});

test('domainCandidates turns a live domain into project names', () => {
  assert.deepEqual(m.domainCandidates('www.bluesunhotels.com'), ['bluesunhotels']);
  assert.deepEqual(m.domainCandidates('cresanka.hr'), ['cresanka']);
  assert.deepEqual(m.domainCandidates('booking.manora-losinj.hr'), ['manora-losinj', 'booking']);
  assert.deepEqual(m.domainCandidates('www.hotel.co.uk'), ['hotel']);
  assert.deepEqual(m.domainCandidates('localhost'), []);
});

test('pageInfo for a live site: production, keyed by domain, matched to its project', () => {
  const loc = (host, path = '/sobe') => ({ href: `https://${host}${path}`, host, hostname: host, pathname: path, search: '' });
  const live = m.pageInfo(loc('www.bluesunhotels.com'), 'Bluesun');
  assert.equal(live.environment, 'production');
  assert.equal(live.projectKey, 'bluesunhotels.com');
  assert.equal(live.repoLabel, 'bluesunhotels.com');
  assert.deepEqual(m.suggest(live, projects).map((p) => p.listId), ['bluesun']);
  assert.equal(m.bestSuggestion(m.pageInfo(loc('www.cresanka.hr'), ''), projects)?.listId, 'cres');
  const staging = m.pageInfo(loc('pages-cresanka-git-staging-bid.vercel.app'), '');
  assert.equal(staging.environment, 'staging');
  assert.equal(staging.projectKey, 'pages-cresanka');
  const alias = m.pageInfo(loc('cresanka-staging.vercel.app'), '');
  assert.equal(alias.environment, 'staging');
  assert.equal(alias.projectKey, 'cresanka');
  assert.equal(m.bestSuggestion(alias, projects)?.listId, 'cres');
});

test('buildDescription marks a live-site task as production', () => {
  const live = { ...submission, page: { ...submission.page, environment: 'production', url: 'https://www.bluesunhotels.com/sobe' } };
  assert.ok(m.buildDescription(live).includes('**Environment** Production (live site)'));
});

// ---------- page tasks ----------

test('pageKeyOf: one key per page, whatever the query, hash or trailing slash', () => {
  assert.equal(m.pageKeyOf({ host: 'Cresanka-Staging.vercel.app', pathname: '/rooms/superior/' }), 'cresanka-staging.vercel.app/rooms/superior');
  assert.equal(m.pageKeyOf({ host: 'localhost:8765', pathname: '/' }), 'localhost:8765/');
  assert.equal(m.pageKeyOf({ host: 'www.cresanka.hr', pathname: '' }), 'www.cresanka.hr/');
});

test('pageTaskTitle names the page from its title, else its path', () => {
  assert.equal(m.pageTaskTitle({ title: 'Superior room | Cresanka', path: '/rooms/superior' }), 'Superior room Changes');
  assert.equal(m.pageTaskTitle({ title: 'Smještaj – Hotel Cresanka', path: '/smjestaj' }), 'Smještaj Changes');
  assert.equal(m.pageTaskTitle({ title: 'Cresanka', path: '/' }), 'Cresanka Changes');
  assert.equal(m.pageTaskTitle({ title: '', path: '/ponuda/rani-booking?x=1' }), 'Rani booking Changes');
  assert.equal(m.pageTaskTitle({ title: '  ', path: '/' }), 'Home page Changes');
  assert.equal(m.pageTaskTitle({ title: 'Pre-season offer | Cresanka', path: '/' }), 'Pre-season offer Changes'); // a hyphen inside a word isn't a separator
});

const item = (over) => ({
  id: 'a',
  note: 'cta gumb ide preko naslova',
  block: { name: 'Hero', id: '4821', source: 'debug-span' },
  element: { selector: 'section > button.btn-primary', text: 'Book now' },
  anchor: { path: 'body > section > button', fx: 0.5, fy: 0.5, pageX: 100, pageY: 200 },
  screenshot: true,
  prepared: { title: 'Hero: CTA overlaps the title', bullets: ['The button covers the title on mobile.'] },
  createdAt: 0,
  ...over,
});

test('buildPageDescription lists every note with its own place, screenshot and wording', () => {
  const d = m.buildPageDescription(
    {
      page: submission.page,
      items: [
        item({}),
        item({ id: 'b', note: 'kartice nisu poravnate', block: { name: '', id: '', source: 'none' }, element: { selector: 'div.card', text: '' }, screenshot: false, prepared: null }),
      ],
      viewport: { w: 1280, h: 800 },
      browser: 'Firefox 145',
      reporter: 'Ana Test',
    },
    new Date(2026, 9, 6, 9, 5),
  );
  assert.equal(
    d,
    [
      '🔗 [pages-bluesun › /rooms/superior?x=1](https://pages-bluesun-git-staging-bid.vercel.app/rooms/superior?x=1)',
      '**Environment** Staging · 2 notes',
      '',
      '**1. Hero: CTA overlaps the title**',
      '- The button covers the title on mobile.',
      '**Block** Hero · #4821 · **Element** `section > button.btn-primary` — "Book now" · **Screenshot** pointer-1-hero.png',
      '> cta gumb ide preko naslova',
      '',
      '**2. Note**',
      'kartice nisu poravnate',
      '**Element** `div.card`',
      '',
      '---',
      'Reported with Pointer · 1280×800 · Firefox 145 · 06.10.2026 09:05 · reported by Ana Test',
    ].join('\n'),
  );
});

test('shotName numbers screenshots in the order of the notes', () => {
  assert.equal(m.shotName(0, { block: { name: 'ExperiencesListWithFilters' } }), 'pointer-1-experienceslistwithfilters.png');
  assert.equal(m.shotName(4, { block: { name: 'N/A' } }), 'pointer-5-note.png');
});

// ---------- Comment Mode: reading open tasks back from ClickUp ----------

// The shapes ClickUp gives back: `text_content` (plain) and `markdown_description`, which it
// re-escapes ("1\." for "1.", "*   " for "- ", "* * *" for "---").
const singlePlain = [
  'The CTA covers the title on mobile.',
  'It should sit below the title.',
  '',
  'Where',
  '🔗 cresanka › /rooms/superior?x=1',
  'Environment Staging',
  'Block Hero · #4821',
  'Element section > button.btn-primary — "Book now"',
  '',
  'Original note',
  'cta gumb ide preko naslova',
  '',
  'Reported with Pointer · 1280×800 · Chrome 154 · 13.10.2026 10:05',
].join('\n');
const singleMarkdown = [
  '*   The CTA covers the title on mobile.',
  '',
  '**Where**',
  '🔗 [cresanka › /rooms/superior?x=1](https://cresanka-staging.vercel.app/rooms/superior?x=1)',
  '**Environment** Staging',
  '**Block** Hero · #4821',
  '**Element** `section > button.btn-primary` — "Book now"',
  '',
  '* * *',
  '',
  'Reported with Pointer · 1280×800 · Chrome 154 · 13.10.2026 10:05',
].join('\n');
// before 0.2.0: no environment line, and the label of a deployment-hash host
const firstVersion = '**Where**\n🔗 [cresanka-n6tjur1dn › /dozivljaji](https://cresanka-n6tjur1dn-bid.vercel.app/dozivljaji)\n**Block** ExperiencesList · #13';
const pageMarkdown = [
  '🔗 [cresanka › /rooms/superior](https://cresanka-staging.vercel.app/rooms/superior)',
  '**Environment** Staging · 2 notes',
  '',
  '**1\\. Hero: CTA overlaps the title**',
  '*   The button covers the title on mobile.',
  '',
  '**Block** Hero · #4821 · **Element** `section > button` — "Book now" · **Screenshot** pointer-1-hero.png',
  '',
  '**2\\. RoomList: prices without a currency**',
  '**Block** RoomList · #77 · **Element** `div.card`',
].join('\n');

test('readTaskFacts reads a single task in both of ClickUp’s forms', () => {
  const want = { kind: 'single', path: '/rooms/superior', environment: 'staging', blocks: [{ name: 'Hero', id: '4821' }] };
  assert.deepEqual(m.readTaskFacts(singlePlain), want);
  assert.deepEqual(m.readTaskFacts(singleMarkdown), want);
  assert.deepEqual(m.readTaskFacts(firstVersion), { kind: 'single', path: '/dozivljaji', environment: 'staging', blocks: [{ name: 'ExperiencesList', id: '13' }] });
});

test('readTaskFacts tells a page task by its note count, and reads every note’s block', () => {
  assert.deepEqual(m.readTaskFacts(pageMarkdown), {
    kind: 'page',
    path: '/rooms/superior',
    environment: 'staging',
    blocks: [
      { name: 'Hero', id: '4821' },
      { name: 'RoomList', id: '77' },
    ],
  });
  assert.equal(m.readTaskFacts('A task someone wrote by hand.\nBlock party on Friday?'), null);
  assert.equal(m.readTaskFacts('Nothing from Pointer here.'), null);
});

test('readTaskFacts reads what Pointer writes today, so matching survives format changes', () => {
  const single = m.readTaskFacts(m.buildDescription(submission));
  assert.deepEqual(single, { kind: 'single', path: '/rooms/superior', environment: 'staging', blocks: [{ name: 'Hero', id: '4821' }] });
  const page = m.readTaskFacts(
    m.buildPageDescription({ page: submission.page, items: [item({})], viewport: { w: 1280, h: 800 }, browser: 'Chrome 154' }),
  );
  assert.equal(page.kind, 'page');
  assert.equal(page.path, '/rooms/superior');
  const live = m.readTaskFacts(m.buildDescription({ ...submission, page: { ...submission.page, environment: 'production' } }));
  assert.equal(live.environment, 'production');
});

const here = (path, environment = 'staging') => ({ ...submission.page, path, environment });
const hero = { name: 'Hero', id: '4821', source: 'debug-span' };

test('matchesBlock: the same block on the same page, in the same environment', () => {
  const facts = m.readTaskFacts(singleMarkdown);
  assert.ok(m.matchesBlock(facts, hero, here('/rooms/superior')));
  assert.ok(m.matchesBlock(facts, hero, here('/Rooms/Superior/?utm=x'))); // query, case and trailing slash don't matter
  assert.ok(!m.matchesBlock(facts, hero, here('/rooms/standard'))); // the same block type on another page
  assert.ok(!m.matchesBlock(facts, { ...hero, id: '9' }, here('/rooms/superior'))); // another block type
  assert.ok(!m.matchesBlock(facts, hero, here('/rooms/superior', 'production')));
  assert.ok(!m.matchesBlock(facts, { name: '', id: '', source: 'none' }, here('/rooms/superior')));
});

test('matchesPage: only a page task for the same page', () => {
  assert.ok(m.matchesPage(m.readTaskFacts(pageMarkdown), here('/rooms/superior?x=1')));
  assert.ok(!m.matchesPage(m.readTaskFacts(pageMarkdown), here('/rooms')));
  assert.ok(!m.matchesPage(m.readTaskFacts(singleMarkdown), here('/rooms/superior')));
});

test('pickMatch: a task about the block wins over a page task that mentions it, then the newest', () => {
  const page = { facts: m.readTaskFacts(pageMarkdown), updated: 300 };
  const single = { facts: m.readTaskFacts(singleMarkdown), updated: 100 };
  const newerSingle = { facts: m.readTaskFacts(singlePlain), updated: 200 };
  const elsewhere = { facts: m.readTaskFacts(firstVersion), updated: 999 };
  assert.equal(m.pickMatch([page, single, newerSingle, elsewhere], 'block', hero, here('/rooms/superior')), 2);
  assert.equal(m.pickMatch([page, elsewhere], 'block', hero, here('/rooms/superior')), 0); // the page task has a note on Hero
  assert.equal(m.pickMatch([single, page], 'page', hero, here('/rooms/superior')), 1);
  assert.equal(m.pickMatch([single, elsewhere], 'page', hero, here('/rooms/superior')), -1);
});

test('screen recordings: named by type, timed, and mentioned where the task says where things are', () => {
  assert.equal(m.videoExt('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(m.videoExt('video/webm;codecs=vp8'), 'webm');
  assert.equal(m.clock(7_400), '0:07');
  assert.equal(m.clock(90_000), '1:30');
  const video = { name: 'pointer-hero-1.mp4', mime: 'video/mp4', ms: 12_000 };
  const lines = m.buildDescription({ ...submission, video }, new Date(2026, 9, 14, 9, 0)).split('\n');
  assert.equal(lines[lines.indexOf('**Element** `section > button.btn-primary` — "Book now"') + 1], '**Video** pointer-hero-1.mp4 (0:12)');
  assert.ok(m.buildCommentText({ ...submission, video }).includes("Video: pointer-hero-1.mp4 (0:12, in the task's attachments)"));
  const page = m.buildPageDescription({
    page: submission.page,
    items: [item({ video: { mime: 'video/webm', ms: 5_000 } })],
    viewport: { w: 1280, h: 800 },
    browser: 'Firefox 145',
  });
  assert.ok(page.includes('**Screenshot** pointer-1-hero.png · **Video** pointer-1-hero.webm (0:05)'), page);
  assert.equal(m.videoName(2, { block: { name: 'RoomList' }, video: { mime: 'video/mp4', ms: 1 } }), 'pointer-3-roomlist.mp4');
});

test('factsFor: what Pointer knows about a task it just made, matched like one read back', () => {
  const facts = m.factsFor(here('/Rooms/Superior/?x=1'), 'single', [hero, { name: '', id: '', source: 'none' }]);
  assert.deepEqual(facts, { kind: 'single', path: '/rooms/superior', environment: 'staging', blocks: [{ name: 'Hero', id: '4821' }] });
  assert.ok(m.matchesBlock(facts, hero, here('/rooms/superior')));
  assert.ok(m.matchesPage(m.factsFor(here('/rooms/superior'), 'page', [hero]), here('/rooms/superior')));
});

test('isOpenPointerTask: open and tagged pointer, nothing else', () => {
  const open = { id: '1', name: 'x', url: '', status: { status: 'qa', type: 'custom' }, date_closed: null, tags: [{ name: 'pointer' }, { name: 'staging' }] };
  assert.ok(m.isOpenPointerTask(open));
  assert.ok(m.isOpenPointerTask({ ...open, tags: [{ name: 'Pointer' }] }));
  assert.ok(!m.isOpenPointerTask({ ...open, tags: [{ name: 'staging' }] })); // not Pointer's
  assert.ok(!m.isOpenPointerTask({ ...open, status: { status: 'done', type: 'done' } }));
  assert.ok(!m.isOpenPointerTask({ ...open, status: { status: 'closed', type: 'closed' } }));
  assert.ok(!m.isOpenPointerTask({ ...open, date_closed: '1791889660185' }));
  assert.ok(!m.isOpenPointerTask({ ...open, archived: true }));
});

test('buildCommentText: plain lines, the point first, then where, the original and the footer', () => {
  const text = m.buildCommentText(
    { ...submission, screenshot: 'data:image/png;base64,AA', screenshotName: 'pointer-hero-1.png', reporter: 'Ana Test' },
    new Date(2026, 9, 13, 10, 5),
  );
  assert.equal(
    text,
    [
      'Hero: CTA preklapa naslov na mobitelu',
      '• CTA gumb preklapa naslov ispod 390 px.',
      '• Očekivano: gumb ispod naslova.',
      '',
      'Page: https://pages-bluesun-git-staging-bid.vercel.app/rooms/superior?x=1',
      'Environment: Staging',
      'Block: Hero · #4821',
      'Element: section > button.btn-primary — "Book now"',
      "Screenshot: pointer-hero-1.png (in the task's attachments)",
      '',
      'Original note:\ncta gumb ide preko naslova\nna mobitelu',
      '',
      'Reported with Pointer · 390×844 · Chrome 130 · 13.10.2026 10:05 · reported by Ana Test',
    ].join('\n'),
  );
  // not rewritten: the note as written, and no "original" twice
  const raw = m.buildCommentText({ ...submission, prepared: null }, new Date(2026, 9, 13, 10, 5));
  assert.ok(raw.startsWith('cta gumb ide preko naslova\nna mobitelu\n\nPage: '));
  assert.ok(!raw.includes('Original note'));
});

test('nearestCorner picks the quarter of the window the point is in', () => {
  assert.equal(m.nearestCorner(10, 10, 1000, 800), 'top-left');
  assert.equal(m.nearestCorner(990, 10, 1000, 800), 'top-right');
  assert.equal(m.nearestCorner(10, 790, 1000, 800), 'bottom-left');
  assert.equal(m.nearestCorner(990, 790, 1000, 800), 'bottom-right');
  // the exact middle goes to the default corner
  assert.equal(m.nearestCorner(500, 400, 1000, 800), m.DEFAULT_CORNER);
});

test('cornerSpot puts a box its margin in from both edges', () => {
  assert.deepEqual(m.cornerSpot('top-left', 170, 44, 1000, 800, 20), { x: 20, y: 20 });
  assert.deepEqual(m.cornerSpot('top-right', 170, 44, 1000, 800, 20), { x: 810, y: 20 });
  assert.deepEqual(m.cornerSpot('bottom-left', 170, 44, 1000, 800, 20), { x: 20, y: 736 });
  assert.deepEqual(m.cornerSpot('bottom-right', 170, 44, 1000, 800, 20), { x: 810, y: 736 });
});

test('isCorner takes the four corners and nothing else', () => {
  for (const c of m.CORNERS) assert.ok(m.isCorner(c));
  for (const v of ['top', 'left-top', '', null, undefined, 3]) assert.equal(m.isCorner(v), false);
});

// a pointer path sampled every 8 ms (a 125 Hz mouse) for `ms`
const path = (ms, at) => {
  const meter = new m.SpinMeter();
  let rate = 0;
  for (let t = 0; t <= ms; t += 8) {
    const { x, y } = at(t);
    rate = meter.sample(x, y, t);
  }
  return rate;
};
const circle = (r, turnsPerSecond) => (t) => ({ x: 640 + r * Math.cos((2 * Math.PI * turnsPerSecond * t) / 1000), y: 400 + r * Math.sin((2 * Math.PI * turnsPerSecond * t) / 1000) });

test('SpinMeter measures circles of any size in turns per second', () => {
  assert.ok(Math.abs(path(1000, circle(50, 2)) - 2) < 0.25);
  assert.ok(Math.abs(path(1500, circle(300, 1)) - 1) < 0.2); // a big loop round the middle of the window
  assert.ok(Math.abs(path(1000, circle(40, -2.5)) - 2.5) < 0.3); // either way round
});

test('SpinMeter ignores straight drags and back-and-forth wiggles', () => {
  assert.ok(path(1000, (t) => ({ x: 100 + t * 0.8, y: 300 + t * 0.2 })) < 0.01);
  assert.ok(path(1500, (t) => ({ x: 640 + 150 * Math.sin((2 * Math.PI * 3 * t) / 1000), y: 400 })) < 0.2);
  assert.ok(path(1500, (t) => ({ x: 640 + 150 * Math.sin((2 * Math.PI * 3 * t) / 1000), y: 400 + 4 * Math.sin(t / 7) })) < 0.5);
});

// runs the party at 60 frames a second
const run = (party, seconds, spin, moving = true) => {
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    const e = party.step(1 / 60, spin, moving);
    if (e) events.push([e, i / 60]);
  }
  return events;
};

test('Party starts after a couple of seconds of quick spinning, not slow circling', () => {
  const quick = new m.Party();
  const [[event, at]] = run(quick, 3, 1.5);
  assert.equal(event, 'start');
  assert.ok(at > 1.4 && at < 2, `started at ${at}s`);
  const slow = new m.Party();
  assert.deepEqual(run(slow, 10, 0.7), []);
  assert.equal(slow.energy, 0);
});

test('Party energy fades before it starts, so stop-and-go spins do not add up', () => {
  const party = new m.Party();
  for (let i = 0; i < 6; i++) {
    run(party, 0.8, 1.5);
    run(party, 1.5, 0);
  }
  assert.equal(party.on, false);
});

test('Party gets wilder the longer it spins, up to a limit', () => {
  const party = new m.Party();
  run(party, 2, 1.5);
  const started = party.intensity;
  run(party, 3, 1.5);
  const wilder = party.intensity;
  run(party, 10, 2);
  assert.ok(started < 0.1 && wilder > started + 0.3 && party.intensity === 1, `${started} ${wilder} ${party.intensity}`);
});

test('Party ends after three seconds standing still, and keeps going while it moves', () => {
  const party = new m.Party();
  run(party, 3, 2);
  assert.deepEqual(run(party, 10, 0, true), []); // dragged about without spinning: still going
  assert.equal(party.on, true);
  const [[event, at]] = run(party, 5, 0, false);
  assert.equal(event, 'end');
  assert.ok(Math.abs(at - 3) < 0.05, `ended at ${at}s`);
  assert.equal(party.intensity, 0);
});

test('Party.stop ends it at once', () => {
  const party = new m.Party();
  run(party, 4, 2);
  assert.equal(party.on, true);
  party.stop();
  assert.ok(!party.on && party.energy === 0 && party.intensity === 0);
  assert.deepEqual(run(party, 4, 0, false), []); // nothing left to end
});
