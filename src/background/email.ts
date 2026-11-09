/**
 * Send to ClickUp in Gmail and HubSpot, the background half. GLM splits the email (zai.ts); the
 * rules in shared/email.ts and shared/routing.ts group and route the points. The page script
 * builds the descriptions (it knows the file names) and, once the tasks exist, uploads their files
 * one per message (email-attach), so no file waits in this worker, which the browser may stop at
 * any time.
 */
import { attachFile, createTask, deleteTask, VIDEO_UPLOAD_MS } from './clickup';
import { dataUrlToBlob } from './blob';
import { getMembers } from './members';
import { getProjects, recognizeProject } from './projects';
import { effectiveZaiKey, getSettings, missingKeys, patchSettings } from './settings';
import { splitEmail } from './zai';
import { dueTimestamp, isOurDomain, planTasks, routeAssignees, sanitizeSplit, senderKey, teamDomains, ticketIsUrgent, type EmailPayload, type EmailSplit } from '../shared/email';
import { ROUTING } from '../shared/routing';
import { isHubSpotFileHost, memberByName } from '../shared/hubspot';
import type { CreatedTask, EmailPrepareResponse, EmailPublish, EmailPublishResult, Member, ProjectRef, RecentTask, SentEmails } from '../shared/types';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Messages already sent to ClickUp, kept by message id (and no content). The oldest go past this many. */
const SENT_KEY = 'emailSent';
const SENT_MAX = 1000;

const EMPTY: EmailSplit = { client: null, points: [], questions: [], decorative: [] };

/** The person whose name a member id has, from the team list, else the given fallback. */
async function member(token: string, id: number, fallback: string): Promise<Member | null> {
  if (!(id > 0)) return null;
  try {
    const found = (await getMembers(token)).find((m) => m.id === id);
    if (found) return found;
  } catch {
    // the name is only for the review; the id is what counts
  }
  return { id, name: fallback || `User ${id}` };
}

/** The ClickUp person a HubSpot ticket's owner is (by name), or null. */
async function ticketOwner(token: string, name: string): Promise<Member | null> {
  if (!name.trim()) return null;
  try {
    return memberByName(name, await getMembers(token));
  } catch {
    return null;
  }
}

