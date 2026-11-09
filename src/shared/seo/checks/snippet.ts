/**
 * The Google snippet: the title and description Google shows, how much of them fits, and whether
 * other pages of the site checked before use the same ones (a site's default description, which
 * shows wherever the CMS has none, is the usual cause).
 */
import { DESCRIPTION_PX, TITLE_PX } from '../preview';
import type { Check, SeoFinding } from '../types';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const firstText = (list: string[]) => clean(list.find((t) => t.trim()) ?? '');

export const titleCheck: Check = ({ page, measure }) => {
  const base = { check: 'title', category: 'snippet', scope: 'page', fixIn: 'cms' } as const;
  const text = firstText(page.titles);
  if (!text)
    return [{ ...base, id: 'title-missing', severity: 'fix', title: 'The page has no title', why: "The title is the headline of the page's Google result; without one, Google makes one up.", fix: "Fill in the page's meta title in the CMS." }];
  const out: SeoFinding[] = [];
  if (page.titles.length > 1)
    out.push({ ...base, fixIn: 'code', id: 'title-several', severity: 'improve', title: `${page.titles.length} title tags`, items: page.titles.map((t) => ({ label: clean(t) || '(empty)' })), why: 'Browsers and Google use the first; the rest is left over from the template.', fix: 'Output one <title>.' });
  const px = measure(text, 'title');
  if (px > TITLE_PX)
    out.push({ ...base, id: 'title-long', severity: 'improve', title: 'The title may be cut off in Google', detail: `${text.length} characters, about ${Math.round(px)} px of the ${TITLE_PX} Google shows`, why: "Words past the cut are lost, often the site's name at the end.", fix: 'Keep it to about 55 characters, with the words that matter first.' });
  else if (text.length < 20)
    out.push({ ...base, id: 'title-short', severity: 'notice', title: `The title is short (${text.length} characters)`, detail: `“${text}”`, why: "There's room for about 55: what the page is about, then the site's name.", fix: "Say what's on the page, then the site's name." });
  return out.length ? out : [{ ...base, id: 'title-ok', severity: 'pass', title: `The title fits in Google (${text.length} characters)` }];
};

export const descriptionCheck: Check = ({ page, measure }) => {
  const base = { check: 'description', category: 'snippet', scope: 'page', fixIn: 'cms' } as const;
  const text = firstText(page.descriptions);
  if (!text)
    return [{ ...base, id: 'description-missing', severity: 'improve', title: 'No meta description', why: "Google then picks a snippet from the page's text, which may not make anyone click.", fix: "Write one in the page's SEO settings in the CMS: about 150 characters on what the page offers." }];
  const out: SeoFinding[] = [];
  if (page.descriptions.length > 1)
    out.push({ ...base, fixIn: 'code', id: 'description-several', severity: 'improve', title: `${page.descriptions.length} meta descriptions`, items: page.descriptions.map((d) => ({ label: clean(d) || '(empty)' })), why: 'Google may pick either one, or neither.', fix: 'Output one description tag.' });
  const px = measure(text, 'description');
  if (px > DESCRIPTION_PX)
    out.push({ ...base, id: 'description-long', severity: 'improve', title: 'The description may be cut off in Google', detail: `${text.length} characters; Google shows about 155`, why: 'What comes after the cut is lost, often the part that makes people click.', fix: 'Keep it to about 150 characters.' });
  else if (text.length < 70)
    out.push({ ...base, id: 'description-short', severity: 'notice', title: `The description is short (${text.length} characters)`, why: "There's room for about 150: what the page offers, and why it's worth a click.", fix: 'Add a sentence on what makes the page worth a visit.' });
  return out.length ? out : [{ ...base, id: 'description-ok', severity: 'pass', title: `The description fits in Google (${text.length} characters)` }];
};

/** The same title or description as other pages of the site that were checked before. */
const sameAs =
  (kind: 'title' | 'description'): Check =>
  ({ page, net }) => {
    const site = net.site;
    if (!site) return null;
    // nothing to compare with yet; and a missing one is the other checks' business
    if (!site.pages || !firstText(kind === 'title' ? page.titles : page.descriptions)) return [];
    const base = { check: `${kind}-same`, category: 'snippet', scope: 'page', fixIn: 'cms' } as const;
    const others = `${site.pages} other ${site.pages === 1 ? 'page' : 'pages'} checked on this site`;
    const paths = kind === 'title' ? site.titleSame : site.descriptionSame;
    if (!paths.length) return [{ ...base, id: `${kind}-unique`, severity: 'pass', title: `No other page checked has this ${kind}`, detail: `Of the ${others}` }];
    return [
      {
        ...base,
        id: `${kind}-same`,
        severity: 'improve',
        title: `${paths.length} other ${paths.length === 1 ? 'page has' : 'pages have'} the same ${kind}`,
        detail: `Of the ${others}`,
        items: paths.slice(0, 10).map((p) => ({ label: p, code: true })),
        ...(paths.length > 10 ? { more: paths.length - 10 } : {}),
        why:
          kind === 'description'
            ? 'Google may show the same snippet for all of them, or ignore it. Where the CMS has no description, sites often fall back to one default, so every such page gets it.'
            : "Google can't tell the pages apart in its results.",
        fix: `Give this page its own ${kind} in the CMS.`,
      },
    ];
  };

export const titleSameCheck = sameAs('title');
export const descriptionSameCheck = sameAs('description');
