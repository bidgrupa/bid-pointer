/**
 * Comment Mode: telling which open Pointer task a new note belongs to. Pure functions, unit-tested.
 *
 * Pointer tasks carry their facts in visible lines (see buildDescription and
 * buildPageDescription), so tasks made by any version of Pointer, by anyone, can be matched:
 *   🔗 [repo › /path](url)              the page (plain text: "🔗 repo › /path")
 *   **Environment** Staging · 3 notes   the environment, and "· N notes" on page tasks only
 *   **Block** Hero · #4821              a block (page tasks have one per note)
 * ClickUp gives descriptions back as plain text (`text_content`) or as Markdown it re-escaped
 * ("1\\." for "1.", "*   " for "- "); both are read the same way.
 *
 * A block label's number is the block's type (componentId), so the same block type sits on many
 * pages: a block only matches on the same page.
 */
import type { BlockInfo, Environment, PageInfo } from './types';

export type TaskFacts = {
  kind: 'single' | 'page';
  /** The reported page's path, without query, hash or trailing slash; null if no page line. */
  path: string | null;
  environment: Environment;
  blocks: { name: string; id: string }[];
};

const ENVIRONMENTS: Record<string, Environment> = { staging: 'staging', production: 'production', local: 'local' };

/** "/rooms/superior/?x=1#top" → "/rooms/superior"; "" → "/". Case-insensitive, as sites mostly are. */
export function normalizePath(path: string): string {
  const bare = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  return (bare || '/').toLowerCase();
}

/** Markdown escapes and bold markers out, so the plain and Markdown forms read alike. */
const plain = (text: string) => text.replace(/\\([\\`*_{}[\]()#+\-.!>|~])/g, '$1').replace(/\*\*/g, '');

/** What a task's description says about where it was reported; null for anything not from Pointer. */
export function readTaskFacts(description: string): TaskFacts | null {
  const lines = plain(description)
    .split('\n')
    .map((l) => l.trim());
  let path: string | null = null;
  let environment: Environment | null = null;
  let page = false;
  const blocks: TaskFacts['blocks'] = [];

  for (const line of lines) {
    if (path === null) {
      // "🔗 [repo › /path](url)" or "🔗 repo › /path"
      const link = line.match(/^🔗\s*\[?([^\]›]+?) › ([^\]\s]+)\]?(?:\(([^)\s]+)\))?/u);
      if (link?.[2]) path = normalizePath(link[2]);
    }
    if (environment === null) {
      const env = line.match(/^Environment (Staging|Production|Local)\b(.*)$/i);
      if (env?.[1]) {
        environment = ENVIRONMENTS[env[1].toLowerCase()] ?? 'staging';
        page = /·\s*\d+\s+notes?\s*$/i.test(env[2] ?? '');
      }
    }
    const block = line.match(/^Block (.+?)(?: · #([^\s·]+))?(?: · |$)/);
    if (block?.[1]) blocks.push({ name: block[1].trim(), id: block[2] ?? '' });
  }

  // every Pointer task links the page it was reported on; anything without that isn't one
  if (path === null) return null;
  // the first versions had no environment line; they only ran on staging
  return { kind: page ? 'page' : 'single', path, environment: environment ?? 'staging', blocks };
}

/** The facts of a task Pointer has just made, known without reading it back from ClickUp. */
export function factsFor(page: PageInfo, kind: TaskFacts['kind'], blocks: BlockInfo[]): TaskFacts {
  return {
    kind,
    path: normalizePath(page.path),
    environment: page.environment ?? 'staging',
    blocks: blocks.filter((b) => b.name && b.source !== 'none').map((b) => ({ name: b.name, id: b.id })),
  };
}

const samePlace = (facts: TaskFacts, page: PageInfo) =>
  facts.path !== null && facts.path === normalizePath(page.path) && facts.environment === (page.environment ?? 'staging');

/** A task about this block on this page: a single task about it, or a page task with a note on it. */
export function matchesBlock(facts: TaskFacts, block: BlockInfo, page: PageInfo): boolean {
  if (!block.name || block.source === 'none' || !samePlace(facts, page)) return false;
  return facts.blocks.some((b) => b.name === block.name && b.id === block.id);
}

/** The page task for this page. */
export function matchesPage(facts: TaskFacts, page: PageInfo): boolean {
  return facts.kind === 'page' && samePlace(facts, page);
}

export type Candidate = { facts: TaskFacts; updated: number };

/**
 * Which candidate a note goes to, or -1 for none. For a block, a task about that block alone
 * wins over a page task that mentions it; otherwise, and for pages, the most recently updated.
 */
export function pickMatch(candidates: Candidate[], mode: 'block' | 'page', block: BlockInfo, page: PageInfo): number {
  let best = -1;
  const rank = (c: Candidate) => (mode === 'block' && c.facts.kind === 'single' ? 1 : 0);
  candidates.forEach((c, i) => {
    const hit = mode === 'block' ? matchesBlock(c.facts, block, page) : matchesPage(c.facts, page);
    if (!hit) return;
    const current = candidates[best];
    if (!current || rank(c) > rank(current) || (rank(c) === rank(current) && c.updated > current.updated)) best = i;
  });
  return best;
}
