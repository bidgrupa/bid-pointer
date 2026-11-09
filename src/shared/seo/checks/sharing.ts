/**
 * How the page looks when it's shared (Open Graph and Twitter tags), and the structured data
 * Google reads for richer results.
 */
import type { Check, SeoFinding } from '../types';

/** The share image's address: og:image or one of its variants, else twitter:image. */
export const shareImage = (social: Record<string, string>): string =>
  (social['og:image'] || social['og:image:url'] || social['og:image:secure_url'] || social['twitter:image'] || '').trim();

export const shareImageCheck: Check = ({ page, net }) => {
  const base = { check: 'og-image', category: 'sharing', scope: 'page', fixIn: 'cms' } as const;
  const src = shareImage(page.social);
  if (!src)
    return [{ ...base, id: 'og-image-missing', severity: 'improve', title: 'No share image', detail: 'No og:image tag', why: 'Links to the page shared on WhatsApp, Facebook, LinkedIn or Slack show no picture, and get fewer clicks.', fix: "Set the page's share image in the CMS, or have the template fall back to a default image." }];
  if (!/^https?:\/\//i.test(src))
    return [{ ...base, fixIn: 'code', id: 'og-image-relative', severity: 'improve', title: "The share image's address is relative", detail: src, why: "Facebook, WhatsApp and the like don't resolve relative addresses, so they show no picture.", fix: 'Use the full address, with https:// and the domain.' }];
  const loaded = net.ogImage;
  if (!loaded) return null;
  if ('error' in loaded)
    return [{ ...base, id: 'og-image-broken', severity: 'improve', title: "The share image doesn't load", detail: loaded.error, why: 'Shared links show no picture.', fix: 'Point og:image at an image that exists.' }];
  if (loaded.w && (loaded.w < 600 || loaded.h < 315))
    return [{ ...base, id: 'og-image-small', severity: 'notice', title: `The share image is small (${loaded.w}×${loaded.h})`, why: 'Shared links show it blurry, or as a small square; 1200×630 looks sharp everywhere.', fix: 'Use an image at least 1200×630.' }];
  return [{ ...base, id: 'og-image-ok', severity: 'pass', title: loaded.w ? `Share image, ${loaded.w}×${loaded.h}` : 'The share image loads' }];
};

export const shareTagsCheck: Check = ({ page }) => {
  const base = { check: 'og-tags', category: 'sharing', scope: 'site', fixIn: 'code' } as const;
  const missing = ['og:title', 'og:description', 'og:url', 'og:type', 'twitter:card'].filter((k) => !page.social[k]?.trim());
  if (!missing.length) return [{ ...base, id: 'og-tags-ok', severity: 'pass', title: 'The share tags are complete' }];
  const core = missing.includes('og:title') || missing.includes('og:description');
  return [
    {
      ...base,
      id: core ? 'og-tags-missing' : 'og-tags-some',
      severity: core ? 'improve' : 'notice',
      title: `${missing.length} share ${missing.length === 1 ? 'tag is' : 'tags are'} missing`,
      detail: missing.join(', '),
      why: core
        ? 'Without og:title and og:description, apps guess the preview from the page.'
        : 'og:url and og:type round off the preview on Facebook and LinkedIn; twitter:card makes X show a large card.',
      fix: "Output them in the template, from the page's meta title, description and address.",
    },
  ];
};

/** The schema.org types a JSON-LD block describes: its own, its list's, and its @graph's. */
function typesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(typesOf);
  if (!value || typeof value !== 'object') return [];
  const o = value as Record<string, unknown>;
  const own = o['@type'];
  const types = typeof own === 'string' ? [own] : Array.isArray(own) ? own.filter((t): t is string => typeof t === 'string') : [];
  return [...types, ...typesOf(o['@graph'])];
}

export const structuredCheck: Check = ({ page }) => {
  const base = { check: 'structured', category: 'structured', scope: 'site', fixIn: 'code' } as const;
  const blocks = page.jsonld.map((text): { types: string[] } | { error: string } => {
    try {
      return { types: typesOf(JSON.parse(text)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  const broken = blocks.flatMap((b, i) => ('error' in b ? [{ label: `Block ${i + 1} of ${blocks.length}`, note: b.error }] : []));
  if (broken.length) {
    const finding: SeoFinding = { ...base, id: 'structured-broken', severity: 'fix', title: `${broken.length} structured data ${broken.length === 1 ? 'block has' : 'blocks have'} a JSON error`, items: broken, why: "Google skips a block it can't read, so none of it counts.", fix: "Fix the JSON (usually a trailing comma or an unescaped quote); Google's Rich Results Test shows where." };
    return [finding];
  }
  const types = [...new Set(blocks.flatMap((b) => ('types' in b ? b.types : [])))];
  if (types.length) return [{ ...base, id: 'structured-ok', severity: 'pass', title: `Structured data: ${types.slice(0, 5).join(', ')}${types.length > 5 ? '…' : ''}` }];
  if (page.microdata) return [{ ...base, id: 'structured-microdata', severity: 'pass', title: 'Structured data, as microdata' }];
  return [
    {
      ...base,
      id: 'structured-none',
      severity: 'notice',
      title: 'No structured data',
      why: 'With schema.org Hotel markup (name, address, rating, price range), Google can show more about the hotel right in its results.',
      fix: 'Add a JSON-LD script with Hotel (or LodgingBusiness) and Organization to the template.',
    },
  ];
};
