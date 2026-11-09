/**
 * Markup for Pointer's on-page UI, as pure functions of state. Styles live in ui.css;
 * behaviour lives in index.ts. Elements the controller wires up carry `data-action`.
 */
import { clock } from '../shared/format';
import { ENVIRONMENT_LABEL } from '../shared/site';
import type { Environment, Member, MembersResponse, PageTaskItem, ProjectRef, ProjectsResponse, TaskDraft } from '../shared/types';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Lets PascalCase block names wrap between words instead of overflowing the note. */
const wrappable = (name: string): string => esc(name).replace(/([a-z0-9])([A-Z])/g, '$1<wbr>$2');

export const ICONS = {
  target:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="5.25"/><path d="M10 1.75v3M10 15.25v3M1.75 10h3M15.25 10h3"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  alert:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M10 5.5v5.25" stroke="#fdfcfc" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.1" r="1.15" fill="#fdfcfc"/></svg>',
  close:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  comment:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5v-2.5h-.25a1.5 1.5 0 0 1-1-1.5z"/></svg>',
} as const;

/** The shadow root's fixed skeleton. Styles are adopted separately in index.ts. */
export const SHELL = `
<div class="drafts" role="group" aria-label="Notes for this page's task"></div>
<svg class="dock-guide" aria-hidden="true">
  <line class="dock-guide-track"></line>
  <line class="dock-guide-line"></line>
  <g class="dock-guide-mark">
    <g class="dock-guide-pop">
      <circle class="dock-guide-halo" r="16"></circle>
      <circle class="dock-guide-pulse" r="16"></circle>
      <circle class="dock-guide-ripple" r="16"></circle>
      <circle class="dock-guide-ring" r="16"></circle>
      <circle class="dock-guide-dot" r="4.5"></circle>
    </g>
  </g>
</svg>
<canvas class="confetti" aria-hidden="true"></canvas>
<div class="dock">
  <button class="seo-btn" type="button" hidden aria-expanded="false" title="Check this page's SEO">
    <span class="caps">SEO</span>
    <span class="seo-btn-count" hidden></span>
  </button>
  <button class="publish" type="button" hidden>
    <span class="publish-count">0</span>
    <span class="publish-label caps">Publish task</span>
  </button>
  <button class="launcher" type="button" aria-pressed="false">
    <span class="launcher-icon">${ICONS.target}<span class="launcher-badge"></span></span>
    <span class="launcher-label caps">Pointer</span>
    <kbd class="launcher-kbd">Esc</kbd>
  </button>
</div>
<div class="outline outline--block" aria-hidden="true"><span class="outline-tab"></span></div>
<div class="outline outline--element" aria-hidden="true"></div>
<div class="pin" aria-hidden="true"></div>
<section class="note" role="dialog" aria-label="Pointer note"></section>
<section class="note sheet" role="dialog" aria-label="Review the page task"></section>
<section class="note seo" role="dialog" aria-label="SEO check"></section>
<div class="seo-mark" aria-hidden="true"><span class="seo-mark-tab"></span></div>
<div class="toast" role="status" aria-live="polite"></div>
<div class="recbar" role="status" aria-live="polite">
  <span class="recbar-dot" aria-hidden="true"></span>
  <span class="recbar-label">Recording</span>
  <span class="recbar-time">0:00</span>
  <span class="recbar-limit"></span>
  <button class="recbar-stop caps" type="button" title="Stop recording (Esc)">Stop</button>
</div>`;

// ---------- Page task pins ----------

/** One numbered pin per note waiting on the page; its title shows the note. */
export function draftPinsHtml(items: PageTaskItem[]): string {
  return items
    .map((item, i) => {
      const label = esc(`Note ${i + 1}: ${item.note.replace(/\s+/g, ' ').trim()}`);
      return `<button class="draft-pin" type="button" data-item="${esc(item.id)}" title="${label}" aria-label="${label}">${i + 1}</button>`;
    })
    .join('');
}

// ---------- Project picker ----------

