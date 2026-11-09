// The SEO checks on whole pages: a healthy live page, then one problem at a time, judged by where
// the page is (staging may be hidden from Google, a live page may not).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';
import { network, snapshot, staging, stagingNetwork } from './seo-pages.mjs';

const m = await load('src/shared/seo/index.ts', 'src/shared/match.ts');

const run = (page, net = network()) => m.evaluate({ page, net, measure: m.roughMeasure });
const ids = (page, net) => run(page, net).findings.map((f) => f.id);
const problems = (page, net) =>
  run(page, net)
    .findings.filter(m.isProblem)
    .map((f) => `${f.severity}:${f.id}`);
const find = (page, net, id) => run(page, net).findings.find((f) => f.id === id);

test('a healthy live page passes everything', () => {
  assert.deepEqual(problems(snapshot()), []);
  const passed = ids(snapshot());
  for (const id of ['status-ok', 'indexable', 'robots-ok', 'sitemap-listed', 'canonical-ok', 'title-ok', 'description-ok', 'lang-ok', 'hreflang-ok', 'h1-ok', 'images-ok', 'og-image-ok', 'structured-ok', 'https-ok'])
    assert.ok(passed.includes(id), id);
});

test('checks that need the network wait for it; the rest answer at once', () => {
  const { findings, waiting } = run(snapshot(), {});
  assert.equal(waiting, 8);
  assert.ok(findings.some((f) => f.id === 'title-ok'));
  assert.ok(!findings.some((f) => f.check === 'robots' || f.check === 'status'));
});

test("Bluesun's staging page: language codes and an empty canonical are to fix", () => {
  const codes = ['hr', 'en', 'de', 'se', 'si', 'cz', 'dk'].map((lang) => ({ lang, href: `https://www.bluesunhotels.com/${lang === 'hr' ? '' : `${lang}/`}rooms` }));
  const page = staging({
    url: 'https://bluesun-staging.vercel.app/en/rooms',
    canonicals: [null],
    alternates: [...codes, { lang: 'x-default', href: 'https://www.bluesunhotels.com/rooms' }],
    social: { 'og:title': 'Rooms', 'og:description': 'Our rooms.' },
    jsonld: [],
  });
  const net = stagingNetwork({ server: { status: 200, finalUrl: page.url, robotsHeader: 'noindex', head: null } });
  assert.deepEqual(problems(page, net), ['fix:canonical-empty', 'fix:hreflang-codes', 'improve:og-image-missing', 'notice:og-tags-some', 'notice:structured-none']);
  const codesFinding = find(page, net, 'hreflang-codes');
  assert.deepEqual(codesFinding.items.map((i) => i.label), ['se', 'si', 'cz', 'dk']);
  assert.equal(codesFinding.detail, "cz, dk aren't codes Google knows · se, si mean other languages");
  assert.equal(codesFinding.scope, 'site');
});

test('noindex: wrong on a live page, right on staging unless the page itself asks for it', () => {
  const noindex = [{ name: 'robots', content: 'noindex, nofollow' }];
  assert.equal(find(snapshot({ robots: noindex }), network(), 'noindex').fixIn, 'cms');
  const header = network({ server: { status: 200, finalUrl: snapshot().url, robotsHeader: 'noindex', head: null } });
  assert.equal(find(snapshot(), header, 'noindex').fixIn, 'code');
  assert.ok(ids(staging(), stagingNetwork()).includes('staging-hidden'));
  assert.ok(ids(staging({ robots: noindex }), stagingNetwork()).includes('noindex-own'));
  const open = stagingNetwork({ server: { status: 200, finalUrl: staging().url, robotsHeader: '', head: null }, access: { status: 200, finalUrl: staging().url } });
  assert.ok(ids(staging(), open).includes('staging-public'));
  const login = stagingNetwork({ server: { status: 200, finalUrl: staging().url, robotsHeader: '', head: null } });
  assert.ok(ids(staging(), login).includes('staging-login'));
});

