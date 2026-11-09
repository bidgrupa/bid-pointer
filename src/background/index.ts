import { dataUrlToBlob } from './blob';
import { captureAndMark } from './capture';
import { VIDEO_UPLOAD_MS, attachFile, createTask, deleteTask } from './clickup';
import { addComment, findOpenTask, undoComment } from './comments';
import { attachEmailFile, fetchFile, prepareEmail, publishEmail, undoEmail } from './email';
import { getMembers } from './members';
import { addNote, discardPageTask, getPageTask, preparePageTask, publishPageTask, removeNote, undoPublish, updateNote } from './pagetasks';
import { bestSuggestion, getProjects, suggest } from './projects';
import { keepBidSetup, olderThan } from './migrate';
import { handleSeo } from './seo';
import { effectiveZaiKey, getSettings, missingKeys, patchSettings } from './settings';
import { forgetTask, rememberTask } from './taskindex';
import { technicalDataAllowed } from './technical';
import { rewrite } from './zai';
import { teamDomains } from '../shared/email';
import { buildCommentText, buildDescription, fallbackTitle, slugify } from '../shared/format';
import { factsFor } from '../shared/match';
import type {
  CaptureResponse,
  CommentResult,
  FindTaskResponse,
  InitResponse,
  MembersResponse,
  Msg,
  NoteSubmission,
  OpenTask,
  PageTask,
  PageTaskResponse,
  PrepareResponse,
  ProjectsResponse,
  RecentTask,
  Settings,
  SubmitResult,
  TaskDraft,
} from '../shared/types';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Exposed for scripts/smoke.mjs, which drives the worker through puppeteer.
(globalThis as unknown as { __pointer: unknown }).__pointer = { captureAndMark, dataUrlToBlob, toggleActiveTab };

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, stage: 'task', error: errMsg(e) }));
  return true; // async response
});

// First install: open the options page so the person can paste the ClickUp token.
chrome.runtime.onInstalled.addListener(async (details) => {
  // an install of bid's own builds before 1.0 keeps bid's setup, now as settings
  if (details.reason === 'update' && details.previousVersion && olderThan(details.previousVersion, '1.0.0')) await keepBidSetup();
  if (details.reason !== 'install') return;
  const s = await getSettings();
  if (!s.clickupToken) void chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-point-mode') void toggleActiveTab();
});
// `action` in Manifest V3, `browserAction` in Firefox's Manifest V2 build
(chrome.action ?? chrome.browserAction).onClicked.addListener((tab) => {
  if (tab.id != null) void togglePointMode(tab.id);
});

/**
 * The toolbar button and the shortcut. Where Pointer didn't start by itself (a host or footer
 * it doesn't recognise), they start it by hand.
 */
async function togglePointMode(tabId: number) {
  const toggle = () => chrome.tabs.sendMessage(tabId, { type: 'pointer:toggle' } satisfies Msg);
  try {
    if (await toggle()) return;
  } catch {
    // nothing listening: Pointer isn't on this page yet
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await toggle();
  } catch {
    // a page no extension may touch, such as the browser's own pages
  }
}

/** What the user actually has bound: people can change it, and a clash leaves it empty. */
async function pointShortcut(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((c) => c.name === 'toggle-point-mode')?.shortcut ?? '';
}

async function toggleActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) await togglePointMode(tab.id);
}

