/**
 * Reading a page for the SEO check: its head (from the live page, and from the HTML the server
 * sends) and the parts of its body Google looks at: headings, images and links. Elements get ids
 * (refs) so the panel can show them on the page; the snapshot itself is plain data.
 */
import { findBlock } from '../detect';
import type { Environment } from '../../shared/site';
import type { SeoHead, SeoHeading, SeoImage, SeoLink, SeoSnapshot } from '../../shared/seo';

/** At most this many of each are read, so a huge page can't stall the check. */
const MAX_HEADINGS = 300;
const MAX_IMAGES = 400;
const MAX_LINKS = 1500;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const rel = (el: Element) => (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);

export function readHead(doc: Document): SeoHead {
  const metas = (name: string) => Array.from(doc.querySelectorAll(`meta[name="${name}" i]`));
  const links = Array.from(doc.querySelectorAll('link[rel]'));
  const social: Record<string, string> = {};
  for (const meta of Array.from(doc.querySelectorAll('meta[property], meta[name]'))) {
    const key = (meta.getAttribute('property') || meta.getAttribute('name') || '').toLowerCase();
    if ((key.startsWith('og:') || key.startsWith('twitter:')) && !(key in social)) social[key] = meta.getAttribute('content') ?? '';
  }
  return {
    titles: Array.from(doc.querySelectorAll('title'))
      .filter((t) => !t.closest('svg'))
      .map((t) => clean(t.textContent)),
    descriptions: metas('description').map((m) => m.getAttribute('content') ?? ''),
    robots: [...metas('robots'), ...metas('googlebot')].map((m) => ({ name: (m.getAttribute('name') ?? '').toLowerCase(), content: m.getAttribute('content') ?? '' })),
    viewport: metas('viewport')[0]?.getAttribute('content') ?? null,
    canonicals: links.filter((l) => rel(l).includes('canonical')).map((l) => l.getAttribute('href')),
    alternates: links.filter((l) => rel(l).includes('alternate') && l.hasAttribute('hreflang')).map((l) => ({ lang: l.getAttribute('hreflang') ?? '', href: l.getAttribute('href') })),
    social,
    jsonld: Array.from(doc.querySelectorAll('script[type="application/ld+json" i]')).map((s) => s.textContent ?? ''),
    htmlLang: doc.documentElement.getAttribute('lang'),
    favicon: links.some((l) => rel(l).some((t) => t === 'icon' || t === 'apple-touch-icon')),
  };
}

const laidOut = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};

/** What a link says to Google and screen readers: aria-label, aria-labelledby, its text, an image's alt, a title. */
function linkName(a: Element): string {
  const label = clean(a.getAttribute('aria-label'));
  if (label) return label;
  const by = (a.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const named = clean(by.map((id) => a.ownerDocument.getElementById(id)?.textContent ?? '').join(' '));
  if (named) return named;
  const text = clean(a.textContent);
  if (text) return text;
  const alt = clean(Array.from(a.querySelectorAll('img[alt]'), (img) => img.getAttribute('alt')).join(' '));
  return alt || clean(a.querySelector('svg title')?.textContent) || clean(a.getAttribute('title'));
}

function readImage(img: HTMLImageElement, ref: string): SeoImage {
  const r = img.getBoundingClientRect();
  return {
    ref,
    src: img.currentSrc || img.src || img.getAttribute('src') || '',
    alt: img.getAttribute('alt'),
    w: Math.round(r.width),
    h: Math.round(r.height),
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
    decorative: Boolean(img.closest('[aria-hidden="true"]')) || /^(presentation|none)$/i.test(img.getAttribute('role') ?? ''),
    block: findBlock(img)?.info.name ?? null,
  };
}

/** The live page, read now. `refs` maps each heading's, image's and link's id to the element. */
export function readPage(environment: Environment): { snapshot: SeoSnapshot; refs: Map<string, Element> } {
  const refs = new Map<string, Element>();
  const ref = (prefix: string, el: Element) => {
    const id = `${prefix}${refs.size}`;
    refs.set(id, el);
    return id;
  };
  const headings: SeoHeading[] = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .slice(0, MAX_HEADINGS)
    .map((h) => ({ ref: ref('h', h), level: Number(h.tagName[1]), text: clean(h.textContent).slice(0, 200), visible: laidOut(h) }));
  const images = Array.from(document.images)
    .slice(0, MAX_IMAGES)
    .map((img) => readImage(img, ref('i', img)));
  const links: SeoLink[] = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .slice(0, MAX_LINKS)
    .map((a) => ({ ref: ref('a', a), href: a.href, name: linkName(a), visible: laidOut(a) }));
  return {
    snapshot: {
      ...readHead(document),
      url: location.href,
      environment,
      microdata: document.querySelectorAll('[itemscope]:not([itemprop])').length,
      headings,
      images,
      links,
    },
    refs,
  };
}
