/**
 * robots.txt and robots directives, read the way Google reads them (RFC 9309): the group for
 * Googlebot if there is one, else the one for every crawler; the longest matching rule wins, and
 * Allow wins a tie. Paths may use * and an ending $.
 */
import { safeDecode } from './url';

export type RobotsRule = { allow: boolean; path: string };
export type Robots = { groups: { agents: string[]; rules: RobotsRule[] }[]; sitemaps: string[] };

export function parseRobots(text: string): Robots {
  const robots: Robots = { groups: [], sitemaps: [] };
  let group: Robots['groups'][number] | null = null;
  // consecutive user-agent lines share one group; one after a rule starts the next
  let naming = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = raw.replace(/#.*/, '').match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? '';
    if (key === 'user-agent') {
      if (!group || !naming) robots.groups.push((group = { agents: [], rules: [] }));
      group.agents.push(value.toLowerCase());
      naming = true;
    } else if (key === 'allow' || key === 'disallow') {
      naming = false;
      group?.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'sitemap' && value) {
      robots.sitemaps.push(value);
    }
  }
  return robots;
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp(`^${body.split('*').map(escapeRe).join('.*')}${anchored ? '$' : ''}`).test(path);
}

/** Whether a crawler may fetch `path` (path and query), and the rule that decided it. */
export function robotsVerdict(robots: Robots, path: string, agent = 'googlebot'): { allowed: boolean; rule: RobotsRule | null } {
  const own = robots.groups.filter((g) => g.agents.includes(agent));
  const rules = (own.length ? own : robots.groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  const target = safeDecode(path);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    // "Disallow:" with no path allows everything, so it never decides anything
    if (!rule.path || !ruleMatches(safeDecode(rule.path), target)) continue;
    const longer = !best || rule.path.length > best.path.length;
    const allowWinsTie = best !== null && rule.path.length === best.path.length && rule.allow && !best.allow;
    if (longer || allowWinsTie) best = rule;
  }
  return { allowed: !best || best.allow, rule: best };
}

/** Directives that take a value after a colon, so "max-snippet: 50" isn't read as a crawler's name. */
const WITH_VALUE = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);

/**
 * The directives in a meta robots tag, or an X-Robots-Tag header, that apply to Googlebot. A header
 * can name crawlers ("otherbot: noindex"); what follows a name applies to that crawler only.
 */
export function robotsDirectives(value: string, header = false): Set<string> {
  const found = new Set<string>();
  let forGoogle = true;
  for (const part of value.split(',')) {
    let token = part.trim().toLowerCase();
    const named = header ? token.match(/^([a-z][\w-]*)\s*:\s*(.*)$/) : null;
    if (named && !WITH_VALUE.has(named[1] ?? '')) {
      forGoogle = named[1] === 'googlebot';
      token = (named[2] ?? '').trim();
    }
    if (forGoogle && token) found.add(token.split(':')[0]?.trim() ?? token);
  }
  return found;
}
