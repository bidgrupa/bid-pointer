/**
 * What Google fetches along with the page, for the SEO check: the page again (its status, its
 * X-Robots-Tag header, the HTML before scripts run), robots.txt and the sitemap, the share image,
 * and on staging the page as a stranger gets it. Each part is handed over as it arrives. Files on
 * the page's own site are fetched as the page, whose cookies get past Vercel's login; files on
 * other sites by the background.
 */
import { readHead } from './read';
import { pageFetch } from '../pagefetch';
import { normalizePath } from '../../shared/match';
import {
  absolute,
  failure,
  parseRobots,
  readSitemapXml,
  shareImage,
  sitemapHosts,
  sitemapLists,
  statusLine,
  type Failed,
  type SeoAccess,
  type SeoFetched,
  type SeoNetwork,
  type SeoSitemap,
  type SeoSiteInfo,
  type SeoSnapshot,
} from '../../shared/seo';
import type { Environment } from '../../shared/site';
import type { Msg } from '../../shared/types';

export type Send = <T>(msg: Msg) => Promise<T>;

const MAX_TEXT = 10 * 1024 * 1024;
/** How many files of a sitemap index are read, looking for the page. */
const MAX_SITEMAPS = 15;
const IMAGE_MS = 10_000;

/** What's known about the site when the background can't say. */
export const NO_SITE: SeoSiteInfo = { titleSame: [], descriptionSame: [], pages: 0, sent: {} };

const looksHtml = (type: string, text: string) => /html/i.test(type) || /^\s*(<!doctype html|<html)/i.test(text);

/** The background's answer; nothing at all (a background from an older build) counts as a failure. */
export const ask = <T extends object>(send: Send, msg: Msg): Promise<T | Failed> =>
  send<T | undefined>(msg).then((r) => r ?? { error: 'no answer from the extension' }, failure);

/** A text file: as the page when it's on the page's own site, else through the background. */
async function getText(url: string, send: Send, signal: AbortSignal): Promise<SeoFetched> {
  const target = absolute(url, location.href);
  if (!target || !/^https?:$/.test(target.protocol)) return { error: 'not a web address' };
  if (target.origin !== location.origin) return ask<SeoFetched>(send, { type: 'pointer:seo-fetch', url: target.href });
  try {
    const res = await pageFetch(target.href, { signal, cache: 'no-store', credentials: 'include' });
    const text = res.ok ? await res.text() : '';
    return text.length > MAX_TEXT ? { error: 'larger than 10 MB' } : { status: res.status, type: res.headers.get('content-type') ?? '', text };
  } catch (e) {
    return failure(e);
  }
}

/** The page again, as the server sends it. */
async function readServer(signal: AbortSignal): Promise<NonNullable<SeoNetwork['server']>> {
  const url = location.href.split('#')[0] ?? location.href;
  try {
    const res = await pageFetch(url, { signal, cache: 'no-store', credentials: 'include', redirect: 'follow' });
    const html = /html/i.test(res.headers.get('content-type') ?? '');
    const body = html ? (await res.text()).slice(0, MAX_TEXT) : '';
    if (!html) res.body?.cancel().catch(() => {});
    return {
      status: res.status,
      finalUrl: res.url || url,
      robotsHeader: res.headers.get('x-robots-tag') ?? '',
      head: body ? readHead(new DOMParser().parseFromString(body, 'text/html')) : null,
    };
  } catch (e) {
    return failure(e);
  }
}

async function readRobots(send: Send, signal: AbortSignal): Promise<NonNullable<SeoNetwork['robots']>> {
  const r = await getText(`${location.origin}/robots.txt`, send, signal);
  return 'error' in r ? r : { status: r.status, html: looksHtml(r.type, r.text), text: r.text };
}

