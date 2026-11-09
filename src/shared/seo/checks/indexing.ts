/**
 * Can Google index the page: what it answers, what robots directives say, and whether the tags
 * Google needs come with the HTML or only appear once scripts run. Judged by where the page is:
 * hidden from Google is right on staging and wrong on the live site.
 */
import { robotsDirectives } from '../robots';
import { absolute, bareHost, behindLogin, pathKey, shortUrl, statusLine } from '../url';
import type { Check, SeoHead } from '../types';

export const statusCheck: Check = ({ page, net }) => {
  const s = net.server;
  if (!s) return null;
  const base = { check: 'status', category: 'indexing', scope: 'page', fixIn: 'code' } as const;
  if ('error' in s) return [{ ...base, id: 'status-unknown', severity: 'skip', title: "The page's own answer wasn't checked", detail: s.error }];
  if (page.environment !== 'production' && behindLogin(s))
    return [{ ...base, id: 'status-login', severity: 'skip', title: "The page's own answer wasn't checked", detail: "Vercel's login answered instead of the page" }];
  if (s.status >= 400) {
    const gone = s.status === 404 || s.status === 410;
    return [
      {
        ...base,
        fixIn: gone ? 'cms' : 'code',
        id: 'status-error',
        severity: 'fix',
        title: `The page answers ${statusLine(s.status)}`,
        why: "Google drops pages that answer with an error, so this one won't be found.",
        fix: gone
          ? "If the page should exist, check that it's published in the CMS; if it moved, redirect this address to the new one."
          : "Find out why the server fails here; the deployment's logs on Vercel show the error.",
      },
    ];
  }
  const here = new URL(page.url);
  const final = absolute(s.finalUrl, page.url);
  if (final && (pathKey(final) !== pathKey(here) || bareHost(final.host) !== bareHost(here.host)))
    return [
      {
        ...base,
        id: 'status-redirect',
        severity: 'improve',
        title: 'This address redirects to another',
        detail: `To ${shortUrl(final, here)}`,
        why: 'Google indexes the address it lands on, so links, the sitemap and the canonical should all name that one.',
        fix: 'Link to the final address everywhere, menus and sitemap included.',
      },
    ];
  return [{ ...base, id: 'status-ok', severity: 'pass', title: `The page answers ${statusLine(s.status)}` }];
};

type Source = { where: string; directives: Set<string>; fixIn: 'cms' | 'code' };

