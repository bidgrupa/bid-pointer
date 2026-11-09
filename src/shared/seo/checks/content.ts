/**
 * The page's content as Google reads it: its headings (one H1 naming the page, levels in order)
 * and its links (text that says where they go and, once checked, whether they work).
 */
import { absolute, shortUrl, statusLine } from '../url';
import type { Check, SeoFinding, SeoHeading, SeoItem } from '../types';

/** How many headings the outline shows, and how many links a finding lists. */
const OUTLINE = 60;
const SHOWN = 30;

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const headingItem = (h: SeoHeading): SeoItem => ({ label: h.text ? short(h.text) : '(empty)', level: h.level, ref: h.ref, ...(h.visible ? {} : { note: 'hidden' }) });
const listed = (items: SeoItem[]) => ({ items: items.slice(0, SHOWN), ...(items.length > SHOWN ? { more: items.length - SHOWN } : {}) });

export const h1Check: Check = ({ page }) => {
  const base = { check: 'h1', category: 'content', scope: 'page', fixIn: 'code' } as const;
  const h1s = page.headings.filter((h) => h.level === 1);
  if (!h1s.length)
    return [{ ...base, id: 'h1-missing', severity: 'improve', title: 'No H1 heading', why: "The H1 is the page's main heading; Google reads it as what the page is about.", fix: "Make the page's main title (usually the hero's) an <h1>." }];
  const named = h1s.filter((h) => h.text);
  if (!named.length)
    return [{ ...base, id: 'h1-empty', severity: 'improve', title: 'The H1 is empty', items: h1s.map(headingItem), why: 'An empty main heading says nothing about the page.', fix: "Put the page's title in it." }];
  if (h1s.length > 1)
    return [{ ...base, id: 'h1-several', severity: 'notice', title: `${h1s.length} H1 headings`, items: h1s.map(headingItem), why: 'One H1 naming the page is clearest; with more, Google has to guess which one matters.', fix: "Keep one H1 for the page's title and make the others H2." }];
  const h = named[0] as SeoHeading;
  if (!h.visible)
    return [{ ...base, id: 'h1-hidden', severity: 'notice', title: 'The H1 is hidden', items: [headingItem(h)], why: 'The page shows no main heading, and Google gives hidden text less weight.', fix: 'Show the H1, or make the visible title the H1.' }];
  return [{ ...base, id: 'h1-ok', severity: 'pass', title: `One H1: “${short(h.text, 60)}”`, items: [headingItem(h)] }];
};

export const headingsCheck: Check = ({ page }) => {
  const base = { check: 'headings', category: 'content', scope: 'page', fixIn: 'code' } as const;
  const hs = page.headings;
  if (!hs.length) return [{ ...base, id: 'headings-none', severity: 'notice', title: 'No headings', why: 'Headings show Google how the page is organised.', fix: 'Give the sections headings (H2, H3).' }];
  const outline = { items: hs.slice(0, OUTLINE).map(headingItem), ...(hs.length > OUTLINE ? { more: hs.length - OUTLINE } : {}) };
  const skips = new Set<string>();
  hs.forEach((h, i) => {
    const prev = hs[i - 1];
    if (prev && h.level > prev.level + 1) skips.add(`H${prev.level} → H${h.level}`);
  });
  const empty = hs.filter((h) => !h.text).length;
  if (skips.size || empty)
    return [
      {
        ...base,
        id: 'headings-order',
        severity: 'notice',
        title: skips.size ? 'Heading levels skip a step' : `${empty} empty ${empty === 1 ? 'heading' : 'headings'}`,
        detail: [...skips, empty ? `${empty} empty` : ''].filter(Boolean).join(' · '),
        ...outline,
        why: 'Headings in order (H2 under the H1, H3 under an H2) show Google how the page is organised.',
        fix: 'Pick heading levels by their place in the page, not by size; size them with CSS.',
      },
    ];
  return [{ ...base, id: 'headings-ok', severity: 'pass', title: `${hs.length} ${hs.length === 1 ? 'heading' : 'headings'}, in order`, ...outline }];
};

/** A link's address as the panel and the task show it. */
function showHref(href: string, pageUrl: string): string {
  const u = absolute(href, pageUrl);
  return u && /^https?:$/.test(u.protocol) ? shortUrl(u, new URL(pageUrl)) : href;
}

export const linksCheck: Check = ({ page }) => {
  const base = { check: 'links', category: 'content', scope: 'page', fixIn: 'code' } as const;
  if (!page.links.length) return [{ ...base, id: 'links-none', severity: 'pass', title: 'No links on the page' }];
  const nameless = page.links.filter((l) => !l.name);
  if (nameless.length)
    return [
      {
        ...base,
        id: 'links-nameless',
        severity: 'improve',
        title: `${nameless.length} ${nameless.length === 1 ? 'link has' : 'links have'} no text`,
        ...listed(nameless.map((l) => ({ label: showHref(l.href, page.url), code: true, ref: l.ref, ...(l.visible ? {} : { note: 'hidden right now' }) }))),
        why: "Google reads a link's text to learn what the page it leads to is about, and screen readers read it out. Icon-only links say nothing.",
        fix: 'Give icon links an aria-label (“Instagram”, “Close menu”), or text.',
      },
    ];
  return [{ ...base, id: 'links-ok', severity: 'pass', title: `${page.links.length} links, all with text` }];
};

/** Broken links and redirects, once someone has pressed Check links. */
export const linkStatusCheck: Check = ({ page, net }) => {
  const l = net.links;
  if (!l) return [];
  const base = { check: 'link-status', category: 'content', scope: 'page', fixIn: 'cms' } as const;
  const out: SeoFinding[] = [];
  if (l.broken.length)
    out.push({
      ...base,
      id: 'links-broken',
      severity: 'fix',
      title: `${l.broken.length} broken ${l.broken.length === 1 ? 'link' : 'links'}`,
      ...listed(l.broken.map((b) => ({ label: showHref(b.href, page.url), code: true, ref: b.ref, note: [b.error ?? statusLine(b.status), b.name ? `“${short(b.name, 40)}”` : ''].filter(Boolean).join(' · ') }))),
      why: 'People land on an error page, and Google spends its visit on it.',
      fix: 'Point each link at a page that exists: in the CMS, or in the template for menus and the footer.',
    });
  if (l.redirects.length)
    out.push({
      ...base,
      id: 'links-redirect',
      severity: 'notice',
      title: `${l.redirects.length} ${l.redirects.length === 1 ? 'link goes' : 'links go'} through a redirect`,
      ...listed(l.redirects.map((r) => ({ label: showHref(r.href, page.url), code: true, ref: r.ref, note: `→ ${showHref(r.finalUrl ?? '', page.url)}` }))),
      why: 'Each redirect is an extra hop, for people and for Google.',
      fix: 'Link straight to the final address.',
    });
  return out.length ? out : [{ ...base, id: 'links-work', severity: 'pass', title: `All ${l.checked} links to this site work` }];
};
