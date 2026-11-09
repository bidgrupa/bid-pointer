import aliasesJson from '../data/projects.json';
import { fetchProjects } from './clickup';
import { slugCandidates } from '../shared/page';
import { domainCandidates } from '../shared/site';
import type { PageInfo, ProjectRef } from '../shared/types';

const ALIASES = aliasesJson.aliases as Record<string, string>;
const TTL = 10 * 60 * 1000;

let cache: { at: number; spaceId: string; list: ProjectRef[]; scopes: Record<string, string[]> } | null = null;

async function load(token: string, spaceId: string, force: boolean) {
  if (!force && cache && cache.spaceId === spaceId && Date.now() - cache.at < TTL) return cache;
  const { projects, scopes } = await fetchProjects(token, spaceId);
  cache = { at: Date.now(), spaceId, list: projects, scopes };
  return cache;
}

export async function getProjects(token: string, spaceId: string, force = false): Promise<ProjectRef[]> {
  return (await load(token, spaceId, force)).list;
}

/** Every list a project's tasks can be in: its folder's lists, or just itself. */
export async function projectScope(token: string, spaceId: string, listId: string): Promise<string[]> {
  return (await load(token, spaceId, false)).scopes[listId] ?? [listId];
}

export const normalizeName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

type Ranked = { project: ProjectRef; score: number };

/** Projects whose name matches the page's Vercel project, best first, with how well they match. */
function rank(page: Pick<PageInfo, 'slugCandidates'>, all: ProjectRef[]): Ranked[] {
  const scores = new Map<string, number>();
  const bump = (id: string, score: number) => scores.set(id, Math.max(scores.get(id) ?? 0, score));

  for (const candidate of page.slugCandidates) {
    const slug = candidate.replace(/^pages-/, '');
    const alias = ALIASES[slug];
    if (alias) bump(alias, 100);
    const n = normalizeName(slug);
    if (n.length < 3) continue;
    for (const p of all) {
      const head = normalizeName(p.label.split('›')[0] ?? '');
      if (!head) continue;
      if (head === n) bump(p.listId, 90);
      else if (n.length >= 4 && head.length >= 4 && (head.includes(n) || n.includes(head))) {
        bump(p.listId, 60 - Math.min(20, Math.abs(head.length - n.length)));
      }
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .flatMap(([id, score]) => {
      const project = all.find((p) => p.listId === id);
      return project ? [{ project, score }] : [];
    });
}

/** Up to three suggestions for the picker's "Suggested from the URL" group, best first. */
export function suggest(page: PageInfo, all: ProjectRef[]): ProjectRef[] {
  return rank(page, all)
    .slice(0, 3)
    .map((r) => r.project);
}

/**
 * The project a new note starts with when the site has no last-used project: the one that
 * matches the URL better than every other. A tie means there's no clear answer, so the
 * picker stays empty and asks.
 */
export function bestSuggestion(page: Pick<PageInfo, 'slugCandidates'>, all: ProjectRef[]): ProjectRef | null {
  const [first, second] = rank(page, all);
  return first && (!second || first.score > second.score) ? first.project : null;
}

/** The project a set of names (a domain's, a repository's) matches best, matched like a site's name. */
export const bestForNames = (names: string[], all: ProjectRef[]): ProjectRef | null =>
  bestSuggestion({ slugCandidates: names.map((n) => n.trim()).filter(Boolean) }, all);

// ---------- Send to ClickUp: which project an email is about ----------

/** Words that don't tell projects apart. */
const GENERIC = new Set([
  'hotel',
  'hotels',
  'resort',
  'resorts',
  'camp',
  'kamp',
  'villa',
  'villas',
  'apartments',
  'apartmani',
  'the',
  'and',
  'development',
  'dev',
  'qa',
  'web',
  'website',
  'pages',
  'page',
  'site',
  'group',
  'grupa',
  'doo',
  'dd',
]);

const words = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** bid's own project (the agency's site): everyone at bid writes "bid", so the email's words never point to it. */
const OWN_LIST = ALIASES.bid;

/**
 * The ways a project is named in text: its name without the generic words ("Hotel Dubrovnik Zagreb"
 * → "dubrovnik zagreb"), the longest of those words on its own when it's distinctive enough, and
 * its aliases (src/data/projects.json).
 */
function projectKeys(p: ProjectRef): string[][] {
  const keys: string[][] = [];
  const add = (w: string[]) => {
    if (w.join('').length >= 4 && !keys.some((k) => k.join(' ') === w.join(' '))) keys.push(w);
  };
  const name = words(p.label.split('›')[0] ?? '').filter((w) => !GENERIC.has(w));
  add(name);
  const longest = [...name].sort((a, b) => b.length - a.length)[0];
  if (name.length > 1 && longest && longest.length >= 6) add([longest]);
  for (const [alias, id] of Object.entries(ALIASES)) if (id === p.listId) add(words(alias).filter((w) => !GENERIC.has(w)));
  return keys;
}

/** A word in the text is the name's word, allowing Croatian endings ("Cresanke", "Sunčanog Hvara"). */
function sameWord(word: string, key: string): boolean {
  if (word === key) return true;
  if (word.length > key.length + 3) return false;
  return (key.length >= 4 && word.startsWith(key)) || (key.length >= 5 && word.startsWith(key.slice(0, -1)));
}

/** How many times a name is in the words: as a run of words, or run together ("suncanihvar"). */
function mentions(text: string[], key: string[]): number {
  const joined = key.join('');
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (key.length > 1 && text[i] === joined) n++;
    else if (key.every((k, j) => sameWord(text[i + j] ?? '', k))) n++;
  }
  return n;
}