export function projectOptionsHtml(o: { selectedId: string; remembered: ProjectRef | null; projects: ProjectsResponse | null }): string {
  const { selectedId, remembered, projects } = o;
  // A project can appear in several groups; only its first appearance is marked, so the
  // open dropdown highlights it where it was picked from.
  let marked = false;
  const option = (p: ProjectRef) => {
    const selected = !marked && p.listId === selectedId;
    if (selected) marked = true;
    return `<option value="${esc(p.listId)}"${selected ? ' selected' : ''}>${esc(p.label)}</option>`;
  };

  let html = `<option value="" disabled${selectedId ? '' : ' selected'}>Choose a project</option>`;
  if (remembered) html += `<optgroup label="Last used on this site">${option(remembered)}</optgroup>`;
  if (!projects) return `${html}<option disabled>Loading projects…</option>`;

  const suggested = projects.suggested.filter((s) => s.listId !== remembered?.listId);
  if (suggested.length) html += `<optgroup label="Suggested from the URL">${suggested.map((p) => option(p)).join('')}</optgroup>`;
  if (projects.all.length) html += `<optgroup label="All projects">${projects.all.map((p) => option(p)).join('')}</optgroup>`;
  else if (projects.error) html += `<option disabled>Couldn't load projects: ${esc(projects.error)}</option>`;
  return html;
}

// ---------- Assignee picker (the note, and the default on the options page) ----------

/**
 * The default person first, then "No one", then everyone else in the workspace.
 * `selectedId` '' means no one. The default's name is taken from the loaded list when
 * possible, so a renamed person shows their current name.
 */
export function assigneeOptionsHtml(o: { selectedId: string; defaultAssignee: Member | null; members: MembersResponse | null }): string {
  const { selectedId, members } = o;
  const defaultAssignee = o.defaultAssignee ? (members?.members.find((m) => m.id === o.defaultAssignee?.id) ?? o.defaultAssignee) : null;
  const option = (value: string, label: string) =>
    `<option value="${esc(value)}"${value === selectedId ? ' selected' : ''}>${esc(label)}</option>`;

  let html = '';
  if (defaultAssignee) html += `<optgroup label="Default">${option(String(defaultAssignee.id), defaultAssignee.name)}</optgroup>`;
  html += option('', 'No one');
  if (!members) return `${html}<option disabled>Loading people…</option>`;
  const others = members.members.filter((m) => m.id !== defaultAssignee?.id);
  if (others.length) html += `<optgroup label="Everyone">${others.map((m) => option(String(m.id), m.name)).join('')}</optgroup>`;
  else if (members.error) html += `<option disabled>Couldn't load people: ${esc(members.error)}</option>`;
  return html;
}

// ---------- Note ----------

export type NoteState = 'edit' | 'busy' | 'review' | 'error';
/**
 * A note that becomes a task, one that joins the page task, one of the page task's notes reopened,
 * or (Comment Mode) one that goes on an open task as a comment.
 */
export type NoteKind = 'task' | 'page-add' | 'page-item' | 'comment';

/** Comment Mode's line in the note: which open task the note goes on, if any. */
export type TargetView =
  | { state: 'off' | 'no-project' }
  | { state: 'no-block' }
  | { state: 'looking' | 'none'; mode: 'block' | 'page' }
  | { state: 'error'; mode: 'block' | 'page'; error: string }
  /** The matched task was closed between finding it and sending. */
  | { state: 'gone'; mode: 'block' | 'page'; name: string }
  | { state: 'found'; mode: 'block' | 'page'; task: { name: string; url: string; status: string }; override: boolean };
export type NoteError = { title: string; detail: string; showOptions: boolean };

export type NoteModel = {
  state: NoteState;
  kind: NoteKind;
  /** The note's number in the page task, for page-item. */
  itemNumber?: number;
  /** null when the click wasn't inside a CMS block */
  blockName: string | null;
  /** Shown as a tag in the header so a live site is never mistaken for staging. */
  environment: Environment;
  elementSelector: string;
  projectOptions: string;
  projectChosen: boolean;
  assigneeOptions: string;
  draft: string;
  /** Screen recording is possible here (a secure page, a browser that can do it). */
  canRecord: boolean;
  /** The recording made for this note, if any, ready to preview. */
  video: { url: string; ms: number; size: number } | null;
  /** A reopened page-task note's recording, which stays as it is. */
  itemVideoMs?: number;
  step: number;
  /** Replaces the step's label while busy, e.g. while checking ClickUp for an open task. */
  busyLabel?: string;
  thumb: string | null;
  review: Review;
  error: NoteError;
  target: TargetView;
};

