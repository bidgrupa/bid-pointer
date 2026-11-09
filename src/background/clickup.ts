import type { Member, ProjectRef } from '../shared/types';

const API = 'https://api.clickup.com/api/v2';

type List = { id: string; name: string };
type Folder = { id: string; name: string; lists: List[] };

/** A call that hasn't answered in this long fails, instead of keeping Pointer (and the person) waiting. */
const TIMEOUT_MS = 20_000;

async function cu<T>(token: string, path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { Authorization: token.trim() };
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error(`ClickUp didn't answer within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });
  let res: Response;
  let text: string;
  try {
    res = await Promise.race([fetch(API + path, { ...init, headers, signal: ac.signal }), late]);
    text = await Promise.race([res.text(), late]);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = JSON.parse(text) as { err?: string; error?: string; ECODE?: string };
      detail = j.err ?? j.error ?? '';
    } catch {
      detail = text.slice(0, 120);
    }
    throw new Error(`ClickUp ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function whoAmI(token: string): Promise<{ id: number; username: string; email: string }> {
  const r = await cu<{ user: { id: number; username: string; email: string } }>(token, '/user');
  return r.user;
}

/**
 * Projects inside the DEVELOPMENT space: for a folder, its "Development" list
 * (or every list if it has none); folderless lists are projects themselves.
 * `scopes` maps each project's list to every list in its folder: tasks move on from
 * Development (to QA, say), and Comment Mode still has to find them there.
 */
export async function fetchProjects(token: string, spaceId: string): Promise<{ projects: ProjectRef[]; scopes: Record<string, string[]> }> {
  const [f, l] = await Promise.all([
    cu<{ folders: Folder[] }>(token, `/space/${spaceId}/folder?archived=false`),
    cu<{ lists: List[] }>(token, `/space/${spaceId}/list?archived=false`),
  ]);
  const projects: ProjectRef[] = [];
  const scopes: Record<string, string[]> = {};
  for (const folder of f.folders ?? []) {
    const fname = folder.name.trim();
    const lists = folder.lists ?? [];
    const siblings = lists.map((x) => x.id);
    const dev = lists.find((x) => /^development$/i.test(x.name.trim()));
    const own = dev ? [{ id: dev.id, name: 'Development' }] : lists.map((x) => ({ id: x.id, name: x.name.trim() }));
    for (const li of own) {
      projects.push({ listId: li.id, label: `${fname} › ${li.name}` });
      scopes[li.id] = siblings;
    }
  }
  for (const li of l.lists ?? []) {
    projects.push({ listId: li.id, label: li.name.trim() });
    scopes[li.id] = [li.id];
  }
  return { projects: projects.sort((a, b) => a.label.localeCompare(b.label)), scopes };
}

type TeamMember = { user?: { id?: number; username?: string | null; email?: string | null } };

/** Everyone in the workspaces the token can see, by name. Pending invites without a name fall back to their email. */
export async function fetchMembers(token: string): Promise<Member[]> {
  const r = await cu<{ teams?: { members?: TeamMember[] }[] }>(token, '/team');
  const byId = new Map<number, Member>();
  for (const team of r.teams ?? []) {
    for (const { user } of team.members ?? []) {
      const name = user?.username?.trim() || user?.email?.trim();
      if (user?.id && name) byId.set(user.id, { id: user.id, name });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'hr'));
}

export type CreatedTask = { id: string; url: string; name: string };

export async function createTask(
  token: string,
  listId: string,
  body: {
    name: string;
    markdown_description: string;
    assignees: number[];
    tags: string[];
    /** 1 urgent, 2 high, 3 normal, 4 low; left out means none. */
    priority?: number;
    /** ms; with due_date_time false ClickUp shows only the date. */
    due_date?: number;
    due_date_time?: boolean;
  },
): Promise<CreatedTask> {
  return cu<CreatedTask>(token, `/list/${listId}/task`, { method: 'POST', body: JSON.stringify(body) });
}

/** Uploads a file to a task. A few MB can take a while on a slow connection, so it waits longer than a call. */
export async function attachFile(token: string, taskId: string, blob: Blob, filename: string, timeoutMs = 60_000): Promise<void> {
  const fd = new FormData();
  fd.append('attachment', blob, filename);
  await cu(token, `/task/${taskId}/attachment`, { method: 'POST', body: fd }, timeoutMs);
}

/** A screen recording is the biggest thing Pointer uploads. */
export const VIDEO_UPLOAD_MS = 120_000;

export async function deleteTask(token: string, taskId: string): Promise<void> {
  await cu(token, `/task/${taskId}`, { method: 'DELETE' });
}

/** A task as the list endpoint returns it, with only what Comment Mode reads. */
/** A task as ClickUp lists it, with only what Comment Mode reads. */
export type ListedTask = {
  id: string;
  name: string;
  url: string;
  status?: { status?: string; type?: string };
  date_closed?: string | null;
  date_updated?: string;
  archived?: boolean;
  tags?: { name?: string }[];
  list?: { id?: string };
  text_content?: string;
  description?: string;
};

/**
 * Open and tagged "pointer". The tag is checked here too, in case the API ever ignores the
 * filter; "done" statuses aren't "closed" to the API's filter, but they set date_closed.
 */
export function isOpenPointerTask(t: ListedTask): boolean {
  const tagged = !t.tags || t.tags.some((tag) => tag.name?.toLowerCase() === 'pointer');
  return tagged && !t.date_closed && !t.archived && t.status?.type !== 'closed' && t.status?.type !== 'done';
}

export async function fetchTeamIds(token: string): Promise<string[]> {
  const r = await cu<{ teams?: { id: string | number }[] }>(token, '/team');
  return (r.teams ?? []).map((t) => String(t.id));
}

export type SpaceRef = { spaceId: string; label: string };

/** Every space in the workspaces the token can see, labelled "Workspace › Space", for the options page. */
export async function fetchSpaces(token: string): Promise<SpaceRef[]> {
  const r = await cu<{ teams?: { id: string | number; name?: string }[] }>(token, '/team');
  const perTeam = await Promise.all(
    (r.teams ?? []).map(async (team) => {
      const s = await cu<{ spaces?: { id: string | number; name: string }[] }>(token, `/team/${team.id}/space?archived=false`);
      return (s.spaces ?? []).map((space) => ({ spaceId: String(space.id), label: `${team.name?.trim() || 'Workspace'} › ${space.name.trim()}` }));
    }),
  );
  return perTeam.flat();
}

/** How many pages (of 100) of open Pointer tasks to read before giving up on the oldest. */
const MAX_PAGES = 5;

/** Every open task tagged "pointer" in a space, in one filtered query, most recently updated first. */
export async function fetchOpenPointerTasks(token: string, teamId: string, spaceId: string): Promise<ListedTask[]> {
  const out: ListedTask[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    // ClickUp spells array filters with bare brackets (tags[]=…); URLSearchParams would encode them
    const query = ['tags[]=pointer', `space_ids[]=${encodeURIComponent(spaceId)}`, 'include_closed=false', 'subtasks=true', 'order_by=updated', `page=${page}`].join('&');
    const r = await cu<{ tasks?: ListedTask[]; last_page?: boolean }>(token, `/team/${teamId}/task?${query}`);
    const tasks = r.tasks ?? [];
    out.push(...tasks.filter(isOpenPointerTask));
    if (r.last_page === true || tasks.length < 100) break;
  }
  return out;
}

export async function fetchTask(token: string, taskId: string): Promise<ListedTask> {
  return cu<ListedTask>(token, `/task/${taskId}`);
}

/** Comments take plain text. Returns the new comment's id. */
export async function createComment(token: string, taskId: string, text: string): Promise<string> {
  const r = await cu<{ id: string | number }>(token, `/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: text, notify_all: false }),
  });
  return String(r.id);
}

export async function deleteComment(token: string, commentId: string): Promise<void> {
  await cu(token, `/comment/${commentId}`, { method: 'DELETE' });
}
