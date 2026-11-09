/**
 * Sitemaps: the addresses in one, and whether the page is among them. Read with patterns rather
 * than an XML parser, which the background's service worker doesn't have.
 */
import { absolute, bareHost, pathKey } from './url';
import type { Environment } from '../site';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? all;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

/** A sitemap (a list of pages) or a sitemap index (a list of sitemaps), and the addresses in it. */
export type SitemapFile = { kind: 'urlset' | 'index' | 'unknown'; locs: string[] };

export function readSitemapXml(xml: string): SitemapFile {
  const kind = /<(?:[\w-]+:)?sitemapindex[\s>]/i.test(xml) ? 'index' : /<(?:[\w-]+:)?urlset[\s>]/i.test(xml) ? 'urlset' : 'unknown';
  const locs: string[] = [];
  for (const m of xml.matchAll(/<(?:[\w-]+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:[\w-]+:)?loc>/gi)) {
    const loc = decodeEntities((m[1] ?? '').trim());
    if (loc) locs.push(loc);
  }
  return { kind, locs };
}

/** Whether the addresses include one of the page's (paths compared; the domain too on a live site). */
export function sitemapLists(locs: string[], pages: URL[], environment: Environment): boolean {
  const key = (u: URL) => (environment === 'production' ? `${bareHost(u.host)}${pathKey(u)}` : pathKey(u));
  const wanted = new Set(pages.map(key));
  return locs.some((loc) => {
    const u = absolute(loc, 'https://page.invalid/');
    return u !== null && wanted.has(key(u));
  });
}

/** The domains the addresses are on, at most five, without www. */
export function sitemapHosts(locs: string[]): string[] {
  const hosts = new Set<string>();
  for (const loc of locs) {
    const u = absolute(loc, 'https://page.invalid/');
    if (u && u.hostname !== 'page.invalid') hosts.add(bareHost(u.host));
    if (hosts.size >= 5) break;
  }
  return [...hosts];
}
