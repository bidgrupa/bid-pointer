/**
 * Page tasks ("Enable Page Specific Task"): notes collect on a page and go out together as
 * one ClickUp task when the person presses Publish task.
 *
 * Storage: `pageTasks` in storage.local maps a page key (pageKeyOf) to its PageTask.
 * Screenshots are kept apart, one key each (`pageShot:<item id>`), so editing a note doesn't
 * rewrite them all. The manifest asks for unlimited storage, because a few full-resolution
 * PNGs pass Chrome's 10 MB quota.
 */
import { dataUrlToBlob } from './blob';
import { VIDEO_UPLOAD_MS, attachFile, createTask, deleteTask } from './clickup';
import { effectiveZaiKey, getSettings, missingKeys, patchSettings } from './settings';
import { forgetTask, rememberTask } from './taskindex';
import { rewrite } from './zai';
import { buildPageDescription, pageTaskTitle, shotName, videoName } from '../shared/format';
import { factsFor } from '../shared/match';
import type {
  PageInfo,
  PagePrepareResponse,
  PageTask,
  PageTaskItem,
  PageTaskNote,
  ProjectRef,
  PublishResult,
  RecentTask,
  Settings,
  TaskDraft,
} from '../shared/types';

const KEY = 'pageTasks';
const shotKey = (itemId: string) => `pageShot:${itemId}`;
const videoKey = (itemId: string) => `pageVideo:${itemId}`;
/** Everything stored apart for a note: its screenshot and its recording. */
const fileKeys = (itemId: string) => [shotKey(itemId), videoKey(itemId)];
/** Published notes stay this long, so Undo can bring them back. */
const KEEP_PUBLISHED_MS = 60_000;
/** Rewrites at once when publishing notes that haven't been rewritten yet. */
const REWRITE_LIMIT = 3;

type All = Record<string, PageTask>;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// One change at a time: notes being added, edited, rewritten and published all read,
// change and write the same key.
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

/** Saves, first dropping notes that were published long enough ago that Undo is over. */
async function save(all: All) {
  const now = Date.now();
  const shots: string[] = [];
  for (const [key, t] of Object.entries(all)) {
    if (t.published && now - t.published.at > KEEP_PUBLISHED_MS) {
      shots.push(...t.items.flatMap((i) => fileKeys(i.id)));
      delete all[key];
    }
  }
  if (shots.length) await chrome.storage.local.remove(shots);
  await chrome.storage.local.set({ [KEY]: all });
}

/** The page's notes, unless there are none or they were just published. */
const unpublished = (t: PageTask | undefined): PageTask | null => (t && !t.published && t.items.length ? t : null);

export const getPageTask = async (key: string): Promise<PageTask | null> => unpublished((await load())[key]);

