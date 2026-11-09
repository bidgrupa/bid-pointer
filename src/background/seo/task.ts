/**
 * Sending SEO findings to ClickUp: one task per press, in the page's project, to the person picked
 * in the panel (the default assignee unless changed), tagged pointer, seo and the environment.
 * Nothing is rewritten: the findings are already written to be read. Not added to Comment Mode's
 * list of tasks either: notes don't go on an SEO task.
 */
import { createTask, deleteTask } from '../clickup';
import { getSettings, missingKeys, patchSettings } from '../settings';
import { forgetSent, rememberSent } from './site';
import { buildSeoDescription, seoTaskTitle, sentKey, type SeoPrepareResponse, type SeoPublishResult, type SeoRequest } from '../../shared/seo';
import type { RecentTask, Settings, TaskDraft } from '../../shared/types';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function compose(req: SeoRequest, s: Settings, omitTechnical: boolean): TaskDraft {
  const reporter = s.clickupUser?.username || s.clickupUser?.email || undefined;
  return {
    name: seoTaskTitle(req.page),
    description: buildSeoDescription({ page: req.page, findings: req.findings, viewport: req.viewport, browser: req.browser, omitTechnical, ...(reporter ? { reporter } : {}) }),
  };
}

/** What can't go out yet: no keys, or nothing ticked. */
function blocked(req: SeoRequest, s: Settings): Extract<SeoPublishResult, { ok: false }> | null {
  const missing = missingKeys(s);
  if (missing.length) return { ok: false, stage: 'keys', error: `Missing ${missing.join(' and ')}` };
  if (!req.findings.length) return { ok: false, stage: 'task', error: 'Tick at least one finding.' };
  return null;
}

/** The task as it would go out, for the review. */
export async function prepareSeo(req: SeoRequest, opts: { omitTechnical: boolean }): Promise<SeoPrepareResponse> {
  const s = await getSettings();
  return blocked(req, s) ?? { ok: true, draft: compose(req, s, opts.omitTechnical) };
}

/** Creates the task; `edited` is the name and description from the review, sent exactly as they are. */
export async function publishSeo(req: SeoRequest, opts: { omitTechnical: boolean }, edited?: TaskDraft): Promise<SeoPublishResult> {
  const s = await getSettings();
  const stop = blocked(req, s);
  if (stop) return stop;
  const draft = edited ?? compose(req, s, opts.omitTechnical);
  const name = draft.name.trim() || seoTaskTitle(req.page);
  const assigneeId = Number(req.assigneeId);
  let created;
  try {
    created = await createTask(s.clickupToken, req.project.listId, {
      name,
      markdown_description: draft.description,
      assignees: Number.isFinite(assigneeId) && assigneeId > 0 ? [assigneeId] : [],
      tags: ['pointer', 'seo', req.page.environment ?? 'staging'],
    });
  } catch (e) {
    return { ok: false, stage: 'task', error: errMsg(e) };
  }
  const ref = { taskId: created.id, name, url: created.url };
  const path = new URL(req.page.url).pathname;
  const sent = Object.fromEntries(req.findings.map((f) => [sentKey(f, path), ref]));
  await rememberSent(req.site, sent);
  const task: RecentTask = { id: created.id, url: created.url, name, createdAt: Date.now(), projectLabel: req.project.label, screenshot: false, seo: { findings: req.findings.length } };
  const fresh = await getSettings();
  await patchSettings({ hostProjects: { ...fresh.hostProjects, [req.page.projectKey]: req.project }, recent: [task, ...fresh.recent].slice(0, 20) });
  return { ok: true, task, sent };
}

/** Undo: deletes the task, and forgets its findings were sent. */
export async function undoSeo(taskId: string): Promise<{ ok: true }> {
  const s = await getSettings();
  await deleteTask(s.clickupToken, taskId);
  await forgetSent(taskId);
  await patchSettings({ recent: (await getSettings()).recent.filter((r) => r.id !== taskId) });
  return { ok: true };
}