/** A page-task change, answered the same way whatever it was. */
async function pageOp(fn: () => Promise<PageTask | null>): Promise<PageTaskResponse> {
  try {
    return { ok: true, task: await fn() };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'pointer:init': {
      const s = await getSettings();
      const missing = missingKeys(s);
      const res: InitResponse = {
        keysOk: missing.length === 0,
        missing,
        user: s.clickupUser,
        remembered: s.hostProjects[msg.projectKey] ?? null,
        reviewBeforeSend: s.reviewBeforeSend,
        pageTask: s.pageTask,
        commentMode: s.commentMode,
        seoCheck: s.seoCheck,
        sites: s.sites,
        ours: teamDomains({ email: s.clickupUser?.email, footerCredit: s.footerCredit }),
        defaultAssignee: Number(s.assigneeId) > 0 ? { id: Number(s.assigneeId), name: s.assigneeName || `User ${s.assigneeId}` } : null,
        shortcut: await pointShortcut(),
        // scripts/smoke*.mjs set __pointerBuild to act out a background left over from an older build
        build: (globalThis as { __pointerBuild?: string }).__pointerBuild ?? __POINTER_BUILD__,
      };
      return res;
    }
    case 'pointer:activate': {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false };
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, files: ['content.js'] });
      return { ok: true };
    }
    case 'pointer:members': {
      const s = await getSettings();
      if (!s.clickupToken) return { members: [], error: 'Add your ClickUp token in the options' } satisfies MembersResponse;
      try {
        return { members: await getMembers(s.clickupToken) } satisfies MembersResponse;
      } catch (e) {
        return { members: [], error: errMsg(e) } satisfies MembersResponse;
      }
    }
    case 'pointer:projects': {
      const s = await getSettings();
      if (!s.clickupToken) return { all: [], suggested: [], best: null, error: 'Add your ClickUp token in the options' } satisfies ProjectsResponse;
      try {
        const all = await getProjects(s.clickupToken, s.spaceId);
        return { all, suggested: suggest(msg.page, all), best: bestSuggestion(msg.page, all) } satisfies ProjectsResponse;
      } catch (e) {
        return { all: [], suggested: [], best: null, error: errMsg(e) } satisfies ProjectsResponse;
      }
    }
    case 'pointer:capture': {
      const windowId = sender.tab?.windowId;
      if (windowId == null) return { dataUrl: null, error: 'No tab' } satisfies CaptureResponse;
      try {
        return { dataUrl: await captureAndMark(windowId, msg.capture) } satisfies CaptureResponse;
      } catch (e) {
        console.warn('Pointer: capture failed', e);
        return { dataUrl: null, error: errMsg(e) } satisfies CaptureResponse;
      }
    }
    case 'pointer:prepare':
      try {
        return { ok: true, ...(await compose(msg.submission, await getSettings(), msg.as ?? 'task')) } satisfies PrepareResponse;
      } catch (e) {
        return { ok: false, error: errMsg(e) } satisfies PrepareResponse;
      }
    case 'pointer:find-task':
      try {
        return { ok: true, task: await findOpenTask(msg) } satisfies FindTaskResponse;
      } catch (e) {
        return { ok: false, error: errMsg(e) } satisfies FindTaskResponse;
      }
    case 'pointer:comment':
      return comment(msg.submission, msg.task);
    case 'pointer:comment-undo':
      try {
        return await undoComment(msg.commentId);
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    case 'pointer:submit':
      return submit(msg.submission);
    case 'pointer:undo': {
      const s = await getSettings();
      await deleteTask(s.clickupToken, msg.taskId);
      await forgetTask(msg.taskId);
      await patchSettings({ recent: s.recent.filter((r) => r.id !== msg.taskId) });
      return { ok: true };
    }
    case 'pointer:page-get':
      return pageOp(() => getPageTask(msg.key));
    case 'pointer:page-add':
      return pageOp(() => addNote(msg));
    case 'pointer:page-update':
      return pageOp(() => updateNote(msg.key, msg.itemId, msg.note, msg.project, msg.assigneeId));
    case 'pointer:page-remove':
      return pageOp(() => removeNote(msg.key, msg.itemId));
    case 'pointer:page-discard':
      return pageOp(() => discardPageTask(msg.key));
    case 'pointer:page-prepare':
      try {
        return await preparePageTask(msg.key, { omitTechnical: !(await technicalDataAllowed()) });
      } catch (e) {
        return { ok: false, stage: 'task', error: errMsg(e) };
      }
    case 'pointer:page-publish':
      try {
        return await publishPageTask(msg.key, { omitTechnical: !(await technicalDataAllowed()) }, msg.edited);
      } catch (e) {
        return { ok: false, stage: 'task', error: errMsg(e) };
      }
    case 'pointer:page-undo':
      try {
        return await undoPublish(msg.key, msg.taskId);
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    case 'pointer:open-options':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'pointer:toggle':
      return null;
    // ---------- Send to ClickUp (Gmail) ----------
    case 'pointer:email-prepare':
      try {
        return await prepareEmail(msg.email);
      } catch (e) {
        return { ok: false, stage: 'task', error: errMsg(e) };
      }
    case 'pointer:email-publish':
      try {
        return await publishEmail(msg.publish);
      } catch (e) {
        return { ok: false, stage: 'task', error: errMsg(e) };
      }
    case 'pointer:email-attach':
      return attachEmailFile(msg.taskId, msg.name, msg.dataUrl);
    case 'pointer:email-undo':
      try {
        return await undoEmail(msg.taskIds, msg.messageIds);
      } catch (e) {
        return { ok: false, error: errMsg(e) };
      }
    case 'pointer:fetch-file':
      return fetchFile(msg.url, msg.cookies === true);
    // ---------- SEO check ----------
    case 'pointer:seo-fetch':
    case 'pointer:seo-access':
    case 'pointer:seo-head':
    case 'pointer:seo-site':
    case 'pointer:seo-prepare':
    case 'pointer:seo-publish':
    case 'pointer:seo-undo':
      return handleSeo(msg);
  }
}

