/**
 * What Gmail's and HubSpot's readers share: turning a message body into the text GLM reads, with
 * each image the client put in as [image N], and the shapes they hand to the controller (pointer.ts).
 */
import type { EmailFile, EmailPayload } from '../shared/email';

/** A file the email shows or carries, with where to download it from. */
export type PendingFile = EmailFile & {
  url: string;
  /** A picture of it the page already shows (for the review), or null. */
  thumb: string | null;
};

export type Reading = { payload: EmailPayload; files: PendingFile[] };

/** Visible: rendered, not display:none anywhere above it, not visibility:hidden. */
export function shown(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') return check.call(el, { checkVisibilityCSS: true, visibilityProperty: true });
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  zip: 'application/zip',
};

export const mimeFromName = (name: string): string => MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** A name that can be a file name everywhere ClickUp's files end up. */
export const safeName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, '-').trim();

/** An image's alt text when it's a file name ("rooms.png"), else ''. */
export const imageNameFrom = (alt: string | null): string => {
  const a = (alt ?? '').trim();
  return /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(a) ? safeName(a) : '';
};

const SKIP = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'BUTTON']);
const BLOCK = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

/** Small pictures (icons, tracking pixels) aren't images from the client. */
export const MIN_IMAGE_PX = 32;

export function imageSize(img: HTMLImageElement): number {
  const r = img.getBoundingClientRect();
  const attr = (name: string) => Number(img.getAttribute(name)) || 0;
  return Math.max(r.width, r.height, img.naturalWidth, img.naturalHeight, attr('width'), attr('height'));
}

/** Collapses the walk's output into tidy lines: no doubled spaces, at most one empty line in a row. */
function tidy(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const sameAddress = (text: string, href: string) => {
  const t = text.trim().replace(/\/+$/, '').toLowerCase();
  const h = href.replace(/\/+$/, '').toLowerCase();
  return t === h || `https://${t}` === h || `http://${t}` === h || `mailto:${t}` === h;
};

/**
 * A message body's visible text: blocks on their own lines, list items as "- ", links written out
 * as "text (url)", and each image the client put in as [image N] (onImage numbers it). Elements
 * matching `skip` (an app's own notices inside the body) are left out.
 */
export function bodyText(body: Element, onImage: (img: HTMLImageElement) => number | null, skip = ''): string {
  const out: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.textContent ?? '').replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (SKIP.has(el.tagName) || !shown(el)) return;
    if (skip && el.matches(skip)) return;
    if (el.tagName === 'BR') {
      out.push('\n');
      return;
    }
    if (el.tagName === 'IMG') {
      const n = onImage(el as HTMLImageElement);
      if (n) out.push(` [image ${n}] `);
      return;
    }
    const block = BLOCK.has(el.tagName);
    if (block) out.push('\n');
    if (el.tagName === 'LI') out.push('- ');
    if (el.tagName === 'TD' || el.tagName === 'TH') out.push(' ');
    for (const child of Array.from(el.childNodes)) visit(child);
    if (el.tagName === 'A') {
      const href = (el as HTMLAnchorElement).href;
      if (/^https?:/i.test(href) && !sameAddress(el.textContent ?? '', href)) out.push(` (${href})`);
    }
    if (block) out.push('\n');
  };
  visit(body);
  return tidy(out.join(''));
}
