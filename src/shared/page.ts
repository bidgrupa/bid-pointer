import { domainCandidates, environmentOf } from './site';
import type { PageInfo } from './types';

/**
 * The project name in a Vercel host. The team's hosts look like:
 *   cresanka-staging.vercel.app                   (staging alias)
 *   pages-bluesun-bid.vercel.app                  (production alias)
 *   pages-bluesun-git-staging-bid.vercel.app      (branch preview)
 *   pages-bluesun-a1b2c3d4e-bid.vercel.app        (deployment hash)
 * and any other vercel.app site is just `<project>.vercel.app`. Branch and `-staging` are
 * dropped so every host of a project shares one name. Returns the possible names, most
 * specific first: a 9-char tail is only *maybe* a hash ("pages-maslinica" also ends in 9
 * chars), so both are returned.
 */
export function slugCandidates(host: string): string[] {
  const m = host.toLowerCase().match(/^(.+?)(-bid)?\.vercel\.app$/);
  if (!m || !m[1]) return [];
  let base = m[1];
  const gitIdx = base.indexOf('-git-');
  if (gitIdx > 0) base = base.slice(0, gitIdx);
  base = base.replace(/(.)-staging$/, '$1');
  const out = [base];
  // deployment hashes only appear in team-suffixed hosts
  const hash = m[2] ? base.match(/^(.+)-[a-z0-9]{9}$/) : null;
  if (hash && hash[1]) out.push(hash[1]);
  return out;
}

/** `sites` is the person's site list, whose hosts count as staging. */
export function pageInfo(loc: Pick<Location, 'href' | 'host' | 'hostname' | 'pathname' | 'search'>, title: string, sites: readonly string[] = []): PageInfo {
  const environment = environmentOf(loc.hostname, sites);
  const staging = slugCandidates(loc.hostname);
  const first = staging[0];
  // a live site is remembered and labelled by its domain, without "www."
  const site = loc.host.replace(/^www\./i, '');
  return {
    url: loc.href,
    host: loc.host,
    path: loc.pathname + loc.search,
    title,
    environment,
    projectKey: first ?? site,
    repoLabel: first ?? site,
    slugCandidates: staging.length ? staging : environment === 'production' ? domainCandidates(loc.hostname) : [],
  };
}

/**
 * Which page a page task belongs to: host and path, without query or hash, so tracking
 * parameters don't split one page's notes. Branch previews are separate pages on purpose.
 */
export function pageKeyOf(loc: Pick<Location, 'host' | 'pathname'>): string {
  return `${loc.host.toLowerCase()}${loc.pathname.replace(/\/+$/, '') || '/'}`;
}

export function browserLabel(ua: string): string {
  const edge = ua.match(/Edg\/(\d+)/);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = ua.match(/Chrome\/(\d+)/);
  if (chrome) return `Chrome ${chrome[1]}`;
  const firefox = ua.match(/Firefox\/(\d+)/);
  if (firefox) return `Firefox ${firefox[1]}`;
  // Chrome's and Edge's agents say Safari too, so this comes after them
  const safari = ua.match(/Version\/(\d+)[\d.]* .*Safari\//);
  if (safari) return `Safari ${safari[1]}`;
  return 'Browser';
}
