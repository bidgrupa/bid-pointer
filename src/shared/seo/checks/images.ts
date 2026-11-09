/**
 * Images and their alt text, which is how Google (and people who can't see the picture) know what
 * it shows. An empty alt is right for decoration, so an empty one only counts on a picture big
 * enough to be content; a missing alt attribute always counts.
 */
import { fileName } from '../url';
import type { Check, SeoFinding, SeoImage, SeoItem } from '../types';

/** How many images a finding lists; the rest are counted. */
const SHOWN = 30;

/** A tracking pixel or a spacer: known to be at most 2×2. */
const tiny = (im: SeoImage) => (im.w > 0 || im.naturalW > 0) && Math.max(im.w, im.naturalW) <= 2 && Math.max(im.h, im.naturalH) <= 2;

/** Big enough to be content rather than an icon. One of unknown size (hidden, not loaded) counts unless it's an SVG. */
const contentSized = (im: SeoImage) =>
  (im.w >= 120 && im.h >= 80) || (im.naturalW >= 200 && im.naturalH >= 130) || (!im.w && !im.h && !im.naturalW && !/\.svg(?:[?#]|$)/i.test(im.src));

const looksLikeFile = (alt: string) => /\.(?:jpe?g|png|webp|avif|gif|svg)$/i.test(alt.trim()) || /^(?:img|dsc|image|photo)[-_ ]?\d+/i.test(alt.trim());

const item = (im: SeoImage, problem: string): SeoItem => ({
  label: fileName(im.src),
  code: true,
  note: [im.block ? `in ${im.block}` : '', problem, !im.w && !im.h ? 'hidden right now' : ''].filter(Boolean).join(' · '),
  ref: im.ref,
  thumb: im.src,
});

const listed = (items: SeoItem[]) => ({ items: items.slice(0, SHOWN), ...(items.length > SHOWN ? { more: items.length - SHOWN } : {}) });

export const imagesCheck: Check = ({ page }) => {
  const base = { check: 'images', category: 'content', scope: 'page' } as const;
  const images = page.images.filter((im) => !im.decorative && !tiny(im));
  if (!images.length) return [{ ...base, id: 'images-none', severity: 'pass', title: 'No images that need alt text' }];
  const missing = images.filter((im) => im.alt === null);
  const empty = images.filter((im) => im.alt !== null && !im.alt.trim() && contentSized(im));
  const out: SeoFinding[] = [];
  const n = missing.length + empty.length;
  if (n)
    out.push({
      ...base,
      fixIn: empty.length >= missing.length ? 'cms' : 'code',
      id: 'images-alt',
      severity: 'improve',
      title: `${n} ${n === 1 ? 'image has' : 'images have'} no alt text`,
      detail: [missing.length ? `${missing.length} without an alt attribute` : '', empty.length ? `${empty.length} with an empty one` : ''].filter(Boolean).join(', '),
      ...listed([...missing.map((im) => item(im, 'no alt attribute')), ...empty.map((im) => item(im, 'empty alt'))]),
      why: "Alt text tells Google, and people who can't see the picture, what it shows; it's how photos turn up in image search.",
      fix: [
        empty.length ? "Fill in each image's alt text in the CMS: a few words on what it shows (“Superior room with a sea view”)." : '',
        missing.length ? "Images without the attribute need their component to output alt, from the image's alt text in the CMS." : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  const named = images.filter((im) => im.alt && looksLikeFile(im.alt));
  if (named.length)
    out.push({ ...base, fixIn: 'cms', id: 'images-filename', severity: 'notice', title: `${named.length} alt ${named.length === 1 ? 'text is' : 'texts are'} a file name`, ...listed(named.map((im) => item(im, `alt="${im.alt}"`))), why: 'A file name tells Google nothing about the picture.', fix: 'Describe what the picture shows instead.' });
  return out.length ? out : [{ ...base, id: 'images-ok', severity: 'pass', title: `${images.length} ${images.length === 1 ? 'image' : 'images'}, none missing alt text` }];
};