/** Every page with notes waiting, most recently changed first (for the options page). */
export async function listPageTasks(): Promise<PageTask[]> {
  return Object.values(await load())
    .filter((t) => unpublished(t))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export type AddNote = {
  key: string;
  page: PageInfo;
  project: ProjectRef;
  assigneeId: string;
  note: PageTaskNote;
  screenshot: string | null;
  /** The recording as a data URL; its type and length are in `note.video`. */
  video: string | null;
  viewport: { w: number; h: number };
  browser: string;
};

export function addNote(m: AddNote): Promise<PageTask> {
  return locked(async () => {
    const all = await load();
    const prev = all[m.key];
    // notes published a moment ago are done with; this note starts the next task
    if (prev?.published) await chrome.storage.local.remove(prev.items.flatMap((i) => fileKeys(i.id)));
    const current = unpublished(prev);
    const id = newId();
    if (m.screenshot) await chrome.storage.local.set({ [shotKey(id)]: m.screenshot });
    if (m.video) await chrome.storage.local.set({ [videoKey(id)]: m.video });
    const { video, ...note } = m.note;
    const item: PageTaskItem = {
      ...note,
      ...(m.video && video ? { video } : {}),
      id,
      screenshot: Boolean(m.screenshot),
      prepared: null,
      createdAt: Date.now(),
    };
    const task: PageTask = {
      key: m.key,
      page: m.page,
      project: m.project,
      assigneeId: m.assigneeId,
      items: [...(current?.items ?? []), item],
      viewport: m.viewport,
      browser: m.browser,
      updatedAt: Date.now(),
    };
    all[m.key] = task;
    await save(all);
    void rewriteLater(m.key, id);
    return task;
  });
}

export function updateNote(key: string, itemId: string, note: string, project: ProjectRef | null, assigneeId: string): Promise<PageTask> {
  return locked(async () => {
    const all = await load();
    const task = unpublished(all[key]);
    const item = task?.items.find((i) => i.id === itemId);
    if (!task || !item) throw new Error('That note is gone. It may have been published or removed in another tab.');
    const changed = item.note !== note;
    if (changed) {
      item.note = note;
      item.prepared = null;
    }
    if (project) task.project = project;
    task.assigneeId = assigneeId;
    task.updatedAt = Date.now();
    await save(all);
    if (changed) void rewriteLater(key, itemId);
    return task;
  });
}

export function removeNote(key: string, itemId: string): Promise<PageTask | null> {
  return locked(async () => {
    const all = await load();
    const task = unpublished(all[key]);
    if (!task) return null;
    task.items = task.items.filter((i) => i.id !== itemId);
    task.updatedAt = Date.now();
    await chrome.storage.local.remove(fileKeys(itemId));
    if (!task.items.length) delete all[key];
    await save(all);
    return unpublished(task);
  });
}

export function discardPageTask(key: string): Promise<null> {
  return locked(async () => {
    const all = await load();
    const task = all[key];
    if (task) {
      await chrome.storage.local.remove(task.items.flatMap((i) => fileKeys(i.id)));
      delete all[key];
      await save(all);
    }
    return null;
  });
}

/**
 * Rewrites a note right after it's added or edited, so publishing doesn't wait on the model.
 * A note edited in the meantime keeps its own, newer rewrite. Failures are left for publish.
 */
async function rewriteLater(key: string, itemId: string) {
  try {
    const task = await getPageTask(key);
    const item = task?.items.find((i) => i.id === itemId);
    const apiKey = effectiveZaiKey(await getSettings());
    if (!task || !item || item.prepared || !apiKey) return;
    const ctx = { note: item.note, block: item.block, element: item.element, page: task.page, projectLabel: task.project?.label ?? '' };
    const prepared = await rewrite(apiKey, ctx);
    if (!prepared) return;
    await locked(async () => {
      const all = await load();
      const current = unpublished(all[key])?.items.find((i) => i.id === itemId);
      if (!current || current.note !== item.note || current.prepared) return;
      current.prepared = prepared;
      await save(all);
    });
  } catch {
    // publishing tries again
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type ComposedPage = {
  s: Settings;
  task: PageTask;
  project: ProjectRef;
  items: PageTaskItem[];
  draft: TaskDraft;
  unrewritten: number;
  rewriteError?: string;
};

/**
 * Gets a page task ready to go out: notes the background hasn't rewritten yet (or couldn't) get
 * another try, those rewrites are kept on the notes, and the name and description are built.
 */
async function composePage(key: string, opts: { omitTechnical: boolean }): Promise<{ ok: true; c: ComposedPage } | { ok: false; stage: 'keys' | 'task'; error: string }> {
  const s = await getSettings();
  const missing = missingKeys(s);
  if (missing.length) return { ok: false, stage: 'keys', error: `Missing ${missing.join(' and ')}` };
  const task = await getPageTask(key);
  if (!task) return { ok: false, stage: 'task', error: 'There are no notes on this page to publish.' };
  const project = task.project;
  if (!project) return { ok: false, stage: 'task', error: 'Choose a project in one of the notes first.' };

  let rewriteError: string | undefined;
  // without a Z.ai key the notes go as written, and none of them counts as a failed rewrite
  const zaiKey = effectiveZaiKey(s);
  const items = await mapLimit(task.items, REWRITE_LIMIT, async (item) => {
    if (item.prepared || !zaiKey) return item;
    try {
      const ctx = { note: item.note, block: item.block, element: item.element, page: task.page, projectLabel: project.label };
      const prepared = await rewrite(zaiKey, ctx);
      if (!prepared) rewriteError ??= 'model reply was not usable';
      return { ...item, prepared };
    } catch (e) {
      rewriteError ??= errMsg(e);
      return item;
    }
  });
  // keep the new rewrites, so a review followed by Publish doesn't rewrite again
  if (items.some((i, n) => i.prepared && !task.items[n]?.prepared)) {
    await locked(async () => {
      const all = await load();
      for (const stored of unpublished(all[key])?.items ?? []) {
        const fresh = items.find((i) => i.id === stored.id);
        if (fresh?.prepared && !stored.prepared && fresh.note === stored.note) stored.prepared = fresh.prepared;
      }
      await save(all);
    });
  }

  const reporter = s.clickupUser?.username || s.clickupUser?.email || undefined;
  const draft: TaskDraft = {
    name: pageTaskTitle(task.page),
    description: buildPageDescription({ ...task, items, omitTechnical: opts.omitTechnical, ...(reporter ? { reporter } : {}) }),
  };
  const unrewritten = zaiKey ? items.filter((i) => !i.prepared).length : 0;
  return { ok: true, c: { s, task, project, items, draft, unrewritten, ...(rewriteError ? { rewriteError } : {}) } };
}

/** The page task as it would go out, for the review before publishing. */
export async function preparePageTask(key: string, opts: { omitTechnical: boolean }): Promise<PagePrepareResponse> {
  const r = await composePage(key, opts);
  if (!r.ok) return r;
  const { draft, items, unrewritten, rewriteError } = r.c;
  return { ok: true, draft, notes: items.length, unrewritten, ...(rewriteError ? { rewriteError } : {}) };
}

/**
 * Creates one task from the page's notes, attaches their screenshots, and keeps the notes for
 * Undo. `edited` is the name and description from the review, sent exactly as they are.
 */
export async function publishPageTask(key: string, opts: { omitTechnical: boolean }, edited?: TaskDraft): Promise<PublishResult> {
  const r = await composePage(key, opts);
  if (!r.ok) return r;
  const { s, task, project, items, unrewritten, rewriteError } = r.c;
  const name = edited?.name.trim() || r.c.draft.name;
  const markdown_description = edited ? edited.description : r.c.draft.description;
  const assigneeId = Number(task.assigneeId);
  let created;
  try {
    created = await createTask(s.clickupToken, project.listId, {
      name,
      markdown_description,
      assignees: Number.isFinite(assigneeId) && assigneeId > 0 ? [assigneeId] : [],
      tags: ['pointer', task.page.environment ?? 'staging', ...(unrewritten ? ['needs-rewrite'] : [])],
    });
  } catch (e) {
    return { ok: false, stage: 'task', error: errMsg(e) };
  }

  // Comment Mode knows the new page task at once: the next note on this page can go on it
  await rememberTask(
    { id: created.id, name, url: created.url, kind: 'page', listId: project.listId, facts: factsFor(task.page, 'page', items.map((i) => i.block)) },
    s.spaceId,
  );

  const screenshotErrors: string[] = [];
  for (const [i, item] of items.entries()) {
    const label = `Screenshot ${i + 1}`;
    if (!item.screenshot) {
      // a note with a recording comes without a screenshot, on purpose
      if (!item.video) screenshotErrors.push(`${label}: ${item.screenshotError ?? 'no capture'}`);
      continue;
    }
    try {
      const { [shotKey(item.id)]: dataUrl } = await chrome.storage.local.get(shotKey(item.id));
      if (typeof dataUrl !== 'string') throw new Error('it is no longer stored');
      await attachFile(s.clickupToken, created.id, dataUrlToBlob(dataUrl), shotName(i, item));
    } catch (e) {
      screenshotErrors.push(`${label}: upload failed: ${errMsg(e)}`);
      console.warn('Pointer: page task attachment failed', e);
    }
  }

  // recordings after every screenshot: they're the slower uploads
  const videoErrors: string[] = [];
  for (const [i, item] of items.entries()) {
    if (!item.video) continue;
    try {
      const { [videoKey(item.id)]: dataUrl } = await chrome.storage.local.get(videoKey(item.id));
      if (typeof dataUrl !== 'string') throw new Error('it is no longer stored');
      await attachFile(s.clickupToken, created.id, dataUrlToBlob(dataUrl), videoName(i, item), VIDEO_UPLOAD_MS);
    } catch (e) {
      videoErrors.push(`Video ${i + 1}: upload failed: ${errMsg(e)}`);
      console.warn('Pointer: page task video upload failed', e);
    }
  }

  // Keep the notes (with their rewrites) for a minute, so Undo can bring them back.
  await locked(async () => {
    const all = await load();
    const current = all[key];
    if (current && !current.published) {
      current.items = current.items.map((i) => items.find((x) => x.id === i.id) ?? i);
      current.published = { taskId: created.id, at: Date.now() };
    }
    await save(all);
  });

  const recent: RecentTask = {
    id: created.id,
    url: created.url,
    name,
    createdAt: Date.now(),
    projectLabel: project.label,
    screenshot: screenshotErrors.length === 0,
    ...(screenshotErrors.length ? { screenshotError: screenshotErrors.join('; ') } : {}),
    ...(items.some((i) => i.video) ? { video: videoErrors.length === 0 } : {}),
    ...(videoErrors.length ? { videoError: videoErrors.join('; ') } : {}),
  };
  await patchSettings({
    hostProjects: { ...s.hostProjects, [task.page.projectKey]: project },
    recent: [recent, ...s.recent].slice(0, 20),
  });
  return { ok: true, task: recent, notes: items.length, unrewritten, ...(rewriteError ? { rewriteError } : {}), screenshotErrors, videoErrors };
}

/** Deletes a published page task and puts its notes back on the page. */
export async function undoPublish(key: string, taskId: string): Promise<{ ok: true; restored: boolean }> {
  const s = await getSettings();
  await deleteTask(s.clickupToken, taskId);
  await forgetTask(taskId);
  await patchSettings({ recent: s.recent.filter((r) => r.id !== taskId) });
  const restored = await locked(async () => {
    const all = await load();
    const task = all[key];
    if (task?.published?.taskId !== taskId) return false;
    delete task.published;
    task.updatedAt = Date.now();
    await save(all);
    return true;
  });
  return { ok: true, restored };
}
