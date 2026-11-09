/**
 * Comment Mode's local list of open Pointer tasks: id, title and the few facts a note is matched
 * on (page, environment, blocks), kept in storage.local under `taskIndex`.
 *
 * It's refreshed from ClickUp with one filtered query (open tasks tagged "pointer" in the space)
 * when it's missing or old, so notes match instantly instead of searching ClickUp each time.
 * Tasks Pointer makes go in straight away; tasks found closed come out. Whether a matched task
 * is still open is checked once more, on that one task, before a comment goes on it.
 */
import { fetchOpenPointerTasks, fetchTeamIds, type ListedTask } from './clickup';
import { pickMatch, readTaskFacts, type TaskFacts } from '../shared/match';
import type { BlockInfo, OpenTask, PageInfo, Settings } from '../shared/types';

export type IndexedTask = OpenTask & {
  listId: string;
  facts: TaskFacts;
  /** When ClickUp last changed it, or when Pointer made it; the newest of several matches wins. */
  updated: number;
  /** When it went into this list; a refresh that started earlier keeps it. */
  seen: number;
};

type TaskIndex = { at: number; spaceId: string; tasks: IndexedTask[] };

const KEY = 'taskIndex';
/** Younger than this, the list answers as it is. */
const FRESH_MS = 2 * 60_000;
/** Older than this, it's refreshed before it answers; in between, it answers and refreshes after. */
const MAX_AGE_MS = 15 * 60_000;

// one change at a time: refreshes, new tasks and closed ones all write the same key
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function load(): Promise<TaskIndex | null> {
  const { [KEY]: index } = await chrome.storage.local.get(KEY);
  return (index as TaskIndex | undefined) ?? null;
}

const save = (index: TaskIndex) => chrome.storage.local.set({ [KEY]: index });

function fromClickUp(t: ListedTask, now: number): IndexedTask | null {
  const facts = readTaskFacts(t.text_content || t.description || '');
  if (!facts) return null; // tagged "pointer" but not written by Pointer, or its lines were edited away
  return {
    id: t.id,
    name: t.name,
    url: t.url,
    status: t.status?.status ?? '',
    kind: facts.kind,
    listId: t.list?.id ?? '',
    facts,
    updated: Number(t.date_updated) || 0,
    seen: now,
  };
}

let refreshing: Promise<TaskIndex> | null = null;

/** Asks ClickUp for the space's open Pointer tasks, once at a time. */
export function refreshIndex(s: Settings): Promise<TaskIndex> {
  refreshing ??= (async () => {
    const started = Date.now();
    const teams = await fetchTeamIds(s.clickupToken);
    const results = await Promise.allSettled(teams.map((team) => fetchOpenPointerTasks(s.clickupToken, team, s.spaceId)));
    const fulfilled = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    // a token that can't read any workspace isn't "no open tasks"
    if (!fulfilled.length) throw (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason ?? new Error('No ClickUp workspace');
    const fetched = fulfilled.flat().flatMap((t) => fromClickUp(t, started) ?? []);
    return locked(async () => {
      // tasks Pointer made while this was under way aren't in ClickUp's answer yet
      const recent = (await load())?.tasks.filter((t) => t.seen > started && !fetched.some((f) => f.id === t.id)) ?? [];
      const index: TaskIndex = { at: Date.now(), spaceId: s.spaceId, tasks: [...recent, ...fetched] };
      await save(index);
      return index;
    });
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** The open task a note goes on, from the local list; `lists` is the project's folder. */
export async function findInIndex(s: Settings, lists: string[], mode: 'block' | 'page', block: BlockInfo, page: PageInfo): Promise<OpenTask | null> {
  let index = await load();
  const age = index ? Date.now() - index.at : Infinity;
  if (!index || index.spaceId !== s.spaceId || age > MAX_AGE_MS) index = await refreshIndex(s);
  else if (age > FRESH_MS) void refreshIndex(s).catch(() => {});
  const candidates = index.tasks.filter((t) => lists.includes(t.listId)).map((t) => ({ facts: t.facts, updated: t.updated, task: t }));
  const hit = candidates[pickMatch(candidates, mode, block, page)];
  if (!hit) return null;
  const { id, name, url, status, kind } = hit.task;
  return { id, name, url, status, kind };
}

/** A task Pointer has just made: known to Comment Mode at once, without asking ClickUp. */
export function rememberTask(task: Omit<IndexedTask, 'updated' | 'seen' | 'status'>, spaceId: string): Promise<void> {
  return locked(async () => {
    const index = await load();
    // without a list yet, the first lookup fetches one (with this task in it)
    if (!index || index.spaceId !== spaceId) return;
    const now = Date.now();
    index.tasks = [{ ...task, status: '', updated: now, seen: now }, ...index.tasks.filter((t) => t.id !== task.id)];
    await save(index);
  });
}

/** A task that was deleted, or found closed. */
export function forgetTask(taskId: string): Promise<void> {
  return locked(async () => {
    const index = await load();
    if (!index?.tasks.some((t) => t.id === taskId)) return;
    index.tasks = index.tasks.filter((t) => t.id !== taskId);
    await save(index);
  });
}
