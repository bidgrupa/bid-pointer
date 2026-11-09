/**
 * Can Google find and fetch the page: what robots.txt allows, and whether the sitemap lists it.
 * Both are the site's, fixed in its code.
 */
import { parseRobots, robotsVerdict } from '../robots';
import { bareHost, shortUrl, statusLine } from '../url';
import type { Check } from '../types';

export const robotsCheck: Check = ({ page, net }) => {
  const r = net.robots;
  if (!r) return null;
  const env = page.environment;
  const base = { check: 'robots', category: 'indexing', scope: 'site', fixIn: 'code' } as const;
  if ('error' in r) return [{ ...base, id: 'robots-unknown', severity: 'skip', title: "robots.txt wasn't checked", detail: r.error }];
  if (r.status === 404 || r.status === 410)
    return [{ ...base, id: 'robots-missing', severity: 'notice', title: 'The site has no robots.txt', why: 'Google then crawls everything, which is fine, but robots.txt is also where crawlers learn where the sitemap is.', fix: 'Serve a robots.txt that allows the site and names the sitemap.' }];
  if (r.status >= 500)
    return [{ ...base, id: 'robots-error', severity: env === 'production' ? 'fix' : 'improve', title: `robots.txt answers ${statusLine(r.status)}`, why: 'While robots.txt fails, Google stops crawling the whole site.', fix: 'Find out why it fails; it should answer 200 with plain text.' }];
  if (r.status >= 400)
    return [{ ...base, id: 'robots-refused', severity: 'notice', title: `robots.txt answers ${statusLine(r.status)}`, why: 'Google treats that as having no robots.txt: it crawls everything, and finds no sitemap there.' }];
  if (r.html)
    return [{ ...base, id: 'robots-html', severity: 'improve', title: 'robots.txt is a web page', detail: "It answers with HTML, likely the site's not-found page", why: 'Google finds no rules and no sitemap in it.', fix: 'Serve plain text at /robots.txt (in Next.js, a file in public/ or a route).' }];

  const robots = parseRobots(r.text);
  const here = new URL(page.url);
  const verdict = robotsVerdict(robots, here.pathname + here.search);
  const rule = verdict.rule ? `${verdict.rule.allow ? 'Allow' : 'Disallow'}: ${verdict.rule.path}` : undefined;
  if (!verdict.allowed) {
    if (env !== 'production') return [{ ...base, id: 'robots-staging', severity: 'pass', title: 'robots.txt keeps Google away from this copy', detail: rule }];
    return [{ ...base, id: 'robots-blocked', severity: 'fix', title: 'robots.txt keeps Google away from this page', detail: rule, why: "Google can't read the page, so it can't rank it; at most the bare address turns up, without a description.", fix: 'Remove or narrow that rule in robots.txt.' }];
  }
  if (!robots.sitemaps.length)
    return [{ ...base, id: 'robots-no-sitemap', severity: 'notice', title: "robots.txt doesn't name the sitemap", why: "That's where crawlers look for it; Google also takes it from Search Console.", fix: 'Add a line "Sitemap: https://…/sitemap.xml".' }];
  return [{ ...base, id: 'robots-ok', severity: 'pass', title: 'robots.txt lets Google in', detail: rule }];
};

export const sitemapCheck: Check = ({ page, net }) => {
  const sm = net.sitemap;
  if (!sm) return null;
  const base = { check: 'sitemap', category: 'indexing', scope: 'page', fixIn: 'code' } as const;
  const site = { ...base, scope: 'site' } as const;
  if ('error' in sm) return [{ ...base, id: 'sitemap-unknown', severity: 'skip', title: "The sitemap wasn't checked", detail: `${sm.url}: ${sm.error}` }];
  const where = shortUrl(new URL(sm.url));
  if (sm.status === 404 || sm.status === 410)
    return [{ ...site, id: 'sitemap-missing', severity: 'improve', title: 'The site has no sitemap', detail: `${where} answers ${statusLine(sm.status)}`, why: 'A sitemap lists every page, so Google finds new ones quickly.', fix: "Generate /sitemap.xml from the site's pages, and name it in robots.txt." }];
  if (sm.status >= 400)
    return [{ ...site, id: 'sitemap-error', severity: 'improve', title: `The sitemap answers ${statusLine(sm.status)}`, detail: where, why: "Google can't read the list of pages.", fix: 'Find out why it fails; it should answer 200 with XML.' }];
  if (sm.html || sm.kind === 'unknown')
    return [{ ...site, id: 'sitemap-html', severity: 'improve', title: "The sitemap isn't a sitemap", detail: `${where} answers with ${sm.html ? 'a web page' : 'something else'}`, why: 'Google finds no list of pages in it.', fix: 'Serve an XML sitemap there.' }];
  const here = new URL(page.url);
  if (page.environment === 'production' && sm.hosts.length && !sm.hosts.includes(bareHost(here.host)))
    return [{ ...site, id: 'sitemap-host', severity: 'improve', title: "The sitemap lists another domain's addresses", detail: sm.hosts.join(', '), why: "Google ignores addresses that aren't on the sitemap's own site.", fix: "List the live site's own addresses (often an environment variable left at a staging value)." }];
  if (!sm.found) {
    const looked = `${sm.urls} ${sm.urls === 1 ? 'address' : 'addresses'} in ${where}${sm.partial ? ' (not every file read)' : ''}`;
    return [{ ...base, id: 'sitemap-absent', severity: sm.partial ? 'notice' : 'improve', title: "This page isn't in the sitemap", detail: looked, why: 'Google finds pages faster through the sitemap, and takes the ones in it as the ones that matter.', fix: "Add the page to the sitemap; when it's generated, check the list of pages it comes from." }];
  }
  return [{ ...base, id: 'sitemap-listed', severity: 'pass', title: 'The page is in the sitemap', detail: `${sm.urls} addresses in ${where}` }];
};