export const indexCheck: Check = ({ page, net }) => {
  const s = net.server;
  const env = page.environment;
  if (env === 'local') return [];
  if (!s || (env === 'staging' && !net.access)) return null;
  const base = { check: 'index', category: 'indexing', scope: 'page' } as const;
  const sources: Source[] = page.robots.map((r) => ({ where: `meta ${r.name}: ${r.content}`, directives: robotsDirectives(r.content), fixIn: 'cms' }));
  if (!('error' in s)) {
    if (s.robotsHeader) sources.push({ where: `X-Robots-Tag: ${s.robotsHeader}`, directives: robotsDirectives(s.robotsHeader, true), fixIn: 'code' });
    // a tag in the HTML Google reads first counts, even if a script takes it out later
    for (const r of s.head?.robots ?? [])
      if (!page.robots.some((x) => x.name === r.name && x.content === r.content))
        sources.push({ where: `meta ${r.name}: ${r.content}, before scripts run`, directives: robotsDirectives(r.content), fixIn: 'cms' });
  }
  const saying = (d: string) => sources.filter((x) => x.directives.has(d) || x.directives.has('none'));
  const where = (list: Source[]) => list.map((x) => x.where).join(' · ');
  const noindex = saying('noindex');
  const fromCms = noindex.filter((x) => x.fixIn === 'cms');

  if (env === 'production') {
    if (noindex.length)
      return [
        {
          ...base,
          fixIn: fromCms.length ? 'cms' : 'code',
          id: 'noindex',
          severity: 'fix',
          title: 'Google is told not to index this page',
          detail: where(noindex),
          why: "It won't show up in Google at all. Right for booking steps and thank-you pages, wrong for anything people should find.",
          fix: fromCms.length
            ? "Switch the page's search visibility back on in the CMS (it sets meta robots)."
            : 'Stop sending X-Robots-Tag: noindex for this page (Vercel settings, middleware or next.config headers).',
        },
      ];
    const nofollow = saying('nofollow');
    if (nofollow.length)
      return [
        {
          ...base,
          fixIn: nofollow.some((x) => x.fixIn === 'cms') ? 'cms' : 'code',
          id: 'nofollow',
          severity: 'improve',
          title: "Google is told not to follow this page's links",
          detail: where(nofollow),
          why: 'Pages linked only from here may not be found.',
          fix: 'Drop nofollow from meta robots, or from the X-Robots-Tag header.',
        },
      ];
    return [{ ...base, id: 'indexable', severity: 'pass', title: 'Google may index this page' }];
  }

  // staging: being hidden is right; what matters is whether the live page will be
  if (fromCms.length)
    return [
      {
        ...base,
        fixIn: 'cms',
        id: 'noindex-own',
        severity: 'notice',
        title: 'The page itself asks not to be indexed',
        detail: where(fromCms),
        why: "This comes from the page's own meta robots, not from Vercel: published like this, the live page is hidden from Google too.",
        fix: "If the live page should be found, switch its search visibility on in the CMS.",
      },
    ];
  if (noindex.length) return [{ ...base, id: 'staging-hidden', severity: 'pass', title: 'Staging is hidden from Google', detail: where(noindex) }];
  const a = net.access;
  if (a && 'error' in a) return [{ ...base, id: 'staging-unknown', severity: 'skip', title: "Whether Google can reach staging wasn't checked", detail: a.error }];
  if (a && behindLogin(a)) return [{ ...base, id: 'staging-login', severity: 'pass', title: "Staging is behind Vercel's login, out of Google's reach" }];
  return [
    {
      ...base,
      fixIn: 'code',
      id: 'staging-public',
      severity: 'improve',
      title: 'This staging page is public, and nothing tells Google to skip it',
      why: 'Google could list staging next to the live site, half-finished, and count the two as copies of each other.',
      fix: "Turn on Vercel's deployment protection for previews, or send X-Robots-Tag: noindex from staging.",
    },
  ];
};

const first = (list: string[]) => list.find((t) => t.trim())?.replace(/\s+/g, ' ').trim() ?? '';

/** What the live page has that the server's HTML lacks (added by scripts), and what scripts changed. */
function compareHeads(live: SeoHead, server: SeoHead): { late: string[]; changed: string[] } {
  const late: string[] = [];
  const changed: string[] = [];
  const compare = (label: string, a: string, b: string) => {
    if (a && !b) late.push(label);
    else if (a && b && a !== b) changed.push(label);
  };
  compare('title', first(live.titles), first(server.titles));
  compare('description', first(live.descriptions), first(server.descriptions));
  compare('canonical', live.canonicals[0] ?? '', server.canonicals[0] ?? '');
  if (live.alternates.length && !server.alternates.length) late.push('language versions');
  if (live.robots.length && !server.robots.length) late.push('meta robots');
  return { late, changed };
}

export const renderedCheck: Check = ({ page, net }) => {
  const s = net.server;
  if (!s) return null;
  if ('error' in s || !s.head) return [];
  const base = { check: 'rendered', category: 'indexing', scope: 'page', fixIn: 'code' } as const;
  const { late, changed } = compareHeads(page, s.head);
  if (late.length)
    return [
      {
        ...base,
        id: 'rendered-late',
        severity: 'improve',
        title: `Only added by scripts: ${late.join(', ')}`,
        detail: "Missing from the HTML the server sends",
        why: 'Google reads the HTML first and runs scripts later, sometimes days later, so tags added by scripts can be missed.',
        fix: 'Render them on the server (in Next.js, with next/head in the page).',
      },
    ];
  if (changed.length)
    return [
      {
        ...base,
        id: 'rendered-changed',
        severity: 'notice',
        title: `Scripts change the ${changed.join(', ')}`,
        detail: 'The HTML the server sends says something else',
        why: 'Google may use either version, so what it shows may not be what the page shows.',
        fix: 'Have the server send the final text.',
      },
    ];
  return [{ ...base, id: 'rendered-ok', severity: 'pass', title: 'The tags Google reads come with the HTML' }];
};