type Composed = { draft: TaskDraft; rewritten: boolean; rewriteError?: string };

/**
 * The name and description a note becomes: rewritten when the model answers, else the note as
 * written. The review shows exactly this, and submit sends it unless the review changed it.
 */
async function compose(sub: NoteSubmission, s: Settings, as: 'task' | 'comment' = 'task'): Promise<Composed> {
  let prepared = sub.prepared;
  let rewriteError: string | undefined;
  // without a Z.ai key the note goes as written; that's a choice, not a failure
  if (!prepared && effectiveZaiKey(s)) {
    try {
      prepared = await rewrite(effectiveZaiKey(s), sub);
      if (!prepared) rewriteError = 'model reply was not usable';
    } catch (e) {
      rewriteError = errMsg(e);
      prepared = null;
    }
  }
  const reporter = s.clickupUser?.username || s.clickupUser?.email || undefined;
  const omitTechnical = !(await technicalDataAllowed());
  const full = { ...sub, prepared, omitTechnical, ...(reporter ? { reporter } : {}) };
  return {
    draft: {
      name: prepared ? prepared.title : fallbackTitle(sub.note, sub.block.name),
      description: as === 'comment' ? buildCommentText(full) : buildDescription(full),
    },
    rewritten: prepared !== null,
    ...(rewriteError ? { rewriteError } : {}),
  };
}

