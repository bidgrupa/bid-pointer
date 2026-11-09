/**
 * Where Pointer runs, and how it recognises the sites it's for. Pure functions, unit-tested.
 *
 * Local is a dev server on localhost. Staging is any host on the person's site list, and anything
 * on vercel.app (live sites have their own domain). Everything else is production.
 * Pointer starts by itself on localhost and on the site list (startsByItself). Anywhere else it
 * only shows up when the page's footer credits the agency named in the settings (creditsFooter),
 * or when it's started from the toolbar.
 */

export type Environment = 'staging' | 'production' | 'local';

export function environmentOf(hostname: string, sites: readonly string[] = []): Environment {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  if (host.endsWith('.vercel.app') || onSiteList(host, sites)) return 'staging';
  return 'production';
}

const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** A site-list entry as a host pattern, whatever was pasted: "https://Staging.Example.com/x" → "staging.example.com". */
export function sitePattern(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
}

/**
 * True when the host is on the site list: an entry matches the host exactly, and `*` stands for
 * any run of characters ("*-staging.vercel.app", "*.example.com").
 */
export function onSiteList(hostname: string, sites: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return sites.some((entry) => {
    const pattern = sitePattern(entry);
    return pattern !== '' && new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`).test(host);
  });
}

/** True where Pointer starts without looking at the page: localhost and the site list. */
export function startsByItself(hostname: string, sites: readonly string[]): boolean {
  return environmentOf(hostname) === 'local' || onSiteList(hostname, sites);
}

export const ENVIRONMENT_LABEL: Record<Environment, string> = {
  staging: 'Staging',
  production: 'Production',
  local: 'Local',
};

/** What the detector reads from a page's footer(s). */
export type FooterSample = {
  /** All footer text, whitespace collapsed. */
  text: string;
  /** Every link target in the footer. */
  links: string[];
  /** Texts of small elements (a, span, b, …) in the footer, for logos like <span>bid</span>. */
  shortTexts: string[];
};

/** The domains in the footer-credit setting: "bid.agency, bid.hr" → ["bid.agency", "bid.hr"]. */
export function creditDomains(credit: string): string[] {
  return credit
    .split(/[\s,;]+/)
    .map(sitePattern)
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
}

/**
 * True when a footer credits the agency, in any of the ways agencies do it: a link to one of its
 * domains, the phrase "powered by <name>", or an element whose whole text is the name or a domain
 * ("bid", "bid.", "bid.hr"). The name is the first domain's first label. A sentence that merely
 * contains the word ("place a bid") doesn't count.
 */
export function creditsFooter(sample: FooterSample, credit: string): boolean {
  const domains = creditDomains(credit);
  const name = domains[0]?.split('.')[0];
  if (!name) return false;
  const linksToAgency = sample.links.some((href) => {
    try {
      const host = new URL(href).hostname.toLowerCase();
      return domains.some((d) => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  });
  if (linksToAgency) return true;
  if (new RegExp(`powered\\s+by\\s*:?\\s*${escapeRe(name)}\\b`, 'i').test(sample.text)) return true;
  return sample.shortTexts.some((t) => {
    const text = t.trim().toLowerCase();
    return text === name || text === `${name}.` || domains.includes(text);
  });
}

/**
 * Names to match against ClickUp projects for a live site's domain, most likely first:
 * "www.bluesunhotels.com" → ["bluesunhotels"], "booking.manora-losinj.hr" → ["manora-losinj", "booking"].
 */
export function domainCandidates(hostname: string): string[] {
  const labels = hostname
    .toLowerCase()
    .split('.')
    .filter((l) => l && l !== 'www');
  if (labels.length < 2) return [];
  labels.pop(); // top-level domain
  if (labels.length > 1 && ['co', 'com', 'org', 'net'].includes(labels[labels.length - 1] ?? '')) labels.pop(); // co.uk and friends
  return labels.reverse();
}