/**
 * What the review shows: the task as it will go out, and a line about the rewrite when it failed.
 * With `commentOn`, it's a comment on that task: only its text is shown.
 */
export type Review = TaskDraft & { note?: string; commentOn?: string };

// "Writing", not "rewriting": without a Z.ai key the note goes as written
export const STEPS = ['Taking the screenshot', 'Writing the task', 'Creating the task'] as const;
export const PAGE_STEPS = ['Taking the screenshot', 'Adding it to the page task'] as const;
export const COMMENT_STEPS = ['Taking the screenshot', 'Writing the comment', 'Adding the comment'] as const;

const keys = (...names: string[]) => names.map((k) => `<kbd>${k}</kbd>`).join('');
const hint = (names: string[], label: string) => `<span class="hint">${keys(...names)}<span>${label}</span></span>`;

function noteBody(m: NoteModel): string {
  switch (m.state) {
    case 'edit':
      return `<textarea class="note-input" rows="4" placeholder="What's wrong here?" aria-label="What's wrong here?">${esc(m.draft)}</textarea>${mediaHtml(m)}`;

    case 'busy': {
      const steps: readonly string[] = m.kind === 'comment' ? COMMENT_STEPS : m.kind === 'task' ? STEPS : PAGE_STEPS;
      const segments = steps
        .map((_, i) => `<span class="progress-seg${i < m.step ? ' is-done' : i === m.step ? ' is-active' : ''}"></span>`)
        .join('');
      return `<div class="progress" role="status">
          <p class="progress-label">${esc(m.busyLabel ?? steps[m.step] ?? steps[0] ?? '')}…</p>
          <div class="progress-track">${segments}</div>
        </div>${m.thumb ? `<img class="note-thumb" src="${m.thumb}" alt="The screenshot that will be attached">` : ''}`;
    }

    case 'review':
      return `${reviewFields(m.review, m.review.commentOn ? "the screenshot goes in the task's attachments" : 'the screenshot is attached')}
        <div class="actions">
          <button class="btn btn--primary" type="button" data-action="create">${m.review.commentOn ? 'Add comment' : 'Create task'}</button>
          <button class="btn" type="button" data-action="back">Back</button>
        </div>`;

    case 'error':
      return `<div class="alert" role="alert">
          <span class="alert-icon">${ICONS.alert}</span>
          <p class="alert-title">${esc(m.error.title)}</p>
          <p class="alert-detail">${esc(m.error.detail)}</p>
        </div>
        <div class="actions">
          <button class="btn btn--primary" type="button" data-action="retry">Try again</button>
          ${m.error.showOptions ? '<button class="btn" type="button" data-action="options">Open options</button>' : ''}
        </div>`;
  }
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/**
 * Under the note: "Record screen" for things a screenshot can't show, or the recording made for
 * it, playable, with Retake and Remove. A reopened page-task note just says it has one.
 */
function mediaHtml(m: NoteModel): string {
  if (m.kind === 'page-item') {
    return m.itemVideoMs ? `<p class="note-media"><span class="note-video-meta">Has a screen recording (${clock(m.itemVideoMs)})</span></p>` : '';
  }
  if (m.video) {
    return `<div class="note-media has-video">
        <video class="note-video" src="${esc(m.video.url)}" controls muted playsinline preload="metadata" aria-label="The screen recording that will be attached"></video>
        <span class="note-video-meta">Screen recording · ${clock(m.video.ms)} · ${size(m.video.size)}</span>
        <button class="btn btn--small" type="button" data-action="record">Retake</button>
        <button class="note-remove" type="button" data-action="remove-video">Remove</button>
      </div>`;
  }
  if (!m.canRecord) return '';
  return `<div class="note-media">
      <button class="btn btn--small note-record" type="button" data-action="record"><span class="rec-dot" aria-hidden="true"></span>Record screen</button>
      <span class="note-video-meta">For what a screenshot can't show, like a glitch.</span>
    </div>`;
}

/** The task's name and its whole description, editable, exactly as ClickUp will get them. */
export function reviewFields(r: Review, attachments: string): string {
  const name = r.commentOn
    ? `<p class="review-on">${ICONS.comment}<span>A comment on <b>${esc(r.commentOn)}</b></span></p>`
    : `<label class="field">
      <span class="field-label">Task name</span>
      <textarea class="field-input review-title" rows="1">${esc(r.name)}</textarea>
    </label>`;
  return `${r.note ? `<p class="review-note" role="status">${esc(r.note)}</p>` : ''}
    ${name}
    <label class="field">
      <span class="field-label">${r.commentOn ? 'Comment' : 'Description'}</span>
      <textarea class="field-input review-description" rows="8" spellcheck="false">${esc(r.description)}</textarea>
      <span class="field-help">Exactly what goes to ClickUp, ${r.commentOn ? 'as plain text' : 'in Markdown'}; ${attachments}${r.commentOn ? '' : ' separately'}.</span>
    </label>`;
}

/** The review before a page task is published: one sheet above the dock. */
export function sheetHtml(r: Review & { notes: number }): string {
  const notes = `${r.notes} ${r.notes === 1 ? 'note' : 'notes'}`;
  return `<header class="note-head">
      <div class="note-top">
        <p class="note-block"><span class="note-pin" aria-hidden="true"></span><span>Review the page task</span></p>
        <span class="note-num">${notes}</span>
        <button class="note-close" type="button" data-action="sheet-back" aria-label="Back to the page" title="Back (Esc)">${ICONS.close}</button>
      </div>
    </header>
    <div class="note-body">
      ${reviewFields(r, r.notes === 1 ? 'its screenshot is attached' : 'their screenshots are attached')}
      <div class="actions">
        <button class="btn btn--primary" type="button" data-action="sheet-publish">Publish task</button>
        <button class="btn" type="button" data-action="sheet-back">Back</button>
      </div>
    </div>
    <footer class="note-foot">${hint(['Ctrl', 'Enter'], 'Publish task')}${hint(['Esc'], 'Back, notes kept')}</footer>`;
}

const SEND_LABEL: Record<NoteKind, string> = {
  task: 'Create task',
  'page-add': 'Add to page task',
  'page-item': 'Save note',
  comment: 'Add comment',
};

/** Comment Mode's line under the pickers. Empty when the mode is off or there's nothing to say yet. */
export function targetHtml(t: TargetView): string {
  const line = (text: string) => `<p class="target">${ICONS.comment}<span>${text}</span></p>`;
  const where = (mode: 'block' | 'page') => (mode === 'block' ? 'on this block' : 'for this page');
  // what happens instead of a comment: a new task, or the note waits for Publish task
  const otherwise = (mode: 'block' | 'page') => (mode === 'block' ? 'this makes a new task' : 'this note waits for Publish task');
  switch (t.state) {
    case 'off':
    case 'no-project':
      return '';
    case 'no-block':
      return line('No block here to match an open task, so this makes a new task.');
    case 'looking':
      return line(`Looking for an open task ${where(t.mode)}…`);
    case 'none':
      return line(`No open task ${where(t.mode)} yet, so ${otherwise(t.mode)}.`);
    case 'error':
      return line(`Couldn't check for an open task (${esc(t.error)}), so ${otherwise(t.mode)}.`);
    case 'gone':
      return line(`“${esc(t.name)}” was closed in the meantime, so ${otherwise(t.mode)}.`);
    case 'found': {
      const task = `<a class="target-task" href="${esc(t.task.url)}" target="_blank" rel="noopener">${esc(t.task.name)}</a>`;
      const status = t.task.status ? ` <span class="target-status">${esc(t.task.status)}</span>` : '';
      if (!t.override) {
        const instead = t.mode === 'block' ? 'New task instead' : 'Keep for a new page task';
        return `<p class="target is-found">${ICONS.comment}<span>Adds a comment to ${task}${status}</span><button class="target-switch" type="button" data-action="target-new">${instead}</button></p>`;
      }
      const now = t.mode === 'block' ? 'Makes a new task' : 'Waits for Publish task';
      return `<p class="target">${ICONS.comment}<span>${now}, not a comment on ${task}.</span><button class="target-switch" type="button" data-action="target-comment">Comment instead</button></p>`;
    }
  }
}

export function noteFoot(state: NoteState, kind: NoteKind): string {
  switch (state) {
    case 'edit': {
      const keys = `${hint(['Enter'], SEND_LABEL[kind])}${hint(['Shift', 'Enter'], 'New line')}${hint(['Esc'], 'Cancel')}`;
      return kind === 'page-item' ? `${keys}<button class="note-remove" type="button" data-action="remove">Remove note</button>` : keys;
    }
    case 'review':
      return `${hint(['Ctrl', 'Enter'], kind === 'comment' ? 'Add comment' : 'Create task')}${hint(['Esc'], 'Back')}`;
    case 'error':
      return 'Your note is kept.';
    case 'busy':
      return '';
  }
}

export function noteHtml(m: NoteModel): string {
  const name = m.blockName ? wrappable(m.blockName) : 'No block found here';
  const foot = noteFoot(m.state, m.kind);
  const num = m.kind === 'page-item' && m.itemNumber ? `<span class="note-num">Note ${m.itemNumber}</span>` : '';
  // where and who can only change while writing
  const locked = m.state === 'edit' ? '' : ' disabled';
  // Nothing can be closed mid-send, so the button only exists outside that state.
  const close =
    m.state === 'busy'
      ? ''
      : `<button class="note-close" type="button" data-action="close" aria-label="Close note" title="Close (Esc)">${ICONS.close}</button>`;
  return `<header class="note-head">
      <div class="note-top">
        <p class="note-block${m.blockName ? '' : ' is-none'}" title="${esc(m.elementSelector)}"><span class="note-pin" aria-hidden="true"></span><span>${name}</span></p>
        ${num}<span class="note-env note-env--${m.environment}" title="${m.environment === 'production' ? 'This is the live site' : 'Not the live site'}">${ENVIRONMENT_LABEL[m.environment]}</span>
        ${close}
      </div>
      <div class="note-pickers">
        <select class="note-select note-project${m.projectChosen ? '' : ' is-empty'}" aria-label="ClickUp project"${locked}>${m.projectOptions}</select>
        <select class="note-select note-assignee" aria-label="Assignee"${locked || (m.kind === 'comment' ? ' disabled' : '')}>${m.assigneeOptions}</select>
      </div>
      ${m.state === 'edit' && m.kind !== 'page-item' ? `<div class="note-target" aria-live="polite">${targetHtml(m.target)}</div>` : ''}
    </header>
    <div class="note-body">${noteBody(m)}</div>
    ${foot ? `<footer class="note-foot">${foot}</footer>` : ''}`;
}

// ---------- Toast ----------

export type ToastModel = {
  title: string;
  icon?: 'check' | 'alert';
  /** One short line each, under the title. */
  meta?: string[];
  link?: string;
  undo?: boolean;
};

export function toastHtml(t: ToastModel): string {
  const icon = t.icon ? `<span class="toast-icon toast-icon--${t.icon}">${ICONS[t.icon]}</span>` : '';
  const meta = (t.meta ?? []).map((line) => `<span class="toast-meta">${esc(line)}</span>`).join('');
  const link = t.link ? `<a class="toast-link" href="${esc(t.link)}" target="_blank" rel="noopener">Open in ClickUp</a>` : '';
  const undo = t.undo
    ? '<button class="toast-undo caps" type="button" data-action="undo">Undo</button><span class="toast-timer" aria-hidden="true"></span>'
    : '';
  return `${icon}<span class="toast-text"><span class="toast-title">${esc(t.title)}</span>${meta}</span>${link}${undo}`;
}