export async function prepareEmail(email: EmailPayload): Promise<EmailPrepareResponse> {
  const s = await getSettings();
  const missing = missingKeys(s);
  if (missing.length) return { ok: false, stage: 'keys', error: `Missing ${missing.join(' and ')}` };
  // asked for while GLM reads, so the review's project picker is ready when it answers
  const projects: Promise<{ all: ProjectRef[]; error?: string }> = getProjects(s.clickupToken, s.spaceId).then(
    (all) => ({ all }),
    (e) => ({ all: [], error: errMsg(e) }),
  );

  let split: EmailSplit | null = null;
  let unsplit: string | undefined;
  const key = effectiveZaiKey(s);
  if (!key) unsplit = 'no Z.ai key';
  else {
    try {
      split = sanitizeSplit(await splitEmail(key, email), email);
      if (!split) unsplit = 'the model reply was not usable';
    } catch (e) {
      unsplit = errMsg(e);
    }
  }

  const { all, error } = await projects;
  const open = email.messages.filter((m) => !m.context);
  const latest = open.at(-1) ?? email.messages.at(-1);
  // HubSpot shows a sender's name only: the ticket's contact stands in for the address
  const sender = senderKey(latest?.from.email || email.ticket?.contact.email || '');
  // the team's own people write about every project: their domain is never one client's
  const ours = isOurDomain(sender, teamDomains({ email: s.clickupUser?.email, footerCredit: s.footerCredit }));
  const saved = sender && !ours ? s.domainProjects[sender] : undefined;
  // a remembered project that's gone from ClickUp doesn't count; while ClickUp can't be asked, trust it
  const remembered = saved && (!all.length || all.some((p) => p.listId === saved.listId)) ? (all.find((p) => p.listId === saved.listId) ?? saved) : null;
  const recognized = recognizeProject(
    {
      subject: email.subject,
      text: [...open.map((m) => m.text), ...(split?.points ?? []).flatMap((p) => [p.instruction, ...p.pages, p.component ?? ''])].join('\n'),
      senderDomain: sender && !sender.includes('@') && !ours ? sender : '',
      client: split?.client ?? null,
      ...(email.ticket ? { company: email.ticket.company, subjectIs: "the ticket's name" } : {}),
    },
    all,
  );
  // the email naming a project (its subject, a link to the site) beats the sender's last choice;
  // weaker hints only fill in when nothing is remembered
  const suggested = recognized && (recognized.strong || !remembered) ? recognized.project : remembered;

  // With a coding agent as the default assignee (bid's Mate is one), the routes split the work:
  // the agent gets clear, small changes, a person the rest: the token's owner, unless the token is
  // the agent's own. Without one, every task goes to the default assignee.
  const agentId = s.codingAgent ? s.assigneeId : '';
  const ownerId = String(s.clickupUser?.id ?? '');
  const ids = routeAssignees({ defaultId: s.assigneeId, ownerId, mateId: agentId });
  const nameOf = (id: string) => (id === s.assigneeId ? s.assigneeName : id === ownerId ? (s.clickupUser?.username ?? '') : '');
  const [mate, you, mateAccount, owner] = await Promise.all([
    member(s.clickupToken, Number(ids.mate), nameOf(ids.mate)),
    member(s.clickupToken, Number(ids.person), nameOf(ids.person)),
    member(s.clickupToken, Number(agentId), s.assigneeName),
    ticketOwner(s.clickupToken, email.ticket?.owner ?? ''),
  ]);
  // a HubSpot ticket's owner, when ClickUp has them, gets what the agent shouldn't take
  const person = owner && String(owner.id) !== agentId ? owner : you;
  const reporter = s.clickupUser?.username || s.clickupUser?.email || undefined;
  // a ticket HubSpot marks High or Urgent makes every task high priority
  const rules = { ...ROUTING, agent: Boolean(agentId) };
  const plans = split ? planTasks(split, rules).map((p) => (ticketIsUrgent(email) ? { ...p, priority: 'high' as const } : p)) : [];

  return {
    ok: true,
    split: split ?? EMPTY,
    plans,
    ...(unsplit !== undefined ? { unsplit } : {}),
    assignees: { mate, person, mateAccount, ...(person && person === owner ? { owner: true } : {}) },
    ...(reporter ? { reporter } : {}),
    projects: {
      all,
      suggested,
      sure: Boolean(remembered && suggested?.listId === remembered.listId),
      remembered,
      recognized: recognized ? { listId: recognized.project.listId, why: recognized.why, strong: recognized.strong } : null,
      rememberable: Boolean(sender) && !ours,
      ...(error ? { error } : {}),
    },
    senderKey: sender,
  };
}

async function loadSent(): Promise<SentEmails> {
  const { [SENT_KEY]: sent } = await chrome.storage.local.get(SENT_KEY);
  return (sent as SentEmails | undefined) ?? {};
}

async function rememberSent(messageIds: string[], tasks: CreatedTask[]) {
  if (!messageIds.length) return;
  const sent = await loadSent();
  const at = Date.now();
  for (const id of messageIds) sent[id] = { at, tasks };
  const kept = Object.entries(sent)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, SENT_MAX);
  await chrome.storage.local.set({ [SENT_KEY]: Object.fromEntries(kept) });
}

async function forgetSent(messageIds: string[]) {
  if (!messageIds.length) return;
  const sent = await loadSent();
  for (const id of messageIds) delete sent[id];
  await chrome.storage.local.set({ [SENT_KEY]: sent });
}

