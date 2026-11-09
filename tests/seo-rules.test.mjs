// The SEO check's building blocks: robots.txt, sitemaps, language codes, addresses, Google's cut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';
import { snapshot } from './seo-pages.mjs';

const m = await load('src/shared/seo/index.ts');

test('robots.txt: Googlebot follows its own group, everyone else the * group', () => {
  const r = m.parseRobots('User-agent: *\nDisallow: /private/\n\nUser-agent: Googlebot\nDisallow: /nogoogle/\nAllow: /');
  assert.equal(m.robotsVerdict(r, '/private/x').allowed, true);
  assert.equal(m.robotsVerdict(r, '/nogoogle/x').allowed, false);
  assert.equal(m.robotsVerdict(r, '/private/x', 'bingbot').allowed, false);
});

test('robots.txt: the longest rule wins, Allow wins a tie, * and $ match', () => {
  const r = m.parseRobots('User-agent: *\nDisallow: /rooms\nAllow: /rooms/superior\nDisallow: /*.pdf$\nDisallow: /api/*\nAllow: /tie\nDisallow: /tie');
  assert.deepEqual(m.robotsVerdict(r, '/rooms/standard'), { allowed: false, rule: { allow: false, path: '/rooms' } });
  assert.equal(m.robotsVerdict(r, '/rooms/superior').allowed, true);
  assert.equal(m.robotsVerdict(r, '/files/menu.pdf').allowed, false);
  assert.equal(m.robotsVerdict(r, '/files/menu.pdf?x=1').allowed, true, '$ anchors the end');
  assert.equal(m.robotsVerdict(r, '/api/prices').allowed, false);
  assert.equal(m.robotsVerdict(r, '/tie').allowed, true);
});

test('robots.txt: empty Disallow, comments, a BOM, sitemaps, shared groups', () => {
  const r = m.parseRobots('﻿# hello\nUSER-AGENT: *   # everyone\ndisallow:\nSitemap: https://www.bluesunhotels.com/sitemap.xml\n');
  assert.equal(m.robotsVerdict(r, '/anything').allowed, true);
  assert.deepEqual(r.sitemaps, ['https://www.bluesunhotels.com/sitemap.xml']);
  const shared = m.parseRobots('User-agent: a\nUser-agent: googlebot\nDisallow: /x\nUser-agent: *\nDisallow: /');
  assert.equal(m.robotsVerdict(shared, '/y').allowed, true);
  assert.equal(m.robotsVerdict(shared, '/x').allowed, false);
  // Bluesun's own file (pages/api/robots.ts)
  const bluesun = m.parseRobots('User-agent: *\nAllow: /\nDisallow: /api/*\nSitemap: https://www.bluesunhotels.com/sitemap.xml');
  assert.equal(m.robotsVerdict(bluesun, '/en/rooms').allowed, true);
  assert.equal(m.robotsVerdict(bluesun, '/api/robots').allowed, false);
});

test('robots directives: meta tags, and X-Robots-Tag with crawler names', () => {
  assert.deepEqual([...m.robotsDirectives('noindex, nofollow')], ['noindex', 'nofollow']);
  assert.deepEqual([...m.robotsDirectives('index, follow')], ['index', 'follow']);
  assert.deepEqual([...m.robotsDirectives('otherbot: noindex, nofollow', true)], []);
  assert.deepEqual([...m.robotsDirectives('googlebot: noindex', true)], ['noindex']);
  assert.deepEqual([...m.robotsDirectives('max-snippet: 50, noindex', true)], ['max-snippet', 'noindex']);
});

test('sitemaps: addresses from a urlset or an index, with entities and CDATA', () => {
  const set = m.readSitemapXml(
    '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.bluesunhotels.com/en/rooms?a=1&amp;b=2</loc></url>' +
      '<url><loc><![CDATA[https://www.bluesunhotels.com/hr/smještaj]]></loc></url></urlset>',
  );
  assert.equal(set.kind, 'urlset');
  assert.deepEqual(set.locs, ['https://www.bluesunhotels.com/en/rooms?a=1&b=2', 'https://www.bluesunhotels.com/hr/smještaj']);
  assert.equal(m.readSitemapXml('<sitemapindex><sitemap><loc>https://x.hr/a.xml</loc></sitemap></sitemapindex>').kind, 'index');
  assert.equal(m.readSitemapXml('<!doctype html><html><body>Not found</body></html>').kind, 'unknown');
});

test('sitemaps: staging matches by path, a live site by domain and path', () => {
  const locs = ['https://www.bluesunhotels.com/en/rooms/superior/', 'https://www.bluesunhotels.com/hr/sm%C5%A1'];
  assert.equal(m.sitemapLists(locs, [new URL('https://bluesun-staging.vercel.app/en/rooms/superior')], 'staging'), true);
  assert.equal(m.sitemapLists(locs, [new URL('https://bluesunhotels.com/en/rooms/superior')], 'production'), true, 'with or without www');
  assert.equal(m.sitemapLists(locs, [new URL('https://other.com/en/rooms/superior')], 'production'), false);
  assert.equal(m.sitemapLists(locs, [new URL('https://bluesunhotels.com/hr/smš')], 'production'), true, 'percent-encoding aside');
  assert.deepEqual(m.sitemapHosts(locs), ['bluesunhotels.com']);
});

