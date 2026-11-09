/**
 * Types for the SEO check. The page script reads a page into a SeoSnapshot and fetches what
 * Google fetches with it (SeoNetwork); the checks (./checks) turn both into findings.
 */
import type { Environment } from '../site';
import type { PageInfo, ProjectRef, RecentTask, TaskDraft } from '../types';

/** How much a finding matters. `skip`: it couldn't be checked (a network error, say). */
export type Severity = 'fix' | 'improve' | 'notice' | 'pass' | 'skip';

export type SeoCategory = 'indexing' | 'snippet' | 'languages' | 'content' | 'sharing' | 'structured' | 'technical';

export type SeoItem = {
  /** One line: an image's file name, a language code, a heading, an address. */
  label: string;
  /** Beside it: what's wrong with it, or where it is. */
  note?: string;
  /** File names, codes and addresses, which the task shows as code. */
  code?: boolean;
  /** A heading's level, for the outline. */
  level?: number;
  /** The element on the page, for Show: the page script's own id, never sent anywhere. */
  ref?: string;
  /** A picture of it (an image's address), for the panel only. */
  thumb?: string;
};

export type SeoFinding = {
  /** What was found, e.g. "title-long": the same problem has the same id on every page. */
  id: string;
  /** The check that found it, e.g. "title". */
  check: string;
  category: SeoCategory;
  severity: Severity;
  /** What's wrong (or right), in one plain line. */
  title: string;
  /** The specifics, in one line. */
  detail?: string;
  /** Why it matters, for someone who isn't an SEO person. */
  why?: string;
  /** What to do about it. */
  fix?: string;
  /** Where it's fixed: the page's content in the CMS, or the site's code (templates, config). */
  fixIn?: 'cms' | 'code';
  /** `site`: from the template or the site's setup, so every page has it. `page`: this page's own. */
  scope: 'page' | 'site';
  items?: SeoItem[];
  /** How many more items there are than `items` holds. */
  more?: number;
};

// ---------- What the page says ----------

/** The head of a page: read from the live page, and from the HTML the server sends. */
export type SeoHead = {
  /** The text of each <title> (SVG titles aside). */
  titles: string[];
  descriptions: string[];
  /** meta robots and meta googlebot. */
  robots: { name: string; content: string }[];
  viewport: string | null;
  /** Each canonical link's href as written; null when it has none. */
  canonicals: (string | null)[];
  alternates: { lang: string; href: string | null }[];
  /** og:* and twitter:* tags, the first of each, keys in lower case. */
  social: Record<string, string>;
  jsonld: string[];
  htmlLang: string | null;
  favicon: boolean;
};

export type SeoHeading = { ref: string; level: number; text: string; visible: boolean };

export type SeoImage = {
  ref: string;
  src: string;
  /** null: no alt attribute at all. */
  alt: string | null;
  /** Its size on the page; 0×0 when it isn't laid out (a closed slide, a hidden menu). */
  w: number;
  h: number;
  /** The file's own size; 0×0 until it has loaded. */
  naturalW: number;
  naturalH: number;
  /** Hidden from screen readers on purpose (aria-hidden, role="presentation"). */
  decorative: boolean;
  /** The CMS block it's in, on builds with block labels. */
  block: string | null;
};

/** A link and its accessible name (its text, aria-label, or the alt of an image in it). */
export type SeoLink = { ref: string; href: string; name: string; visible: boolean };

export type SeoSnapshot = SeoHead & {
  url: string;
  environment: Environment;
  /** Top-level schema.org microdata items. */
  microdata: number;
  headings: SeoHeading[];
  images: SeoImage[];
  links: SeoLink[];
};

// ---------- What Google fetches with it ----------

export type Failed = { error: string };

/** The page fetched again, as Google gets it: before any script runs. */
export type SeoServer = {
  status: number;
  /** Where it ended up after redirects. */
  finalUrl: string;
  /** The X-Robots-Tag header; '' when there's none. */
  robotsHeader: string;
  /** What its HTML says before scripts run; null when it wasn't HTML. */
  head: SeoHead | null;
};

/** The page fetched without the person's cookies (staging only): can a stranger, or Google, open it? */
export type SeoAccess = { status: number; finalUrl: string };

export type SeoRobotsFile = { status: number; html: boolean; text: string };

export type SeoSitemap = {
  url: string;
  status: number;
  /** A web page where the sitemap should be (a not-found page answering 200, say). */
  html: boolean;
  kind: 'urlset' | 'index' | 'unknown';
  found: boolean;
  /** How many addresses were read, across every file looked at. */
  urls: number;
  /** The domains those addresses are on. */
  hosts: string[];
  /** Some files of a sitemap index weren't read (there were too many). */
  partial: boolean;
};

export type SeoLinkResult = { href: string; ref: string; name: string; status: number; finalUrl?: string; error?: string };
export type SeoLinks = { checked: number; broken: SeoLinkResult[]; redirects: SeoLinkResult[] };

/** What Pointer remembers about the site, from earlier checks. */
export type SeoSiteInfo = {
  /** Other pages checked on this site with the same title, and with the same description. */
  titleSame: string[];
  descriptionSame: string[];
  /** How many other pages of the site have been checked. */
  pages: number;
  /** Findings already in an open ClickUp task, by sentKey. */
  sent: Record<string, SeoSent>;
};

export type SeoNetwork = {
  server?: SeoServer | Failed;
  access?: SeoAccess | Failed;
  robots?: SeoRobotsFile | Failed;
  sitemap?: SeoSitemap | (Failed & { url: string });
  /** The share image's size, once it loads; 0×0 when it loads but couldn't be measured. */
  ogImage?: { w: number; h: number } | Failed;
  site?: SeoSiteInfo;
  /** Only once someone presses Check links. */
  links?: SeoLinks;
};

/** Text width in px in Google's fonts (titles about 20px Arial, descriptions about 14px). */
export type Measure = (text: string, kind: 'title' | 'description') => number;

export type SeoInput = { page: SeoSnapshot; net: SeoNetwork; measure: Measure };

/** One check: its findings (a pass when all is well), [] when it doesn't apply, null while what it needs is still loading. */
export type Check = (input: SeoInput) => SeoFinding[] | null;

// ---------- Sending to ClickUp ----------

/** A ClickUp task findings went into. */
export type SeoSent = { taskId: string; name: string; url: string };

export type SeoRequest = {
  page: PageInfo;
  project: ProjectRef;
  /** ClickUp user id; '' is no one. */
  assigneeId: string;
  /** The ticked findings, without element ids or pictures (forTask). */
  findings: SeoFinding[];
  /** What sent findings are remembered under (siteKey), so later checks know them. */
  site: string;
  viewport: { w: number; h: number };
  browser: string;
};

export type SeoPrepareResponse = { ok: true; draft: TaskDraft } | { ok: false; stage: 'keys' | 'task'; error: string };

export type SeoPublishResult =
  | { ok: true; task: RecentTask; sent: Record<string, SeoSent> }
  | { ok: false; stage: 'keys' | 'task'; error: string };