/** Makes the tasks, one after another. A token ClickUp refuses stops it at the first one. */
export async function publishEmail(p: EmailPublish): Promise<EmailPublishResult> {
  const s = await getSettings();
  if (!s.clickupToken.trim()) return { ok: false, stage: 'keys', error: 'Missing ClickUp token' };
  const created: (CreatedTask & { index: number })[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const [index, t] of p.tasks.entries()) {
    const name = t.name.replace(/\s+/g, ' ').trim() || 'Task from an email';
    const assignee = Number(t.assigneeId);
    try {
      const task = await createTask(s.clickupToken, p.project.listId, {
        name,
        markdown_description: t.description,
        assignees: Number.isFinite(assignee) && assignee > 0 ? [assignee] : [],
        tags: t.tags,
        ...(t.priority === 'high' ? { priority: 2 } : {}),
        ...(t.due ? { due_date: dueTimestamp(t.due), due_date_time: false } : {}),
      });
      created.push({ id: task.id, url: task.url, name, index });
    } catch (e) {
      failed.push({ name, error: errMsg(e) });
      if (!created.length && /ClickUp 40[13]\b/.test(errMsg(e))) break;
    }
  }
  if (!created.length) return { ok: false, stage: 'task', error: failed[0]?.error ?? 'No tasks were created' };

  const fresh = await getSettings();
  const now = Date.now();
  const recent: RecentTask[] = created.map((c) => ({
    id: c.id,
    url: c.url,
    name: c.name,
    createdAt: now,
    projectLabel: p.project.label,
    screenshot: false,
    email: { files: 0, missing: 0, ...(p.app ? { app: p.app } : {}) },
  }));
  await patchSettings({
    domainProjects:
      p.remember && p.senderKey && !isOurDomain(p.senderKey, teamDomains({ email: fresh.clickupUser?.email, footerCredit: fresh.footerCredit }))
        ? { ...fresh.domainProjects, [p.senderKey]: p.project }
        : fresh.domainProjects,
    recent: [...recent, ...fresh.recent].slice(0, 20),
  });
  await rememberSent(
    p.messageIds,
    created.map(({ id, url, name }) => ({ id, url, name })),
  );
  return { ok: true, created, failed };
}

/** One file onto one task; the options page's Recent tasks counts what made it. */
export async function attachEmailFile(taskId: string, name: string, dataUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSettings();
  let error: string | undefined;
  try {
    await attachFile(s.clickupToken, taskId, dataUrlToBlob(dataUrl), name, VIDEO_UPLOAD_MS);
  } catch (e) {
    error = `${name}: ${errMsg(e)}`;
  }
  const fresh = await getSettings();
  await patchSettings({
    recent: fresh.recent.map((r) =>
      r.id === taskId && r.email && !r.commentId
        ? { ...r, email: { files: r.email.files + (error ? 0 : 1), missing: r.email.missing + (error ? 1 : 0), ...(error ? { error } : r.email.error ? { error: r.email.error } : {}) } }
        : r,
    ),
  });
  return error ? { ok: false, error } : { ok: true };
}

/** Undo: the tasks go, and the messages count as not sent again. */
export async function undoEmail(taskIds: string[], messageIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSettings();
  const errors: string[] = [];
  for (const id of taskIds) {
    try {
      await deleteTask(s.clickupToken, id);
    } catch (e) {
      // already gone is what Undo wanted anyway
      if (!/ClickUp 404\b/.test(errMsg(e))) errors.push(errMsg(e));
    }
  }
  await forgetSent(messageIds);
  const fresh = await getSettings();
  await patchSettings({ recent: fresh.recent.filter((r) => !taskIds.includes(r.id)) });
  return errors.length ? { ok: false, error: errors[0] ?? 'Not every task could be deleted' } : { ok: true };
}

/** Bigger files than this aren't copied; the description still names them. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`;
}

/**
 * A file an email shows that its page can't read itself: in Gmail an image from outside Gmail
 * (Google's image proxy, a website), fetched without cookies; in HubSpot a file on a server that
 * doesn't allow HubSpot's page to read it, fetched with the person's HubSpot session.
 */
export async function fetchFile(url: string, cookies = false): Promise<{ dataUrl: string } | { error: string }> {
  if (!/^https:\/\//i.test(url)) return { error: 'not an https address' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: ac.signal, credentials: cookies && isHubSpotFileHost(url) ? 'include' : 'omit' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    if (Number(res.headers.get('content-length')) > MAX_FILE_BYTES) return { error: 'larger than 25 MB' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) return { error: 'larger than 25 MB' };
    return { dataUrl: bytesToDataUrl(bytes, (res.headers.get('content-type') ?? '').split(';')[0] ?? '') };
  } catch (e) {
    return { error: e instanceof Error && e.name === 'AbortError' ? 'timed out' : errMsg(e) };
  } finally {
    clearTimeout(timer);
  }
}