async function submit(sub: NoteSubmission): Promise<SubmitResult> {
  const s = await getSettings();
  const missing = missingKeys(s);
  if (missing.length) return { ok: false, stage: 'keys', error: `Missing ${missing.join(' and ')}` };

  // a reviewed task goes out exactly as the person left it
  const { draft, rewritten, rewriteError }: Composed = sub.edited ? { draft: sub.edited, rewritten: sub.rewritten ?? true } : await compose(sub, s);
  const name = draft.name.trim() || fallbackTitle(sub.note, sub.block.name);
  const markdown_description = draft.description;
  // staging / production / local, so live-site bugs can be filtered and spotted in lists
  // "needs-rewrite" marks a rewrite that failed, not one that was never asked for (no Z.ai key)
  const tags = ['pointer', sub.page.environment ?? 'staging', ...(rewritten || !effectiveZaiKey(s) ? [] : ['needs-rewrite'])];
  // the person picked in the note; notes from before the picker existed fall back to the default
  const assigneeId = Number(sub.assigneeId ?? s.assigneeId);

  let created;
  try {
    created = await createTask(s.clickupToken, sub.project.listId, {
      name,
      markdown_description,
      assignees: Number.isFinite(assigneeId) && assigneeId > 0 ? [assigneeId] : [],
      tags,
    });
  } catch (e) {
    return { ok: false, stage: 'task', error: errMsg(e) };
  }
  // Comment Mode knows the new task at once: the next note about this block can go on it
  await rememberTask(
    { id: created.id, name, url: created.url, kind: 'single', listId: sub.project.listId, facts: factsFor(sub.page, 'single', [sub.block]) },
    s.spaceId,
  );

  let screenshot = false;
  let screenshotError: string | undefined = sub.screenshotError;
  if (sub.screenshot) {
    try {
      const blob = dataUrlToBlob(sub.screenshot);
      await attachFile(s.clickupToken, created.id, blob, `pointer-${slugify(sub.block.name || 'note')}-${Date.now()}.png`);
      screenshot = true;
      screenshotError = undefined;
    } catch (e) {
      screenshotError = `upload failed: ${errMsg(e)}`;
      console.warn('Pointer: attachment upload failed', e);
    }
  } else if (!screenshotError && !sub.video) {
    // a note with a recording comes without a screenshot, on purpose
    screenshotError = 'no capture';
  }

  // the screen recording, if there is one: after the screenshot, as it's the slower upload
  let video: boolean | undefined;
  let videoError: string | undefined;
  if (sub.video?.dataUrl) {
    try {
      await attachFile(s.clickupToken, created.id, dataUrlToBlob(sub.video.dataUrl), sub.video.name, VIDEO_UPLOAD_MS);
      video = true;
    } catch (e) {
      video = false;
      videoError = `upload failed: ${errMsg(e)}`;
      console.warn('Pointer: video upload failed', e);
    }
  }

  const task: RecentTask = {
    id: created.id,
    url: created.url,
    name,
    createdAt: Date.now(),
    projectLabel: sub.project.label,
    screenshot,
    ...(screenshotError ? { screenshotError } : {}),
    ...(video !== undefined ? { video } : {}),
    ...(videoError ? { videoError } : {}),
  };
  await patchSettings({
    hostProjects: { ...s.hostProjects, [sub.page.projectKey]: sub.project },
    recent: [task, ...s.recent].slice(0, 20),
  });

  return {
    ok: true,
    task,
    rewritten,
    screenshot,
    ...(rewriteError ? { rewriteError } : {}),
    ...(screenshotError ? { screenshotError } : {}),
    ...(video !== undefined ? { video } : {}),
    ...(videoError ? { videoError } : {}),
  };
}

/** Comment Mode: the note goes on an open task as a comment, its screenshot into the task's attachments. */
async function comment(sub: NoteSubmission, task: OpenTask): Promise<CommentResult> {
  const s = await getSettings();
  const missing = missingKeys(s);
  if (missing.length) return { ok: false, stage: 'keys', error: `Missing ${missing.join(' and ')}` };
  const { draft, rewritten, rewriteError }: Composed = sub.edited
    ? { draft: sub.edited, rewritten: sub.rewritten ?? true }
    : await compose(sub, s, 'comment');
  const result = await addComment(
    s,
    task,
    draft,
    { dataUrl: sub.screenshot, ...(sub.screenshotName ? { name: sub.screenshotName } : {}), ...(sub.screenshotError ? { error: sub.screenshotError } : {}) },
    sub.video,
    { rewritten, ...(rewriteError ? { rewriteError } : {}) },
    sub.project.label,
  );
  if (result.ok) {
    const fresh = await getSettings();
    await patchSettings({ hostProjects: { ...fresh.hostProjects, [sub.page.projectKey]: sub.project } });
  }
  return result;
}
