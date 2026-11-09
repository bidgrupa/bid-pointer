/**
 * Check links, on request: whether each link to this site (and from staging, to the live site its
 * canonical names) answers, and whether it goes through a redirect. Each address once, a few at a
 * time; this site's as the page (its cookies), the live site's from the background.
 */
import { pageFetch } from '../pagefetch';
import { ask, type Send } from './net';
import { absolute, bareHost, pathKey, probeLink, type Failed, type SeoAccess, type SeoLinkResult, type SeoLinks, type SeoSnapshot } from '../../shared/seo';

/** At most this many addresses are asked about, a few at a time. */
const MAX_LINKS = 200;
const AT_ONCE = 4;

type Target = { url: string; ref: string; name: string };

/** The addresses Check links asks about: links to this site, or to the live site the canonical names. */
export function linksToCheck(page: SeoSnapshot): Target[] {
  const here = new URL(page.url);
  const hosts = new Set([bareHost(here.host)]);
  const named = page.canonicals[0] ? absolute(page.canonicals[0], page.url) : null;
  if (named && /^https?:$/.test(named.protocol)) hosts.add(bareHost(named.host));
  const seen = new Map<string, Target>();
  for (const l of page.links) {
    const u = absolute(l.href, page.url);
    if (!u || !/^https?:$/.test(u.protocol) || !hosts.has(bareHost(u.host))) continue;
    u.hash = '';
    if (!seen.has(u.href)) seen.set(u.href, { url: u.href, ref: l.ref, name: l.name });
  }
  return [...seen.values()].slice(0, MAX_LINKS);
}

export async function checkLinks(page: SeoSnapshot, send: Send, progress: (done: number, total: number) => void, stopped: () => boolean): Promise<SeoLinks> {
  const targets = linksToCheck(page);
  const broken: SeoLinkResult[] = [];
  const redirects: SeoLinkResult[] = [];
  let next = 0;
  let done = 0;
  const one = async (t: Target) => {
    const own = new URL(t.url).origin === location.origin;
    const r: SeoAccess | Failed = own ? await probeLink(pageFetch, t.url) : await ask<SeoAccess>(send, { type: 'pointer:seo-head', url: t.url });
    const base = { href: t.url, ref: t.ref, name: t.name };
    if ('error' in r) broken.push({ ...base, status: 0, error: r.error });
    else if (r.status >= 400) broken.push({ ...base, status: r.status });
    else {
      const from = new URL(t.url);
      const to = absolute(r.finalUrl, t.url);
      if (to && (pathKey(to) !== pathKey(from) || bareHost(to.host) !== bareHost(from.host))) redirects.push({ ...base, status: r.status, finalUrl: to.href });
    }
    progress(++done, targets.length);
  };
  const worker = async () => {
    while (next < targets.length && !stopped()) await one(targets[next++] as Target);
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, targets.length) }, worker));
  return { checked: done, broken, redirects };
}
