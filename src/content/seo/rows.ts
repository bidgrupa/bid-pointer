/**
 * Markup for one finding in the SEO panel: a row with its tick, title and tags, and folded under
 * it what it found (images with their Show button, a heading outline, a share preview), why it
 * matters and how to fix it. No inline styles: a strict site CSP would drop them.
 */
import { esc, ICONS } from '../view';
import { isProblem, type SeoFinding, type SeoItem, type SeoSent } from '../../shared/seo';

export const SEO_ICONS = {
  chevron:
    '<svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.75 6 6.25l4.5-4.5"/></svg>',
  refresh:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71"/><path d="M13.25 2.75v3h-3"/></svg>',
  dash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4.5 8h7"/></svg>',
} as const;

/** How a row is shown: ticked for the task, unfolded, already in a task, and anything extra folded under it. */
export type RowState = { ticked: boolean; open: boolean; sent?: SeoSent; extra?: string };

function tagsHtml(f: SeoFinding, sent?: SeoSent): string {
  const tags = [
    f.scope === 'site' ? '<span class="seo-tag" title="From the template or the site\'s setup, so every page has it">Whole site</span>' : '',
    f.fixIn === 'cms' ? '<span class="seo-tag">CMS</span>' : f.fixIn === 'code' ? '<span class="seo-tag">Code</span>' : '',
    sent ? `<a class="seo-tag is-sent" href="${esc(sent.url)}" target="_blank" rel="noopener" title="${esc(sent.name)}">In ClickUp</a>` : '',
  ].join('');
  return tags ? `<p class="seo-tags">${tags}</p>` : '';
}

const showButton = (item: SeoItem) =>
  item.ref ? `<button class="seo-show" type="button" data-action="seo-show" data-ref="${esc(item.ref)}" data-label="${esc(item.label)}">Show</button>` : '';

function itemHtml(item: SeoItem): string {
  const thumb = item.thumb ? `<img class="seo-thumb" src="${esc(item.thumb)}" alt="" loading="lazy">` : '';
  const level = item.level ? `<span class="seo-level">H${item.level}</span>` : '';
  const label = `<span class="seo-item-label${item.code ? ' is-code' : ''}">${esc(item.label)}</span>`;
  const note = item.note ? `<span class="seo-item-note">${esc(item.note)}</span>` : '';
  const indent = item.level ? ` seo-item--h${Math.min(6, item.level)}` : '';
  return `<li class="seo-item${indent}">${thumb}${level}<span class="seo-item-text">${label}${note}</span>${showButton(item)}</li>`;
}

function moreHtml(f: SeoFinding, extra = ''): string {
  const rest = f.more ? `<li class="seo-item is-more">and ${f.more} more</li>` : '';
  const items = f.items?.length ? `<ul class="seo-items">${f.items.map(itemHtml).join('')}${rest}</ul>` : '';
  const why = f.why ? `<p class="seo-why">${esc(f.why)}</p>` : '';
  const fix = f.fix ? `<p class="seo-fix"><b>Fix</b> ${esc(f.fix)}</p>` : '';
  return `${items}${extra}${why}${fix}`;
}

export function findingHtml(f: SeoFinding, s: RowState): string {
  const id = esc(f.id);
  const problem = isProblem(f);
  const lead = problem
    ? `<label class="seo-tick" title="Include in the ClickUp task"><input type="checkbox" data-action="seo-tick" data-id="${id}"${s.ticked ? ' checked' : ''} aria-label="Include in the ClickUp task: ${esc(f.title)}"><span class="seo-tick-box" aria-hidden="true">${ICONS.check}</span></label>`
    : `<span class="seo-state seo-state--${f.severity}" aria-hidden="true">${f.severity === 'pass' ? ICONS.check : SEO_ICONS.dash}</span>`;
  const foldable = Boolean(f.items?.length || f.why || f.fix || s.extra);
  const title = `<span class="seo-row-title">${esc(f.title)}</span>`;
  const head = foldable
    ? `<button class="seo-row-head" type="button" data-action="seo-expand" data-id="${id}" aria-expanded="${s.open}">${title}<span class="seo-chevron">${SEO_ICONS.chevron}</span></button>`
    : `<p class="seo-row-head">${title}</p>`;
  return `<li class="seo-row seo-row--${f.severity}${s.sent ? ' is-sent' : ''}" data-id="${id}">${lead}<div class="seo-row-main">${head}${
    f.detail ? `<p class="seo-row-detail">${esc(f.detail)}</p>` : ''
  }${problem ? tagsHtml(f, s.sent) : ''}${foldable ? `<div class="seo-more"${s.open ? '' : ' hidden'}>${moreHtml(f, s.extra)}</div>` : ''}</div></li>`;
}

/** How a link to the page looks when it's shared: its image, site, title and description. */
export function shareHtml(p: { image: string; site: string; title: string; description: string }): string {
  const image = p.image ? `<img class="seo-share-img" src="${esc(p.image)}" alt="" loading="lazy">` : '<span class="seo-share-img is-empty">No picture</span>';
  return `<div class="seo-share" aria-label="How a shared link to the page looks">${image}<span class="seo-share-text"><span class="seo-share-site">${esc(p.site)}</span><span class="seo-share-title">${esc(p.title)}</span>${
    p.description ? `<span class="seo-share-desc">${esc(p.description)}</span>` : ''
  }</span></div>`;
}

/** Google's own test for structured data; it only reaches public pages. */
export const richResultsHtml = (url: string): string =>
  `<p class="seo-ext"><a href="https://search.google.com/test/rich-results?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">Test the page in Google's Rich Results Test</a></p>`;