test("robots.txt and the sitemap, live and on staging", () => {
  const blocked = network({ robots: { status: 200, html: false, text: 'User-agent: *\nDisallow: /en/\nSitemap: https://www.cresanka.hr/sitemap.xml' } });
  assert.equal(find(snapshot(), blocked, 'robots-blocked').detail, 'Disallow: /en/');
  assert.ok(ids(staging(), { ...stagingNetwork(), robots: blocked.robots }).includes('robots-staging'));
  assert.ok(ids(snapshot(), network({ robots: { status: 200, html: true, text: '<!doctype html>' } })).includes('robots-html'));
  assert.ok(ids(snapshot(), network({ robots: { status: 503, html: false, text: '' } })).includes('robots-error'));
  const absent = network({ sitemap: { ...network().sitemap, found: false } });
  assert.ok(problems(snapshot(), absent).includes('improve:sitemap-absent'));
  const otherHost = network({ sitemap: { ...network().sitemap, hosts: ['cresanka-staging.vercel.app'] } });
  assert.ok(problems(snapshot(), otherHost).includes('improve:sitemap-host'));
});

test('canonical: home page, another language, another page, another domain', () => {
  assert.ok(ids(snapshot({ canonicals: ['https://www.cresanka.hr/'] })).includes('canonical-home'));
  assert.ok(ids(snapshot({ canonicals: ['https://www.cresanka.hr/smjestaj/superior'] })).includes('canonical-language'));
  assert.ok(ids(snapshot({ canonicals: ['https://www.cresanka.hr/en/rooms'] })).includes('canonical-other'));
  assert.ok(ids(snapshot({ canonicals: ['https://cresanka.com/en/rooms/superior'] })).includes('canonical-domain'));
  assert.ok(ids(snapshot({ canonicals: ['/en/rooms/superior'] })).includes('canonical-relative'));
  assert.ok(ids(snapshot({ canonicals: [] })).includes('canonical-missing'));
  // staging naming the live address is right
  assert.equal(find(staging(), stagingNetwork(), 'canonical-ok').title, 'The canonical names the live address of this page');
});

test('title and description: missing, cut off, short, the same as other pages', () => {
  assert.ok(problems(snapshot({ titles: [] })).includes('fix:title-missing'));
  assert.ok(ids(snapshot({ titles: ['x'.repeat(70)] })).includes('title-long'));
  assert.ok(ids(snapshot({ titles: ['Rooms'] })).includes('title-short'));
  assert.ok(ids(snapshot({ descriptions: [] })).includes('description-missing'));
  assert.ok(ids(snapshot({ descriptions: ['y'.repeat(170)] })).includes('description-long'));
  const site = network({ site: { titleSame: [], descriptionSame: ['/en/rooms/standard', '/en/spa'], pages: 4, sent: {} } });
  const same = find(snapshot(), site, 'description-same');
  assert.equal(same.title, '2 other pages have the same description');
  assert.deepEqual(same.items.map((i) => i.label), ['/en/rooms/standard', '/en/spa']);
  assert.ok(ids(snapshot(), site).includes('title-unique'));
});

test('headings, images and links', () => {
  assert.ok(ids(snapshot({ headings: [] })).includes('h1-missing'));
  const two = [{ ref: 'a', level: 1, text: 'One', visible: true }, { ref: 'b', level: 1, text: 'Two', visible: false }];
  assert.ok(ids(snapshot({ headings: two })).includes('h1-several'));
  const skip = [{ ref: 'a', level: 1, text: 'Rooms', visible: true }, { ref: 'b', level: 3, text: 'Sea view', visible: true }];
  assert.equal(find(snapshot({ headings: skip }), network(), 'headings-order').detail, 'H1 → H3');
  const img = (alt, w = 800, h = 500, src = 'https://x.hr/a.jpg') => ({ ref: 'i', src, alt, w, h, naturalW: w, naturalH: h, decorative: false, block: 'Hero' });
  const images = [img(null), img(''), img('', 24, 24, 'https://x.hr/icon.svg'), img('IMG_1234.jpg'), img('', 1, 1)];
  const alt = find(snapshot({ images }), network(), 'images-alt');
  assert.equal(alt.title, '2 images have no alt text');
  assert.equal(alt.items[0].note, 'in Hero · no alt attribute');
  assert.ok(ids(snapshot({ images })).includes('images-filename'));
  const links = [{ ref: 'a', href: 'https://www.instagram.com/cresanka', name: '', visible: true }];
  assert.ok(ids(snapshot({ links })).includes('links-nameless'));
  const checked = network({ links: { checked: 3, broken: [{ href: '/en/old', ref: 'a', name: 'Old offer', status: 404 }], redirects: [] } });
  assert.equal(find(snapshot(), checked, 'links-broken').items[0].note, '404 Not Found · “Old offer”');
});

