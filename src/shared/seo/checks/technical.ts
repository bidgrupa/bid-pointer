/** Basics every page needs: a mobile viewport, https on the live site, a favicon. All the template's. */
import type { Check } from '../types';

export const viewportCheck: Check = ({ page }) => {
  const base = { check: 'viewport', category: 'technical', scope: 'site', fixIn: 'code' } as const;
  const v = page.viewport?.trim();
  if (!v)
    return [{ ...base, id: 'viewport-missing', severity: 'fix', title: 'No mobile viewport tag', why: 'Phones then show the desktop layout zoomed out, and Google judges every page the way a phone shows it.', fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the template.' }];
  if (!/width\s*=\s*device-width/i.test(v))
    return [{ ...base, id: 'viewport-width', severity: 'improve', title: "The viewport doesn't follow the phone's width", detail: v, why: 'The page is laid out for a fixed width, so phones zoom it out.', fix: 'Use width=device-width.' }];
  return [{ ...base, id: 'viewport-ok', severity: 'pass', title: 'Set up for phones' }];
};

export const httpsCheck: Check = ({ page }) => {
  if (page.environment !== 'production') return [];
  const base = { check: 'https', category: 'technical', scope: 'site', fixIn: 'code' } as const;
  if (new URL(page.url).protocol !== 'https:')
    return [{ ...base, id: 'https-missing', severity: 'fix', title: "The page isn't on https", why: 'Browsers mark it "Not secure", and Google prefers the https copy of a site.', fix: 'Serve the site over https and redirect http to it.' }];
  return [{ ...base, id: 'https-ok', severity: 'pass', title: 'Served over https' }];
};

export const faviconCheck: Check = ({ page }) => {
  const base = { check: 'favicon', category: 'technical', scope: 'site', fixIn: 'code' } as const;
  if (!page.favicon)
    return [{ ...base, id: 'favicon-missing', severity: 'notice', title: 'No favicon link', why: 'Google shows the site\'s icon next to its results; without a <link rel="icon"> it may show a plain globe.', fix: 'Add <link rel="icon" href="/favicon.ico"> to the template.' }];
  return [{ ...base, id: 'favicon-ok', severity: 'pass', title: 'Has a favicon' }];
};