test("language codes: Bluesun's list, as Google reads it", () => {
  const v = (code) => m.checkLangCode(code, 'hreflang');
  for (const ok of ['hr', 'en', 'de', 'fr', 'it', 'pl', 'hu', 'ru', 'nl', 'fi', 'uk', 'ro', 'sk', 'ko', 'pt', 'x-default', 'en-GB', 'zh-Hant', 'pt-BR', 'de-AT', 'tl'])
    assert.equal(v(ok).ok, true, ok);
  assert.deepEqual(v('cz'), { ok: false, kind: 'invalid', problem: 'a country code; Czech is cs', use: 'cs' });
  assert.deepEqual(v('dk'), { ok: false, kind: 'invalid', problem: 'a country code; Danish is da', use: 'da' });
  assert.deepEqual(v('se'), { ok: false, kind: 'unlikely', problem: 'Northern Sami; Swedish is sv', use: 'sv' });
  assert.deepEqual(v('si'), { ok: false, kind: 'unlikely', problem: 'Sinhala; Slovenian is sl', use: 'sl' });
  assert.equal(m.languageName('hr'), 'Croatian');
});

test('language codes: countries, old codes, underscores, three letters', () => {
  const v = (code, use = 'hreflang') => m.checkLangCode(code, use);
  assert.equal(v('en-UK').use, 'en-GB');
  assert.equal(v('en-EU').ok, false);
  assert.equal(v('es-419').ok, false, "Google doesn't read region numbers");
  assert.equal(v('es-419', 'lang').ok, true, 'but browsers do');
  assert.equal(v('es-LA').kind, 'unlikely');
  assert.equal(v('sr-CS').use, 'sr-RS');
  assert.equal(v('in').use, 'id');
  assert.equal(v('en_GB').use, 'en-GB');
  assert.equal(v('hrv').use, 'hr');
  assert.equal(v('xx').ok, false);
  assert.equal(v('x-default', 'lang').ok, false, 'x-default is only for hreflang');
  assert.equal(v('de-DE-1996').ok, false);
});

test('addresses: file names, home pages, and Vercel’s login', () => {
  assert.equal(m.fileName('https://x.vercel.app/_next/image?url=%2Fimages%2Fsuperior-room.jpg&w=1920&q=75'), 'superior-room.jpg');
  assert.equal(m.fileName('https://storage.googleapis.com/lauris/hotel%20pool.webp'), 'hotel pool.webp');
  assert.equal(m.fileName('data:image/png;base64,AAAA'), 'embedded image');
  for (const p of ['/', '/en', '/de-at/']) assert.equal(m.isHome(p), true, p);
  assert.equal(m.isHome('/en/rooms'), false);
  assert.equal(m.behindLogin({ status: 401, finalUrl: 'https://x-staging.vercel.app/' }), true);
  assert.equal(m.behindLogin({ status: 200, finalUrl: 'https://vercel.com/sso-api?url=x' }), true);
  assert.equal(m.behindLogin({ status: 200, finalUrl: 'https://x-staging.vercel.app/' }), false);
});

test('probing a link: HEAD, or GET where HEAD is refused; no answer is an error', async () => {
  const methods = [];
  const fake = (answers) => async (url, init) => {
    methods.push(init.method);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return { status: a.status, url: a.url ?? url, body: { cancel: async () => {} } };
  };
  assert.deepEqual(await m.probeLink(fake([{ status: 200 }]), 'https://x.hr/a'), { status: 200, finalUrl: 'https://x.hr/a' });
  methods.length = 0;
  assert.deepEqual(await m.probeLink(fake([{ status: 405 }, { status: 200, url: 'https://x.hr/b' }]), 'https://x.hr/a'), { status: 200, finalUrl: 'https://x.hr/b' });
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.deepEqual(await m.probeLink(fake([new TypeError('Failed to fetch')]), 'https://x.hr/a'), { error: 'no answer' });
});

test('Google cuts titles between words, by width', () => {
  const w = (s) => s.length * 10;
  assert.deepEqual(m.cutToWidth('Short title', 580, w), { text: 'Short title', cut: false });
  const long = 'Superior Room with Sea View and Balcony | Bluesun Hotel Elaphusa in Bol';
  const cut = m.cutToWidth(long, 580, w);
  assert.equal(cut.cut, true);
  assert.ok(cut.text.endsWith(' ...') && w(cut.text) <= 580, cut.text);
  assert.ok(long.startsWith(cut.text.slice(0, -4)), 'whole words from the start');
  assert.equal(m.cutToWidth('x'.repeat(100), 100, w).text, `${'x'.repeat(7)}...`);
});

test('the Google preview shows the live address that the canonical names', () => {
  const page = snapshot({
    url: 'https://cresanka-staging.vercel.app/en/rooms/superior',
    environment: 'staging',
    descriptions: [],
    social: { 'og:site_name': 'Cresanka' },
  });
  const p = m.serpPreview(page, m.roughMeasure);
  assert.equal(p.site, 'Cresanka');
  assert.equal(p.crumbs, 'https://www.cresanka.hr › en › rooms › superior');
  assert.deepEqual(p.title, { text: 'Superior room with a sea view | Cresanka', cut: false });
  assert.equal(p.description, null);
});