test('scripts: tags missing from the HTML the server sends', () => {
  const head = { ...snapshot(), descriptions: [], canonicals: [] };
  const late = find(snapshot(), network({ server: { status: 200, finalUrl: snapshot().url, robotsHeader: '', head } }), 'rendered-late');
  assert.equal(late.title, 'Only added by scripts: description, canonical');
});

test('sharing and structured data', () => {
  assert.ok(ids(snapshot(), network({ ogImage: { w: 400, h: 300 } })).includes('og-image-small'));
  assert.ok(ids(snapshot(), network({ ogImage: { error: "didn't load" } })).includes('og-image-broken'));
  assert.ok(problems(snapshot({ jsonld: ['{"@type": "Hotel",}'] })).includes('fix:structured-broken'));
  const graph = JSON.stringify({ '@graph': [{ '@type': 'Hotel' }, { '@type': ['Organization', 'Brand'] }] });
  assert.equal(find(snapshot({ jsonld: [graph] }), network(), 'structured-ok').title, 'Structured data: Hotel, Organization, Brand');
});

test('the ClickUp task: numbered findings, and nothing Comment Mode would match', () => {
  const page = staging({ title: 'Superior room | Cresanka', path: '/en/rooms/superior', repoLabel: 'cresanka', projectKey: 'cresanka', host: 'cresanka-staging.vercel.app' });
  const findings = run(staging({ images: [{ ref: 'i', src: 'https://x.hr/Block.jpg', alt: null, w: 800, h: 500, naturalW: 0, naturalH: 0, decorative: false, block: 'Block' }] }), stagingNetwork())
    .findings.filter(m.isProblem)
    .map(m.forTask);
  const text = m.buildSeoDescription({ page, findings, viewport: { w: 1280, h: 800 }, browser: 'Chrome 141', reporter: 'Ana' }, new Date(2026, 9, 26, 14, 3));
  assert.match(text, /^🔗 \[cresanka › \/en\/rooms\/superior\]\(https:\/\/cresanka-staging\.vercel\.app\/en\/rooms\/superior\)\n\*\*Environment\*\* Staging · SEO check · 1 finding\n/);
  assert.match(text, /\*\*1\. 1 image has no alt text\*\*\nTo improve · this page · fix in the code\n1 without an alt attribute\n- `Block\.jpg` · in Block · no alt attribute\nWhy: /);
  assert.ok(!text.includes('"ref"') && !/thumb/.test(text));
  assert.equal(m.seoTaskTitle({ title: 'Superior room | Cresanka', path: '/en/rooms/superior' }), 'Superior room SEO');
  // Comment Mode reads every open Pointer task; an SEO task is never a block's or a page's task
  const facts = m.readTaskFacts(text);
  assert.deepEqual(facts.blocks, []);
  assert.equal(facts.kind, 'single');
  const block = { name: 'Block', id: '', source: 'debug-span' };
  assert.equal(m.pickMatch([{ facts, updated: 1 }], 'block', block, page), -1);
  assert.equal(m.pickMatch([{ facts, updated: 1 }], 'page', block, page), -1);
});

test('sent findings are remembered by kind for the whole site, by kind and page otherwise', () => {
  assert.equal(m.sentKey({ id: 'hreflang-codes', scope: 'site' }, '/en/rooms'), 'site|hreflang-codes');
  assert.equal(m.sentKey({ id: 'images-alt', scope: 'page' }, '/en/Rooms/'), 'page|/en/rooms|images-alt');
  assert.equal(m.siteKey({ environment: 'staging', projectKey: 'cresanka' }), 'staging:cresanka');
  assert.equal(m.startsTicked({ severity: 'fix' }, false), true);
  assert.equal(m.startsTicked({ severity: 'fix' }, true), false);
  assert.equal(m.startsTicked({ severity: 'notice' }, false), false);
});