/** Links that point at a tool, not at a client's site. */
const NOT_A_SITE =
  /(^|\.)(google\.[a-z.]+|googleusercontent\.com|gstatic\.com|gmail\.com|goo\.gl|youtube\.com|youtu\.be|figma\.com|clickup\.com|hubspot\.com|hs-sites\.com|wetransfer\.com|we\.tl|dropbox\.com|facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|bit\.ly|microsoft\.com|office\.com|sharepoint\.com|live\.com|outlook\.com|apple\.com|icloud\.com|zoom\.us|calendly\.com|loom\.com|notion\.so|vimeo\.com|bid\.hr|bid\.agency)$/i;

/** The names a link gives for its site: a staging host's project, a repository, or a live domain. */
function linkNames(url: string): { names: string[]; where: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (NOT_A_SITE.test(host)) return null;
  if (host === 'github.com') {
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    return repo ? { names: [repo], where: `github.com/${owner}/${repo}` } : null;
  }
  return { names: host.endsWith('.vercel.app') ? slugCandidates(host) : domainCandidates(host), where: host };
}

export type Recognition = {
  project: ProjectRef;
  /** In a few words, for the picker's line: "its name is in the subject". */
  why: string;
  /** The email itself says so (its subject, or a link to the site): worth more than the sender's last choice. */
  strong: boolean;
};

export type RecognitionInput = {
  subject: string;
  /** The emails' text (the client's, not bid's replies) and what the tasks say. */
  text: string;
  /** The sender's domain, when it can say anything: not webmail, not bid's own. */
  senderDomain: string;
  /** The client the model says the email comes from. */
  client: string | null;
  /** The company HubSpot has the ticket's contact at. */
  company?: string;
  /** What the subject is, in the reason given: "the subject" unless said ("the ticket's name"). */
  subjectIs?: string;
};

/**
 * Which ClickUp project an email is about, from what's in it: a project's name in the subject, a
 * link to its site (staging, live or its repository), an address at its domain, the sender's
 * domain, the client the model named, or its name in the text. Each kind of evidence counts once
 * per project; the best project must beat the rest, or there's no answer and the picker asks.
 */
export function recognizeProject(input: RecognitionInput, all: ProjectRef[]): Recognition | null {
  const found = new Map<string, { total: number; sources: Set<string>; best: { points: number; why: string }; strong: boolean }>();
  const add = (listId: string | undefined, source: string, points: number, why: string, strong = false) => {
    if (!listId || !all.some((p) => p.listId === listId)) return;
    const f = found.get(listId) ?? { total: 0, sources: new Set<string>(), best: { points: 0, why }, strong: false };
    if (f.sources.has(source)) return;
    f.sources.add(source);
    f.total += points;
    if (points > f.best.points) f.best = { points, why };
    f.strong ||= strong;
    found.set(listId, f);
  };

  const subject = words(input.subject);
  const text = words(input.text);
  const client = words(input.client ?? '');
  const company = words(input.company ?? '');
  for (const p of all) {
    if (p.listId === OWN_LIST) continue;
    const keys = projectKeys(p);
    if (keys.some((k) => mentions(subject, k) > 0)) add(p.listId, 'subject', 100, `its name is in ${input.subjectIs ?? 'the subject'}`, true);
    if (client.length && keys.some((k) => mentions(client, k) > 0)) add(p.listId, 'client', 70, `the email is from ${input.client}`);
    if (company.length && keys.some((k) => mentions(company, k) > 0)) add(p.listId, 'company', 70, `the ticket's contact is at ${input.company}`);
    const times = keys.reduce((sum, k) => sum + mentions(text, k), 0);
    if (times) add(p.listId, 'text', 40 + 5 * Math.min(times - 1, 4), 'its name is in the email');
  }

  for (const url of new Set(input.text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [])) {
    const link = linkNames(url);
    if (link) add(bestForNames(link.names, all)?.listId, 'link', 90, `a link to ${link.where}`, true);
  }
  for (const address of new Set(input.text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])) {
    const domain = address.split('@')[1]?.toLowerCase() ?? '';
    if (!domain || /(^|\.)bid\.(hr|agency)$/.test(domain) || NOT_A_SITE.test(domain)) continue;
    add(bestForNames(domainCandidates(domain), all)?.listId, 'address', 60, `an address at ${domain} in the email`);
  }
  if (input.senderDomain) add(bestForNames(domainCandidates(input.senderDomain), all)?.listId, 'sender', 80, `the sender's domain, ${input.senderDomain}`);

  const ranked = [...found.entries()].sort((a, b) => b[1].total - a[1].total);
  const [top, second] = ranked;
  if (!top || top[1].total < 40 || (second && second[1].total === top[1].total)) return null;
  const project = all.find((p) => p.listId === top[0]);
  return project ? { project, why: top[1].best.why, strong: top[1].strong } : null;
}
