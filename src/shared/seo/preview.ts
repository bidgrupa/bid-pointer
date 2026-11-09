/**
 * How Google may show the page: its title and description cut where Google cuts them. Google cuts
 * by width, not by letters, so text is measured in pixels: the page script measures with a canvas
 * in Google's fonts; tests (and a browser without a canvas) use roughMeasure.
 */
import { absolute, bareHost, safeDecode } from './url';
import type { Measure, SeoSnapshot } from './types';

/** About what Google shows on a computer before it cuts with "...". */
export const TITLE_PX = 580;
export const DESCRIPTION_PX = 920;

/** An average letter's width in Arial at Google's sizes. */
export const roughMeasure: Measure = (text, kind) => text.length * (kind === 'title' ? 10 : 6);

export type Cut = { text: string; cut: boolean };

/** The text as it fits in `max` px: whole words, then " ...", the way Google cuts it. */
export function cutToWidth(text: string, max: number, width: (s: string) => number): Cut {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (width(clean) <= max) return { text: clean, cut: false };
  const words = clean.split(' ');
  // the most whole words that fit with the ellipsis
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(`${words.slice(0, mid).join(' ')} ...`) <= max) lo = mid;
    else hi = mid - 1;
  }
  if (lo > 0) return { text: `${words.slice(0, lo).join(' ')} ...`, cut: true };
  // a single word longer than the line: cut it by letters
  let n = clean.length;
  while (n > 1 && width(`${clean.slice(0, n)}...`) > max) n--;
  return { text: `${clean.slice(0, n)}...`, cut: true };
}

export type SerpPreview = {
  /** The site's name, as Google shows it above the address. */
  site: string;
  /** "https://www.cresanka.hr › en › rooms". */
  crumbs: string;
  /** null when the page has none: Google then makes one up. */
  title: Cut | null;
  description: Cut | null;
};

const firstText = (list: string[]) => list.find((t) => t.trim())?.replace(/\s+/g, ' ').trim() ?? '';

/** The search result, at the address the canonical names (the live one, on staging). */
export function serpPreview(page: SeoSnapshot, measure: Measure): SerpPreview {
  const named = page.canonicals.length === 1 && page.canonicals[0] ? absolute(page.canonicals[0], page.url) : null;
  const u = named && /^https?:$/.test(named.protocol) ? named : new URL(page.url);
  const segments = u.pathname.split('/').filter(Boolean).map(safeDecode);
  const crumbs = [`${u.protocol}//${u.host}`, ...segments.slice(0, 3)].join(' › ') + (segments.length > 3 ? ' › …' : '');
  const title = firstText(page.titles);
  const description = firstText(page.descriptions);
  return {
    site: page.social['og:site_name']?.trim() || bareHost(u.host),
    crumbs,
    title: title ? cutToWidth(title, TITLE_PX, (s) => measure(s, 'title')) : null,
    description: description ? cutToWidth(description, DESCRIPTION_PX, (s) => measure(s, 'description')) : null,
  };
}
