/**
 * Runs every check and sorts what they found: what to fix first, then what to improve, what's good
 * to know, what passed, and what couldn't be checked. Within each, by area, in the order below.
 */
import { canonicalCheck } from './checks/canonical';
import { h1Check, headingsCheck, linkStatusCheck, linksCheck } from './checks/content';
import { robotsCheck, sitemapCheck } from './checks/crawl';
import { imagesCheck } from './checks/images';
import { indexCheck, renderedCheck, statusCheck } from './checks/indexing';
import { hreflangCheck, langCheck } from './checks/languages';
import { shareImageCheck, shareTagsCheck, structuredCheck } from './checks/sharing';
import { descriptionCheck, descriptionSameCheck, titleCheck, titleSameCheck } from './checks/snippet';
import { faviconCheck, httpsCheck, viewportCheck } from './checks/technical';
import type { Check, SeoCategory, SeoFinding, SeoInput, Severity } from './types';

export const SEVERITY_ORDER: Severity[] = ['fix', 'improve', 'notice', 'pass', 'skip'];

export const SEVERITY_LABEL: Record<Severity, string> = { fix: 'To fix', improve: 'To improve', notice: 'Good to know', pass: 'Passed', skip: 'Not checked' };

export const CATEGORY_ORDER: SeoCategory[] = ['indexing', 'snippet', 'languages', 'content', 'sharing', 'structured', 'technical'];

export const CATEGORY_LABEL: Record<SeoCategory, string> = {
  indexing: 'Indexing',
  snippet: 'Google snippet',
  languages: 'Languages',
  content: 'Content',
  sharing: 'Sharing',
  structured: 'Structured data',
  technical: 'Technical',
};

/** Something to act on, or at least to know about; not a check that passed or couldn't run. */
export const isProblem = (f: Pick<SeoFinding, 'severity'>): boolean => f.severity === 'fix' || f.severity === 'improve' || f.severity === 'notice';

const CHECKS: Check[] = [
  statusCheck,
  indexCheck,
  renderedCheck,
  robotsCheck,
  sitemapCheck,
  canonicalCheck,
  titleCheck,
  descriptionCheck,
  titleSameCheck,
  descriptionSameCheck,
  langCheck,
  hreflangCheck,
  h1Check,
  headingsCheck,
  imagesCheck,
  linksCheck,
  linkStatusCheck,
  shareImageCheck,
  shareTagsCheck,
  structuredCheck,
  viewportCheck,
  httpsCheck,
  faviconCheck,
];

/** Every finding, sorted; `waiting` counts the checks still waiting for something to load. */
export function evaluate(input: SeoInput): { findings: SeoFinding[]; waiting: number } {
  const found: SeoFinding[] = [];
  let waiting = 0;
  for (const check of CHECKS) {
    const out = check(input);
    if (out) found.push(...out);
    else waiting++;
  }
  const rank = (f: SeoFinding) => SEVERITY_ORDER.indexOf(f.severity) * 10 + CATEGORY_ORDER.indexOf(f.category);
  const findings = found
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
  return { findings, waiting };
}
