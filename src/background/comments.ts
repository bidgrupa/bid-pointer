/**
 * Comment Mode: a note about something that already has an open Pointer task goes on that task
 * as a comment. The open task comes from the local list in taskindex.ts (open tasks tagged
 * "pointer", across every list in the project's folder, so tasks moved on to QA and tasks other
 * people reported count too), and is checked once more in ClickUp before the comment goes on it.
 */
import { dataUrlToBlob } from './blob';
import { VIDEO_UPLOAD_MS, attachFile, createComment, deleteComment, fetchTask, isOpenPointerTask } from './clickup';
import { projectScope } from './projects';
import { getSettings, patchSettings } from './settings';
import { findInIndex, forgetTask } from './taskindex';
import type { BlockInfo, CommentResult, NoteVideo, OpenTask, PageInfo, RecentTask, Settings, TaskDraft } from '../shared/types';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function findOpenTask(m: { listId: string; mode: 'block' | 'page'; block: BlockInfo; page: PageInfo }): Promise<OpenTask | null> {
  const s = await getSettings();
  const lists = await projectScope(s.clickupToken, s.spaceId, m.listId);
  return findInIndex(s, lists, m.mode, m.block, m.page);
}

/**
 * Posts the comment, then attaches the screenshot to the task (comments can't hold files through
 * the API), so a failed comment leaves nothing behind. A task closed since it was matched gets no
 * comment: it leaves the local list and the note says so.
 */
export async function addComment(
  s: Settings,
  task: OpenTask,
  draft: TaskDraft,
  shot: { dataUrl: string | null; name?: string; error?: string },
  video: NoteVideo | undefined,
  rewrite: { rewritten: boolean; rewriteError?: string },
  label: string,
): Promise<CommentResult> {
  try {
    const live = await fetchTask(s.clickupToken, task.id);
    if (!isOpenPointerTask(live)) {
      await forgetTask(task.id);
      return { ok: false, stage: 'closed', error: `“${task.name}” was closed in the meantime.` };
    }
  } catch (e) {
    // deleted, or moved where this token can't see it
    if (/ClickUp (401|403|404)\b/.test(errMsg(e))) {
      await forgetTask(task.id);
      return { ok: false, stage: 'closed', error: `“${task.name}” isn't open anymore.` };
    }
    return { ok: false, stage: 'task', error: errMsg(e) };
  }

  let commentId: string;
  try {
    commentId = await createComment(s.clickupToken, task.id, draft.description);
  } catch (e) {
    return { ok: false, stage: 'task', error: errMsg(e) };
  }

  let screenshot = false;
  let screenshotError = shot.error;
  if (shot.dataUrl && shot.name) {
    try {
      await attachFile(s.clickupToken, task.id, dataUrlToBlob(shot.dataUrl), shot.name);
      screenshot = true;
      screenshotError = undefined;
    } catch (e) {
      screenshotError = `upload failed: ${errMsg(e)}`;
    }
  } else if (!screenshotError && !video) {
    // a note with a recording comes without a screenshot, on purpose
    screenshotError = 'no capture';
  }

  let videoUp: boolean | undefined;
  let videoError: string | undefined;
  if (video?.dataUrl) {
    try {
      await attachFile(s.clickupToken, task.id, dataUrlToBlob(video.dataUrl), video.name, VIDEO_UPLOAD_MS);
      videoUp = true;
    } catch (e) {
      videoUp = false;
      videoError = `upload failed: ${errMsg(e)}`;
    }
  }

  const recent: RecentTask = {
    id: task.id,
    commentId,
    url: task.url,
    name: task.name,
    createdAt: Date.now(),
    projectLabel: label,
    screenshot,
    ...(screenshotError ? { screenshotError } : {}),
    ...(videoUp !== undefined ? { video: videoUp } : {}),
    ...(videoError ? { videoError } : {}),
  };
  const fresh = await getSettings();
  await patchSettings({ recent: [recent, ...fresh.recent].slice(0, 20) });
  return {
    ok: true,
    task,
    commentId,
    ...rewrite,
    screenshot,
    ...(screenshotError ? { screenshotError } : {}),
    ...(videoUp !== undefined ? { video: videoUp } : {}),
    ...(videoError ? { videoError } : {}),
  };
}

export async function undoComment(commentId: string): Promise<{ ok: true }> {
  const s = await getSettings();
  await deleteComment(s.clickupToken, commentId);
  await patchSettings({ recent: s.recent.filter((r) => r.commentId !== commentId) });
  return { ok: true };
}
