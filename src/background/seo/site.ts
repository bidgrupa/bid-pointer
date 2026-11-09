/**
 * What Pointer remembers about each site's SEO checks, in storage.local `seoSites`: the title and
 * description of every page checked, so a page sharing them with others can be told; and which
 * findings already went to ClickUp, with their task, so the next check starts them unticked.
 * Sent findings whose task has been closed or deleted are forgotten.
 */
import { fetchTask, isOpenPointerTask } from '../clickup';
import { getSettings } from '../settings';
import type { SeoSent, SeoSiteInfo } from '../../shared/seo';

type PageSeen = { path: string; title: string; description: string; at: number };
type SiteMemory = { pages: PageSeen[]; sent: Record<string, SeoSent> };
type All = Record<string, SiteMemory>;

const KEY = 'seoSites';
/** Pages remembered per site; the longest unchecked go first. */
const MAX_PAGES = 300;
/** How long a task found open is trusted to still be open. */
const OPEN_FRESH_MS = 10 * 60_000;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// one change at a time: checks in several tabs, sending and Undo all write the same key
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function load(): Promise<All> {
  const { [KEY]: all } = await chrome.storage.local.get(KEY);
  return (all as All | undefined) ?? {};
}

const save = (all: All) => chrome.storage.local.set({ [KEY]: all });

/** Tasks found open lately, by id: when. Kept while the background runs. */
const openSeen = new Map<string, number>();

/** Which of the tasks are still open; any ClickUp can't answer about are taken to be. */
async function openTasks(ids: string[]): Promise<Set<string>> {
  const s = await getSettings();
  const open = new Set<string>();
  await Promise.all(
    ids.map(async (id) => {
      if (!s.clickupToken || Date.now() - (openSeen.get(id) ?? 0) < OPEN_FRESH_MS) return void open.add(id);
      try {
        if (!isOpenPointerTask(await fetchTask(s.clickupToken, id))) return;
        openSeen.set(id, Date.now());
        open.add(id);
      } catch (e) {
        // deleted, or no longer visible to this token: gone; anything else (offline): keep it
        if (!/ClickUp (401|403|404)\b/.test(errMsg(e))) open.add(id);
      }
    }),
  );
  return open;
}

/** Remembers the page; answers with the pages that share its title and description, and what's been sent. */
export async function visitSite(site: string, page: { path: string; title: string; description: string }): Promise<SeoSiteInfo> {
  const memory = await locked(async () => {
    const all = await load();
    const current = all[site] ?? { pages: [], sent: {} };
    const others = current.pages.filter((p) => p.path !== page.path);
    all[site] = { ...current, pages: [...others, { ...page, at: Date.now() }].slice(-MAX_PAGES) };
    await save(all);
    return { others, sent: current.sent };
  });
  const open = await openTasks([...new Set(Object.values(memory.sent).map((t) => t.taskId))]);
  const closed = Object.values(memory.sent).filter((t) => !open.has(t.taskId)).map((t) => t.taskId);
  if (closed.length) await forgetSent(...closed);
  const { others } = memory;
  return {
    titleSame: page.title ? others.filter((p) => p.title === page.title).map((p) => p.path) : [],
    descriptionSame: page.description ? others.filter((p) => p.description === page.description).map((p) => p.path) : [],
    pages: others.length,
    sent: Object.fromEntries(Object.entries(memory.sent).filter(([, t]) => open.has(t.taskId))),
  };
}

/** Remembers findings that just went into a task (by sentKey). */
export function rememberSent(site: string, sent: Record<string, SeoSent>): Promise<void> {
  return locked(async () => {
    const all = await load();
    const current = all[site] ?? { pages: [], sent: {} };
    all[site] = { ...current, sent: { ...current.sent, ...sent } };
    for (const t of Object.values(sent)) openSeen.set(t.taskId, Date.now());
    await save(all);
  });
}

/** Forgets the findings in these tasks (deleted with Undo, or closed), on every site. */
export function forgetSent(...taskIds: string[]): Promise<void> {
  return locked(async () => {
    const all = await load();
    for (const memory of Object.values(all)) memory.sent = Object.fromEntries(Object.entries(memory.sent).filter(([, t]) => !taskIds.includes(t.taskId)));
    for (const id of taskIds) openSeen.delete(id);
    await save(all);
  });
}