/** One sitemap, or an index's sitemaps until the page turns up in one. */
async function readOneSitemap(url: string, wanted: URL[], env: Environment, send: Send, signal: AbortSignal): Promise<SeoSitemap | (Failed & { url: string })> {
  const r = await getText(url, send, signal);
  if ('error' in r) return { ...r, url };
  const file = readSitemapXml(r.text);
  const result: SeoSitemap = { url, status: r.status, html: looksHtml(r.type, r.text), kind: file.kind, found: false, urls: 0, hosts: [], partial: false };
  if (r.status >= 400 || result.html || file.kind === 'unknown') return result;
  if (file.kind === 'urlset') return { ...result, found: sitemapLists(file.locs, wanted, env), urls: file.locs.length, hosts: sitemapHosts(file.locs) };
  let urls = 0;
  const hosts = new Set<string>();
  for (const [i, child] of file.locs.entries()) {
    if (i >= MAX_SITEMAPS) return { ...result, urls, hosts: [...hosts], partial: true };
    const c = await getText(child, send, signal);
    if ('error' in c || c.status >= 400) continue;
    const locs = readSitemapXml(c.text).locs;
    urls += locs.length;
    for (const h of sitemapHosts(locs)) hosts.add(h);
    if (sitemapLists(locs, wanted, env)) return { ...result, found: true, urls, hosts: [...hosts] };
  }
  return { ...result, urls, hosts: [...hosts] };
}

/**
 * The sitemap a live site's robots.txt names (or /sitemap.xml). On staging, robots.txt names the
 * live site's sitemap, so staging's own comes first: it lists the pages this build has.
 */
async function readSitemap(page: SeoSnapshot, robotsText: string | null, send: Send, signal: AbortSignal): Promise<NonNullable<SeoNetwork['sitemap']>> {
  const named = robotsText ? parseRobots(robotsText).sitemaps : [];
  const own = `${location.origin}/sitemap.xml`;
  const candidates = [...new Set(page.environment === 'production' ? [...named, own] : [own, ...named])].slice(0, 2);
  const canonical = page.canonicals[0] ? absolute(page.canonicals[0], page.url) : null;
  const wanted = [new URL(page.url), ...(canonical && /^https?:$/.test(canonical.protocol) ? [canonical] : [])];
  let first: NonNullable<SeoNetwork['sitemap']> | undefined;
  for (const url of candidates) {
    const result = await readOneSitemap(url, wanted, page.environment, send, signal);
    if (!('error' in result) && result.status < 400) return result;
    first ??= result;
  }
  return first ?? { error: 'nothing to read', url: own };
}

/** The share image's size once it loads; one the page may not show (its CSP) is asked about from outside. */
function readShareImage(src: string, send: Send): Promise<NonNullable<SeoNetwork['ogImage']>> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (r: NonNullable<SeoNetwork['ogImage']>) => {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(r);
    };
    const timer = window.setTimeout(() => done({ error: 'took over 10 seconds to load' }), IMAGE_MS);
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () =>
      void ask<SeoAccess>(send, { type: 'pointer:seo-head', url: src }).then((r) =>
        done('error' in r ? r : r.status < 400 ? { w: 0, h: 0 } : { error: `it answers ${statusLine(r.status)}` }),
      );
    img.src = src;
  });
}

/** Fetches every part; `give` gets each as it arrives. Returns a function that drops whatever's still coming. */
export function readNetwork(page: SeoSnapshot, site: string, send: Send, give: (part: Partial<SeoNetwork>) => void): () => void {
  const ac = new AbortController();
  let live = true;
  const hand = (part: Partial<SeoNetwork>) => {
    if (live) give(part);
  };
  void readServer(ac.signal).then((server) => hand({ server }));
  if (page.environment === 'staging') void ask<SeoAccess>(send, { type: 'pointer:seo-access', url: page.url }).then((access) => hand({ access }));
  void (async () => {
    const robots = await readRobots(send, ac.signal);
    hand({ robots });
    const text = 'error' in robots || robots.html || robots.status >= 400 ? null : robots.text;
    hand({ sitemap: await readSitemap(page, text, send, ac.signal) });
  })().catch((e) => hand({ sitemap: { ...failure(e), url: `${location.origin}/sitemap.xml` } }));
  const image = shareImage(page.social);
  if (/^https?:\/\//i.test(image)) void readShareImage(image, send).then((ogImage) => hand({ ogImage }));
  const first = (list: string[]) => list.find((t) => t.trim())?.replace(/\s+/g, ' ').trim() ?? '';
  void ask<SeoSiteInfo>(send, { type: 'pointer:seo-site', site, path: normalizePath(location.pathname), title: first(page.titles), description: first(page.descriptions) }).then((info) =>
    hand({ site: 'error' in info ? NO_SITE : info }),
  );
  return () => {
    live = false;
    ac.abort();
  };
}
