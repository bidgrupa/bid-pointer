/**
 * The canonical tag: the address a page names as its own. On staging it rightly names the live
 * address, so only the path is compared there; on a live site the domain counts too.
 */
import { languageName } from '../lang';
import { absolute, bareHost, isHome, pathKey, sameDoc, shortUrl } from '../url';
import type { Check, SeoFinding, SeoSnapshot } from '../types';

const base = { check: 'canonical', category: 'indexing', scope: 'page' } as const;

/** The language version in the page's hreflang list that `target` is, when it's another language. */
function otherLanguage(page: SeoSnapshot, target: URL): string | null {
  const here = new URL(page.url);
  const own = page.alternates.find((a) => {
    const u = a.href ? absolute(a.href, page.url) : null;
    return u !== null && a.lang.toLowerCase() !== 'x-default' && sameDoc(u, here, page.environment);
  });
  const ownLang = (own?.lang ?? page.htmlLang ?? '').toLowerCase();
  const version = page.alternates.find((a) => {
    const u = a.href ? absolute(a.href, page.url) : null;
    const lang = a.lang.toLowerCase();
    return u !== null && lang !== 'x-default' && lang !== ownLang && sameDoc(u, target, page.environment);
  });
  return version ? version.lang : null;
}

/** Where a canonical that names this very page is still off: another domain, http, or a relative address. */
function sameDocProblems(page: SeoSnapshot, raw: string, target: URL): SeoFinding | null {
  const here = new URL(page.url);
  if (page.environment === 'production') {
    if (bareHost(target.host) !== bareHost(here.host))
      return { ...base, fixIn: 'code', id: 'canonical-domain', severity: 'improve', title: 'The canonical names another domain', detail: shortUrl(target), why: "Google will treat this page as a copy of that domain's.", fix: "Point the canonical at this site's own address." };
    if (target.host !== here.host)
      return { ...base, fixIn: 'code', id: 'canonical-www', severity: 'improve', title: `The canonical uses ${target.host}, the page is on ${here.host}`, why: 'With and without www look like two sites to Google until one redirects to the other.', fix: 'Redirect one to the other, and use that one in the canonical.' };
    if (target.protocol !== here.protocol)
      return { ...base, fixIn: 'code', id: 'canonical-http', severity: 'improve', title: `The canonical uses ${target.protocol.replace(':', '')}`, detail: shortUrl(target), why: 'It points Google at the insecure copy of the page.', fix: 'Use the https address.' };
  }
  if (!/^https?:\/\//i.test(raw.trim()))
    return { ...base, fixIn: 'code', id: 'canonical-relative', severity: 'improve', title: 'The canonical address is relative', detail: raw.trim(), why: 'Google asks for the full address; a relative one breaks on copies of the page served elsewhere.', fix: 'Use the full address, with https:// and the domain.' };
  return null;
}

export const canonicalCheck: Check = ({ page }) => {
  const list = page.canonicals;
  if (!list.length)
    return [{ ...base, fixIn: 'code', id: 'canonical-missing', severity: 'improve', title: 'No canonical tag', why: "It tells Google which address is the page's own, so copies with ?tracking=… or a trailing slash don't compete with it.", fix: 'Have the template output <link rel="canonical"> with the page\'s address.' }];
  if (list.length > 1)
    return [{ ...base, fixIn: 'code', id: 'canonical-several', severity: 'fix', title: `${list.length} canonical tags`, items: list.map((h) => ({ label: h || '(no address)', code: true })), why: 'With more than one, Google may ignore them all.', fix: 'Output exactly one canonical tag.' }];
  const raw = list[0] ?? null;
  if (!raw?.trim())
    return [{ ...base, fixIn: 'cms', id: 'canonical-empty', severity: 'fix', title: 'The canonical tag has no address', detail: '<link rel="canonical"> without an href', why: 'Google ignores it, so the page has no canonical at all.', fix: "Fill in the page's canonical address in the CMS, or have the template leave the tag out when it's empty." }];
  const target = absolute(raw, page.url);
  if (!target || !/^https?:$/.test(target.protocol))
    return [{ ...base, fixIn: 'cms', id: 'canonical-invalid', severity: 'fix', title: "The canonical isn't a web address", detail: raw, why: 'Google ignores it.', fix: "Fill in the page's full address." }];

  const here = new URL(page.url);
  // another path is another page; the same path on another domain is dealt with below
  if (pathKey(target) !== pathKey(here)) {
    const language = otherLanguage(page, target);
    if (language)
      return [{ ...base, fixIn: 'code', id: 'canonical-language', severity: 'fix', title: `The canonical points to the ${languageName(language)} version`, detail: shortUrl(target, here), why: `Google then shows the ${languageName(language)} page instead of this one, even to people searching in this page's language.`, fix: 'Each language version names itself as canonical; hreflang connects them.' }];
    if (isHome(target.pathname) && !isHome(here.pathname))
      return [{ ...base, fixIn: 'cms', id: 'canonical-home', severity: 'fix', title: 'The canonical points to the home page', detail: shortUrl(target, here), why: 'Google treats this page as a copy of the home page and leaves it out of its results.', fix: "Set this page's own address as its canonical (in the CMS, or the template's default)." }];
    return [{ ...base, fixIn: 'cms', id: 'canonical-other', severity: 'notice', title: 'The canonical points to another page', detail: shortUrl(target, here), why: 'Google shows that page instead of this one. Right for copies and filtered lists, wrong for a page of its own.', fix: 'If this page stands on its own, point its canonical at its own address.' }];
  }
  const problem = sameDocProblems(page, raw, target);
  if (problem) return [problem];
  const live = page.environment !== 'production' && bareHost(target.host) !== bareHost(here.host);
  return [{ ...base, id: 'canonical-ok', severity: 'pass', title: live ? 'The canonical names the live address of this page' : 'The canonical points to this page', detail: shortUrl(target) }];
};
