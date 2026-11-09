/**
 * Send to ClickUp, in Gmail and in HubSpot's Help Desk: a gold button in the app's own row of
 * buttons (an adapter, MailApp, says where and reads the page) turns the open emails into ClickUp
 * tasks. GLM splits them into points, as it rewrites notes; rules group and route the points
 * (shared/email.ts, shared/routing.ts); and every image and file in the email goes onto the tasks.
 * With "Review the rewrite" on, the tasks are shown first. Without it they're made straight away,
 * once Pointer knows the sender's project. Nothing is read or sent anywhere until the button is
 * pressed.
 */
import css from './mail.css';
import buttonCss from './button.css';
import { h, ICON } from './dom';
import { shown, type PendingFile, type Reading } from './read';
import { dataUrlToBlob } from '../background/blob';
import { adoptStyles, installFonts } from '../content/shadow';
import {
  buildEmailDescription,
  buildFallbackDescription,
  draftTasks,
  dueLabel,
  inheritAssignees,
  isoDate,
  isImage,
  previewLines,
  type EmailPayload,
  type EmailTaskDraft,
} from '../shared/email';
import { formatDate } from '../shared/format';
import type { CreatedTask, EmailPrepareResponse, EmailPublishResult, InitResponse, Member, MembersResponse, Msg, ProjectRef, SentEmails } from '../shared/types';

const UNDO_MS = 10_000;
const SEND_TIMEOUT_MS = 90_000;
/** GLM reads the whole email (zai.ts gives it 90 s) while ClickUp lists the projects. */
const PREPARE_TIMEOUT_MS = 150_000;
/** A big attachment on a slow line; the background gives each upload 2 minutes. */
const ATTACH_TIMEOUT_MS = 150_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** How long a split is kept, so reopening the review doesn't ask GLM again. */
const SESSION_MS = 30 * 60_000;

/** Where the button goes, while the page has emails to send. */
export type Spot = {
  /** The element the button goes into ('append'), or right before ('before'). */
  anchor: HTMLElement;
  place: 'append' | 'before';
  /** The app's own button to copy the size and type from; null to find one in the row. */
  reference: HTMLElement | null;
  /** The messages that count: when all are in ClickUp already, the button says so. */
  ids: string[];
};

/** An app the button works in: where it goes, how the emails are read and their files fetched. */
export type MailApp = {
  /** As messages name it: "Reload Gmail". */
  name: string;
  /** What the button sends, for its tooltip: "the expanded emails". */
  what: string;
  find(): Spot | null;
  /** The emails, as they are when the button is pressed; null when they're gone. */
  read(o: { sent: Set<string>; again: boolean; ours: readonly string[] }): Reading | null;
  /** One of the email's files, downloaded the way the app itself does; throws with a short reason. */
  download(f: PendingFile): Promise<Blob>;
};

/** The app this page is, for messages; set by bootMail. */
let appName = 'the page';

const staleSteps = () =>
  `Pointer was updated, but the browser is still running the old version. Open the extensions page (edge://extensions or chrome://extensions; about:addons in Firefox), reload bid Pointer, then reload ${appName}.`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Promise form only: Firefox's `browser.runtime.sendMessage` doesn't take a callback. */
async function send<T>(msg: Msg, timeoutMs = SEND_TIMEOUT_MS): Promise<T> {
  let timer = 0;
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`The extension stopped answering. Reload ${appName} and try again.`)), timeoutMs);
  });
  try {
    return (await Promise.race([chrome.runtime.sendMessage(msg), late])) as T;
  } catch (e) {
    throw new Error(e instanceof Error && e.message ? e.message : `Extension unavailable. Reload ${appName}.`);
  } finally {
    window.clearTimeout(timer);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(blob);
  });
}

// ---------- Files: downloaded the way the app itself does (MailApp.download) ----------

type Fetched = { blob: Blob } | { error: string };

/** Downloads as the page: with the app's own cookies, and from servers that allow the app's origin. */
export { pageFetch } from '../content/pagefetch';

/** A downloaded file, or why it isn't one. */
export function checkFile(blob: Blob): Blob {
  if (!blob.size) throw new Error('empty file');
  if (/^text\/html/i.test(blob.type)) throw new Error(`${appName} sent a page instead of the file`);
  if (blob.size > MAX_FILE_BYTES) throw new Error('larger than 25 MB');
  return blob;
}

/**
 * A file the page may not read itself (another site's image, or a server that doesn't allow the
 * app's origin): the extension's background downloads it. `cookies` sends the person's own
 * session along, which the background only does for HubSpot's servers.
 */
export async function viaBackground(url: string, cookies = false): Promise<Blob> {
  const r = await send<{ dataUrl?: string; error?: string }>({ type: 'pointer:fetch-file', url, ...(cookies ? { cookies: true } : {}) });
  if (!r.dataUrl) throw new Error(r.error ?? 'not downloaded');
  return checkFile(dataUrlToBlob(r.dataUrl));
}

async function fetchFile(app: MailApp, f: PendingFile): Promise<Fetched> {
  try {
    if (/^data:/i.test(f.url)) return { blob: dataUrlToBlob(f.url) };
    return { blob: await app.download(f) };
  } catch (e) {
    return { error: errMsg(e) };
  }
}

/** Every file, three at a time; `onEach` hears about each one as it's done. */
async function fetchAll(app: MailApp, files: PendingFile[], onEach: () => void = () => {}): Promise<Map<number, Fetched>> {
  const out = new Map<number, Fetched>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      if (!f) continue;
      out.set(f.n, await fetchFile(app, f));
      onEach();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' };

/** Final file names: the real type's extension for unnamed inline images, and no two alike. */
function finalNames(reading: Reading, fetched: Map<number, Fetched>): EmailPayload {
  const used = new Set<string>();
  const files = reading.payload.files.map((f) => {
    const got = fetched.get(f.n);
    const type = got && 'blob' in got ? got.blob.type : '';
    let name = f.name;
    if (f.kind === 'inline' && /^image-\d+\.png$/.test(name) && EXT[type]) name = name.replace(/png$/, EXT[type] ?? 'png');
    let unique = name;
    for (let i = 2; used.has(unique.toLowerCase()); i++) unique = name.replace(/(\.[^.]+)?$/, `-${i}$1`);
    used.add(unique.toLowerCase());
    return { ...f, name: unique, mime: type || f.mime };
  });
  return { ...reading.payload, files };
}

// ---------- The button in the app's row ----------

type ButtonView = {
  host: HTMLElement;
  button: HTMLButtonElement;
  icon: HTMLElement;
  label: HTMLElement;
  anchor: HTMLElement;
  place: Spot['place'];
  /** Sized like the app's own buttons yet (it waits until they're laid out). */
  matched: boolean;
};

/** The row's button to copy the look from: the last one with words on it (Gmail's Forward), else any. */
function referenceButton(row: HTMLElement, host: HTMLElement): HTMLElement | null {
  const all = Array.from(row.querySelectorAll<HTMLElement>('[role="link"], [role="button"], button, .ams')).filter(
    (el) => !host.contains(el) && !el.contains(host) && shown(el),
  );
  const outer = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  const worded = outer.filter((el) => (el.textContent ?? '').trim().length > 1 && el.getBoundingClientRect().width > 40);
  return worded.at(-1) ?? outer.at(-1) ?? null;
}

type Row = EmailTaskDraft & {
  include: boolean;
  /** Takes the first task's person (see inheritAssignees) until someone picks one for it. */
  followsFirst: boolean;
  /** The description was typed in, so changing files or dates doesn't rebuild it any more. */
  edited: boolean;
  /** The files offered for it in the review (attached or not). */
  offered: number[];
  /** The deadline as the client gave it, while the date is still theirs. */
  said: { date: string; said: string } | null;
  /** For the whole email as one task: why it wasn't split. */
  unsplit?: string;
};

type Prepared = Extract<EmailPrepareResponse, { ok: true }>;

type Session = {
  key: string;
  at: number;
  reading: Reading;
  prepared: Prepared;
  fetched: Map<number, Fetched>;
  /** The review's state, kept when it's closed so reopening brings the edits back. */
  rows?: Row[];
  project?: ProjectRef | null;
};

type ToastSpec = {
  title: string;
  icon?: 'check' | 'alert' | 'busy';
  meta?: string[];
  links?: { label: string; url: string }[];
  actions?: { label: string; run: (button: HTMLButtonElement) => void }[];
  undo?: () => void;
  /** Stays until it's replaced or closed. */
  sticky?: boolean;
  /** A progress bar along the bottom (moved with toastProgress). */
  bar?: boolean;
  ms?: number;
};

const hint = (keys: string[], label: string) => h('span', { class: 'hint' }, ...keys.map((k) => h('kbd', { text: k })), label);

// ---------- Progress: reading, copying the files, GLM's split ----------

type StepView = { row: HTMLElement; icon: HTMLElement; detail: HTMLElement };

function setStep(s: StepView, state: 'waiting' | 'active' | 'done') {
  s.row.classList.toggle('is-active', state === 'active');
  s.row.classList.toggle('is-done', state === 'done');
  s.icon.replaceChildren(...(state === 'done' ? [ICON.check()] : state === 'active' ? [ICON.spinner()] : []));
}

/**
 * The steps between pressing the button and the tasks, with one bar. GLM's split takes a while
 * (about 15 s), so the bar keeps easing forward on time until it's in, and never claims 100% early.
 */
class ProgressView {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fileStep: StepView | null;
  private readonly splitStep: StepView;
  private filesDone = 0;
  private splitIn = false;
  private finished = false;
  private readonly from = performance.now();
  private timer = 0;
  /** Also drawn in the toast, when there's no review open to show it in. */
  onTick: ((percent: number, label: string) => void) | null = null;

  constructor(
    private readonly files: number,
    emails: number,
    images: boolean,
  ) {
    const step = (label: string, detail: string, state: 'waiting' | 'active' | 'done'): StepView => {
      const icon = h('span', { class: 'mail-step-icon' });
      const detailEl = h('span', { class: 'mail-step-detail', text: detail });
      const view = { row: h('li', { class: 'mail-step' }, icon, h('span', { text: label }), detailEl), icon, detail: detailEl };
      setStep(view, state);
      return view;
    };
    const read = step(emails === 1 ? 'Read the email' : `Read ${emails} emails`, '', 'done');
    this.fileStep = files ? step(`Copying ${count(files, images ? 'image' : 'file')}`, `0 of ${files}`, 'active') : null;
    this.splitStep = step('Splitting it into tasks', 'usually about 15 seconds', 'active');
    this.bar = h('span');
    this.el = h(
      'div',
      { class: 'mail-progress', attrs: { role: 'status' } },
      h('p', { class: 'mail-progress-title', text: 'Getting the tasks ready…' }),
      h('ol', { class: 'mail-steps' }, read.row, this.fileStep?.row ?? null, this.splitStep.row),
      h('div', { class: 'mail-bar', attrs: { 'aria-hidden': 'true' } }, this.bar),
    );
  }

  start() {
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 200);
  }

  fileDone() {
    this.filesDone++;
    if (!this.fileStep) return;
    this.fileStep.detail.textContent = `${this.filesDone} of ${this.files}`;
    if (this.filesDone >= this.files) setStep(this.fileStep, 'done');
  }

  splitDone() {
    this.splitIn = true;
    setStep(this.splitStep, 'done');
    this.splitStep.detail.textContent = '';
  }

  finish() {
    this.finished = true;
    this.tick();
    this.stop();
  }

  stop() {
    window.clearInterval(this.timer);
  }

  label(): string {
    if (!this.splitIn) return 'Splitting the email into tasks…';
    return this.files && this.filesDone < this.files ? `Copying files (${this.filesDone} of ${this.files})…` : 'Almost ready…';
  }

  private percent(): number {
    if (this.finished) return 100;
    const fileShare = this.files ? 14 : 0;
    const splitShare = 90 - fileShare;
    const seconds = (performance.now() - this.from) / 1000;
    const split = this.splitIn ? splitShare : splitShare * Math.min(0.95, 1 - Math.exp(-seconds / 7));
    const files = this.files ? (fileShare * this.filesDone) / this.files : 0;
    return Math.min(99, 6 + files + split);
  }

  private tick() {
    const percent = this.percent();
    this.bar.style.width = `${percent}%`;
    if (!this.splitIn && performance.now() - this.from > 25_000) this.splitStep.detail.textContent = 'taking longer than usual';
    this.onTick?.(percent, this.label());
  }
}

// ---------- A calendar under a date chip ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * A small calendar under a date chip, in the sheet. Pointer draws its own: the browser's date
 * picker, anchored to a field in Pointer's overlay, doesn't reliably open inside Gmail. The month
 * starts on Monday; arrows move a day or a week, Esc or a press elsewhere closes it. Picks a
 * YYYY-MM-DD date, or null for none. Returns what closes it.
 */
function openCalendar(frame: HTMLElement, anchor: HTMLElement, value: string | null, pick: (date: string | null) => void): () => void {
  const todayIso = isoDate(new Date());
  const shown = value ? new Date(`${value}T12:00:00`) : new Date();
  let year = shown.getFullYear();
  let month = shown.getMonth();
  const plus = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return isoDate(d);
  };

  const label = h('span', { class: 'mail-cal-month' });
  const grid = h('div', { class: 'mail-cal-grid', attrs: { role: 'grid' } });
  const prev = h('button', { class: 'mail-icon-button', attrs: { type: 'button', 'data-cal': 'prev', 'aria-label': 'Previous month' } }, ICON.chevronLeft());
  const next = h('button', { class: 'mail-icon-button', attrs: { type: 'button', 'data-cal': 'next', 'aria-label': 'Next month' } }, ICON.chevronRight());
  const quick = (text: string, date: string | null, cls = '') => h('button', { class: cls, attrs: { type: 'button' }, text, on: { click: () => done(date) } });
  const el = h(
    'div',
    { class: 'mail-cal', attrs: { role: 'dialog', 'aria-label': 'Due date' } },
    h('div', { class: 'mail-cal-head' }, prev, label, next),
    grid,
    h('div', { class: 'mail-cal-quick' }, quick('Today', plus(0)), quick('Tomorrow', plus(1)), quick('In a week', plus(7)), quick('No due date', null, 'is-clear')),
  );

  const render = (focus?: string) => {
    label.textContent = `${MONTHS[month]} ${year}`;
    const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
    const target = focus ?? (value && value.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) ? value : isoDate(new Date(year, month, 1)));
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(year, month, 1 - lead + i);
      const iso = isoDate(d);
      const cls = ['mail-cal-day', d.getMonth() === month ? '' : 'is-other', iso === todayIso ? 'is-today' : '', iso === value ? 'is-picked' : ''].filter(Boolean).join(' ');
      return h('button', {
        class: cls,
        attrs: { type: 'button', 'data-date': iso, 'aria-label': dueLabel(iso), 'aria-pressed': String(iso === value), tabindex: iso === target ? '0' : '-1' },
        text: String(d.getDate()),
      });
    });
    grid.replaceChildren(...WEEKDAYS.map((d) => h('span', { class: 'mail-cal-dow', text: d })), ...days);
    if (focus) grid.querySelector<HTMLElement>(`[data-date="${focus}"]`)?.focus();
  };
  const shift = (months: number) => {
    const d = new Date(year, month + months, 1);
    year = d.getFullYear();
    month = d.getMonth();
    render();
  };
  prev.addEventListener('click', () => shift(-1));
  next.addEventListener('click', () => shift(1));
  grid.addEventListener('click', (e) => {
    const date = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
    if (date) done(date);
  });
  grid.addEventListener('keydown', (e) => {
    const date = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (!date || !step) return;
    e.preventDefault();
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + step);
    year = d.getFullYear();
    month = d.getMonth();
    render(isoDate(d));
  });
  // Esc closes the calendar only, not the sheet around it
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
    anchor.focus();
  });
  const outside = (e: Event) => {
    const path = e.composedPath();
    if (!path.includes(el) && !path.includes(anchor)) close();
  };
  const scroller = frame.querySelector('.mail-body');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    frame.removeEventListener('pointerdown', outside, true);
    scroller?.removeEventListener('scroll', close);
    el.remove();
    anchor.setAttribute('aria-expanded', 'false');
  };
  const done = (date: string | null) => {
    close();
    pick(date);
    anchor.focus();
  };

  render();
  frame.append(el);
  frame.addEventListener('pointerdown', outside, true);
  scroller?.addEventListener('scroll', close, { passive: true });
  // under the chip, its right edge at the chip's; above it when the sheet has no room below
  const f = frame.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const c = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, a.right - f.left - c.width), f.width - c.width - 8);
  const below = a.bottom - f.top + 6;
  const top = below + c.height > f.height - 8 ? a.top - f.top - c.height - 6 : below;
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, top)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  grid.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  return close;
}

/** The review's frame: nearly the whole window, over the dimmed app. */
type Sheet = {
  el: HTMLElement;
  backdrop: HTMLElement;
  title: HTMLElement;
  count: HTMLElement;
  /** The header's right side: the project picker. */
  side: HTMLElement;
  notes: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  /** What Esc, the × and a click beside the sheet do. */
  onClose: () => void;
};

function copyQuestions(button: HTMLButtonElement, questions: { quote: string }[]) {
  navigator.clipboard.writeText(questions.map((q) => `- ${q.quote}`).join('\n')).then(
    () => {
      button.textContent = 'Copied';
    },
    () => {
      button.textContent = "Couldn't copy";
    },
  );
}

class MailPointer {
  private overlay: { host: HTMLElement; root: ShadowRoot; toast: HTMLElement } | null = null;
  private readonly views = new Set<ButtonView>();
  private sheet: Sheet | null = null;
  private toastTimer = 0;
  /** The toast's progress bar and title, while it shows one. */
  private toastBar: { bar: HTMLElement; title: HTMLElement } | null = null;
  /** Reading, splitting, creating or attaching: the button waits. */
  private busy = false;
  private sent: SentEmails = {};
  private session: Session | null = null;
  private queued = false;
  private init: InitResponse | null = null;

  constructor(private readonly app: MailApp) {
    installFonts();
    // the app changes the page all the time and says nothing; look again shortly after it does
    new MutationObserver(() => this.schedule()).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    window.addEventListener('hashchange', () => this.schedule());
    chrome.storage.local.get('emailSent').then(
      (r) => {
        this.sent = (r.emailSent as SentEmails | undefined) ?? {};
        this.schedule();
      },
      () => {},
    );
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.emailSent) return;
      this.sent = (changes.emailSent.newValue as SentEmails | undefined) ?? {};
      this.schedule();
    });
    this.schedule();
  }

  private schedule() {
    if (this.queued) return;
    this.queued = true;
    window.setTimeout(() => {
      this.queued = false;
      this.sync();
    }, 250);
  }

  /** The button shows in the app's row while there are emails to send (MailApp.find). */
  private sync() {
    for (const v of this.views) if (!v.host.isConnected) this.views.delete(v);
    const spot = this.app.find();
    const active = spot ? this.viewFor(spot) : null;
    for (const v of this.views) v.host.hidden = v !== active;
    if (!active || !spot) return;
    if (!active.matched) this.matchNeighbour(active, spot.reference);
    const sent = spot.ids.length > 0 && spot.ids.every((id) => this.sent[id]);
    this.render(active, this.busy ? 'busy' : sent ? 'sent' : 'ready');
  }

  /** Still where it was put: in the row, or right before the anchor. */
  private placed(v: ButtonView): boolean {
    return v.place === 'append' ? v.host.parentElement === v.anchor : v.host.nextElementSibling === v.anchor;
  }

  private viewFor(spot: Spot): ButtonView {
    for (const v of this.views) if (v.anchor === spot.anchor && this.placed(v)) return v;
    // the app re-rendered around it: the same button moves back into place
    const moved = [...this.views].find((v) => v.anchor === spot.anchor);
    if (moved) {
      if (spot.place === 'append') spot.anchor.append(moved.host);
      else spot.anchor.before(moved.host);
      return moved;
    }
    const host = h('span', { attrs: { 'data-bid-pointer': 'send-to-clickup' } });
    const root = host.attachShadow({ mode: 'open' });
    adoptStyles(root, buttonCss);
    const icon = h('span', { class: 'icon' }, ICON.pin());
    const label = h('span', { class: 'label', text: 'Send to ClickUp' });
    const button = h('button', { class: 'send', attrs: { type: 'button' } }, icon, label);
    root.append(button);
    // the app listens on the row (Gmail's Reply and shortcuts, HubSpot's menus): Pointer's clicks and keys stay Pointer's
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress'] as const) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    button.addEventListener('click', (e) => {
      e.preventDefault();
      void this.start({});
    });
    if (spot.place === 'append') spot.anchor.append(host);
    else spot.anchor.before(host);
    const view: ButtonView = { host, button, icon, label, anchor: spot.anchor, place: spot.place, matched: false };
    this.views.add(view);
    return view;
  }

  private render(v: ButtonView, state: 'ready' | 'busy' | 'sent') {
    if (v.button.dataset.state === state) return;
    v.button.dataset.state = state;
    v.button.disabled = state === 'busy';
    v.button.setAttribute('aria-busy', String(state === 'busy'));
    v.button.classList.toggle('is-sent', state === 'sent');
    v.icon.replaceChildren(state === 'busy' ? ICON.spinner() : state === 'sent' ? ICON.check() : ICON.pin());
    v.label.textContent = state === 'sent' ? 'Sent to ClickUp' : 'Send to ClickUp';
    v.button.title =
      state === 'sent'
        ? 'These emails are in ClickUp already. Click to see the tasks, or to send them again.'
        : state === 'busy'
          ? 'Sending to ClickUp…'
          : `Turn ${this.app.what} into ClickUp tasks`;
  }

  /** Same height, shape, type and spacing as the app's own buttons in the row; the gold stays. */
  private matchNeighbour(v: ButtonView, reference: HTMLElement | null) {
    const row = v.host.parentElement;
    const ref = reference ?? (row ? referenceButton(row, v.host) : null);
    if (!ref || !row) return;
    const r = ref.getBoundingClientRect();
    if (r.height < 16) return; // not laid out yet: the next change tries again
    const cs = getComputedStyle(ref);
    const b = v.button.style;
    b.height = `${Math.round(r.height)}px`;
    b.borderRadius = cs.borderRadius;
    b.borderWidth = cs.borderTopWidth;
    b.fontFamily = cs.fontFamily;
    b.fontSize = cs.fontSize;
    b.fontWeight = cs.fontWeight;
    b.letterSpacing = cs.letterSpacing;
    b.lineHeight = cs.lineHeight;
    // the right padding is the app's; the left one holds the pin like Gmail's holds its arrows
    const right = parseFloat(cs.paddingRight);
    if (right >= 8 && right <= 32) {
      b.paddingRight = `${right}px`;
      b.paddingLeft = `${Math.max(8, Math.round(right * 0.75))}px`;
    }
    const glyph = ref.querySelector('svg, img')?.getBoundingClientRect();
    if (glyph && glyph.width >= 12 && glyph.width <= 28) {
      v.icon.style.width = `${Math.round(glyph.width)}px`;
      v.icon.style.height = `${Math.round(glyph.width)}px`;
    }
    // the gap the app leaves between its buttons, unless the row spaces them itself
    if (!(parseFloat(getComputedStyle(row).columnGap) > 0)) {
      const gap = Math.max(parseFloat(cs.marginLeft) || 0, parseFloat(cs.marginRight) || 0, 8);
      const margin = (el: Element | null, side: 'marginLeft' | 'marginRight') => (el ? parseFloat(getComputedStyle(el)[side]) || 0 : 0);
      const prev = v.host.previousElementSibling;
      if (v.place === 'append' || prev) v.host.style.marginLeft = `${Math.max(0, gap - margin(prev, 'marginRight'))}px`;
      if (v.place === 'before') v.host.style.marginRight = `${Math.max(0, gap - margin(v.anchor, 'marginLeft'))}px`;
    }
    v.matched = true;
  }

  // ---------- Sending ----------

  private async start(o: { again?: boolean; whole?: boolean }) {
    if (this.sheet) {
      this.sheet.el.querySelector<HTMLElement>('input, select, button')?.focus();
      return;
    }
    if (this.busy) return;
    const spot = this.app.find();
    if (!spot) return;
    let init: InitResponse;
    try {
      init = await send<InitResponse>({ type: 'pointer:init', projectKey: location.host });
    } catch (e) {
      this.toast({ title: "Pointer isn't answering", icon: 'alert', meta: [errMsg(e)], ms: 8000 });
      return;
    }
    this.init = init;
    if (init.build && init.build !== __POINTER_BUILD__) {
      this.toast({ title: 'Pointer needs reloading', icon: 'alert', meta: [staleSteps()], ms: 15_000 });
      return;
    }
    if (init.missing.includes('ClickUp token')) {
      this.toast(this.setupToast());
      return;
    }
    const ids = spot.ids;
    if (!o.again && !o.whole && ids.length && ids.every((id) => this.sent[id])) {
      this.showSent(ids);
      return;
    }
    try {
      await this.run(init, o);
    } catch (e) {
      this.toast({ title: "The email wasn't sent to ClickUp", icon: 'alert', meta: [errMsg(e)], ms: 10_000 });
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(on: boolean) {
    this.busy = on;
    this.sync();
  }

  private setupToast(): ToastSpec {
    return {
      title: 'Finish setting up Pointer',
      icon: 'alert',
      meta: ['Pointer needs a few things on its settings page before it can make tasks.'],
      actions: [{ label: 'Set up', run: () => void send({ type: 'pointer:open-options' }).catch(() => {}) }],
      ms: 10_000,
    };
  }

  private async run(init: InitResponse, o: { again?: boolean; whole?: boolean }) {
    const reading = this.app.read({ sent: new Set(Object.keys(this.sent)), again: Boolean(o.again || o.whole), ours: init.ours });
    if (!reading?.payload.messages.length) return;
    const key = [...reading.payload.messages.map((m) => `${m.id}:${m.context ?? ''}:${m.text.length}`), reading.files.length].join('|');
    let s = this.session && this.session.key === key && Date.now() - this.session.at < SESSION_MS ? this.session : null;
    this.setBusy(true);
    // with review on, the sheet opens at once and shows the progress; otherwise the toast does
    let sheet: Sheet | null = null;
    if (!s) {
      const open = reading.payload.messages.filter((m) => !m.context).length;
      const progress = new ProgressView(reading.files.length, open, reading.files.every(isImage));
      let closed = false;
      if (init.reviewBeforeSend) {
        this.hideToast();
        sheet = this.openSheet(reading.payload, false);
        sheet.body.replaceChildren(h('div', { class: 'mail-loading' }, progress.el));
        sheet.footer.replaceChildren(h('div', { class: 'mail-hints' }, hint(['Esc'], 'Close; the tasks wait for the next press')));
        sheet.onClose = () => {
          closed = true;
          this.closeSheet();
        };
      } else {
        this.toast({ title: progress.label(), icon: 'busy', sticky: true, bar: true });
        progress.onTick = (percent, label) => this.toastProgress(percent, label);
      }
      progress.start();
      const fetching = fetchAll(this.app, reading.files, () => progress.fileDone());
      let prepared: EmailPrepareResponse;
      try {
        prepared = await send<EmailPrepareResponse>({ type: 'pointer:email-prepare', email: reading.payload }, PREPARE_TIMEOUT_MS);
      } catch (e) {
        progress.stop();
        throw e;
      }
      if (!prepared.ok) {
        progress.stop();
        if (sheet && this.sheet === sheet) this.closeSheet();
        this.toast(prepared.stage === 'keys' ? this.setupToast() : { title: "The email couldn't be read", icon: 'alert', meta: [prepared.error], ms: 10_000 });
        return;
      }
      progress.splitDone();
      const fetched = await fetching;
      progress.finish();
      s = { key, at: Date.now(), reading, prepared, fetched };
      // a split that failed isn't kept: pressing the button again asks GLM again
      this.session = prepared.unsplit === undefined ? s : null;
      if (closed) {
        if (this.session) this.toast({ title: 'The tasks are ready', icon: 'check', meta: ['Press Send to ClickUp again to see them.'], ms: 8000 });
        return;
      }
    }
    const payload = finalNames(s.reading, s.fetched);
    if (o.whole) s.rows = this.rows(payload, s, 'Pointer found no separate tasks in it');
    s.rows ??= this.rows(payload, s);
    if (!s.rows.length) {
      if (sheet && this.sheet === sheet) this.closeSheet();
      this.nothingToDo(s);
      return;
    }

    const p = s.prepared;
    let project = s.project !== undefined ? s.project : p.projects.suggested;
    let rows = s.rows.filter((r) => r.include);
    // review on, a sender Pointer hasn't met, or an email pointing away from the sender's usual project: show first
    if (init.reviewBeforeSend || !p.projects.sure || !project) {
      this.setBusy(false);
      this.hideToast();
      const full = init.reviewBeforeSend;
      const frame = sheet && this.sheet === sheet ? sheet : this.openSheet(payload, !full);
      const reviewed = await this.review(frame, s, payload, project ?? null, full);
      if (!reviewed) return;
      ({ project, rows } = reviewed);
      this.setBusy(true);
    }
    if (project && rows.length) await this.publish(s, payload, project, rows);
  }

  /** The tasks to show and send, from the split (or the whole email as one task). */
  private rows(payload: EmailPayload, s: Session, unsplit?: string): Row[] {
    const p = s.prepared;
    const reason = unsplit ?? p.unsplit;
    const available = payload.files.map((f) => f.n).filter((n) => 'blob' in (s.fetched.get(n) ?? { error: '' }));
    const drafts = draftTasks({
      email: payload,
      split: p.split,
      plans: p.plans,
      ...(reason !== undefined ? { unsplit: reason } : {}),
      available,
      assignees: { mate: p.assignees.mate ? String(p.assignees.mate.id) : '', person: p.assignees.person ? String(p.assignees.person.id) : '' },
      ...(p.reporter ? { reporter: p.reporter } : {}),
    });
    return drafts.map((d, i) => {
      const due = reason === undefined ? (p.plans[i]?.due ?? null) : null;
      return {
        ...d,
        include: true,
        followsFirst: i > 0,
        edited: false,
        offered: [...d.files],
        said: due,
        ...(reason !== undefined ? { unsplit: reason } : {}),
      };
    });
  }

  /** A task's description again, after its files, priority or due date changed in the review. */
  private describe(row: Row, payload: EmailPayload, p: Prepared): string {
    const reporter = p.reporter ? { reporter: p.reporter } : {};
    if (row.unsplit !== undefined) return buildFallbackDescription({ email: payload, reason: row.unsplit, attached: row.files, priority: row.priority, ...reporter });
    const points = row.points.flatMap((id) => p.split.points.find((x) => x.id === id) ?? []);
    const due = row.due ? { date: row.due, said: row.said?.date === row.due ? row.said.said : '' } : null;
    return buildEmailDescription({ email: payload, points, priority: row.priority, due, attached: row.files, ...reporter });
  }

  private nothingToDo(s: Session) {
    const questions = s.prepared.split.questions;
    this.toast({
      title: 'No tasks in this email',
      icon: 'check',
      meta: [
        questions.length ? `It asks ${count(questions.length, 'question')} instead:` : 'Pointer found nothing to do in it.',
        ...questions.slice(0, 3).map((q) => `“${q.quote}”`),
      ],
      actions: [
        ...(questions.length ? [{ label: 'Copy', run: (b: HTMLButtonElement) => copyQuestions(b, questions) }] : []),
        { label: 'Send as one task', run: () => void this.start({ whole: true }) },
      ],
      sticky: true,
    });
  }

  private async publish(s: Session, payload: EmailPayload, project: ProjectRef, rows: Row[]) {
    const jobsPlanned = rows.reduce((sum, r) => sum + r.files.length, 0);
    // the bar: creating the tasks is the first part (all of it without files), attaching the rest
    const createShare = jobsPlanned ? 35 : 90;
    this.toast({ title: `Creating ${count(rows.length, 'task')} in ${project.label}…`, icon: 'busy', sticky: true, bar: true });
    this.toastProgress(8, `Creating ${count(rows.length, 'task')} in ${project.label}…`);
    const messageIds = payload.messages.filter((m) => !m.context && m.id).map((m) => m.id);
    // the sender's usual project is remembered; one the email itself named isn't (it may be a one-off)
    const named = s.prepared.projects.recognized;
    const remember = s.prepared.projects.rememberable && !(named?.strong && named.listId === project.listId);
    const r = await send<EmailPublishResult>({
      type: 'pointer:email-publish',
      publish: {
        project,
        senderKey: s.prepared.senderKey,
        remember,
        tasks: rows.map((d) => ({ name: d.name, description: d.description, assigneeId: d.assigneeId, priority: d.priority, due: d.due, tags: d.tags })),
        messageIds,
        ...(payload.app ? { app: payload.app } : {}),
      },
    });
    if (!r.ok) {
      const title = r.stage === 'keys' ? 'Finish setting up Pointer' : "The tasks weren't created";
      this.toast({ title, icon: 'alert', meta: [r.error, 'Press Send to ClickUp to try again; your review is kept.'], ms: 12_000 });
      return;
    }
    this.toastProgress(createShare, jobsPlanned ? 'Attaching files to the tasks…' : 'Done');

    // then the files, one at a time, onto each task that has them
    const jobs = r.created.flatMap((task) => (rows[task.index]?.files ?? []).map((n) => ({ task, n })));
    const problems = new Set<string>();
    let done = 0;
    for (const job of jobs) {
      done++;
      const file = payload.files.find((f) => f.n === job.n);
      const got = s.fetched.get(job.n);
      if (!file || !got) continue;
      if ('error' in got) {
        problems.add(`${file.name}: ${got.error}`);
        continue;
      }
      this.toastProgress(createShare + ((100 - createShare) * (done - 1)) / jobs.length, `Attaching files to the tasks (${done} of ${jobs.length})…`);
      try {
        const res = await send<{ ok: boolean; error?: string }>(
          { type: 'pointer:email-attach', taskId: job.task.id, name: file.name, dataUrl: await blobToDataUrl(got.blob) },
          ATTACH_TIMEOUT_MS,
        );
        if (!res.ok) problems.add(res.error ?? `${file.name}: not attached`);
      } catch (e) {
        problems.add(`${file.name}: ${errMsg(e)}`);
      }
    }
    // files that never downloaded, which no task got
    for (const [n, got] of s.fetched) {
      const file = payload.files.find((f) => f.n === n);
      if (file && 'error' in got) problems.add(`${file.name}: ${got.error}`);
    }
    this.session = null;
    this.created(r.created, project, s, payload, [...problems], r.failed, messageIds);
  }

  private created(
    tasks: (CreatedTask & { index: number })[],
    project: ProjectRef,
    s: Session,
    payload: EmailPayload,
    problems: string[],
    failed: { name: string; error: string }[],
    messageIds: string[],
  ) {
    const questions = s.prepared.split.questions;
    const unsplit = s.rows?.find((r) => r.unsplit !== undefined)?.unsplit;
    const meta = [
      ...(failed.length ? [`${count(failed.length, 'task')} not created: ${failed[0]?.error}`] : []),
      ...(problems.length ? [`${count(problems.length, 'file')} not attached. ${problems[0]}`] : []),
      ...(payload.messages.some((m) => m.clipped) ? [`${this.app.name} clipped a long message, so only the part it shows was read.`] : []),
      ...(unsplit !== undefined ? [`Sent as one task: ${unsplit}.`] : []),
      ...(questions.length ? [`To answer: ${questions.map((q) => `“${q.quote}”`).join(' ')}`] : []),
    ];
    const ids = tasks.map((t) => t.id);
    this.toast({
      title: `${count(tasks.length, 'task')} created in ${project.label}`,
      icon: 'check',
      meta,
      links: tasks.slice(0, 4).map((t) => ({ label: t.name, url: t.url })),
      actions: questions.length ? [{ label: 'Copy questions', run: (b) => copyQuestions(b, questions) }] : [],
      undo: () => void this.undo(ids, messageIds),
      ms: questions.length || problems.length || failed.length ? 20_000 : UNDO_MS,
    });
  }

  private async undo(taskIds: string[], messageIds: string[]) {
    this.toast({ title: `Deleting ${count(taskIds.length, 'task')}…`, icon: 'busy', sticky: true });
    try {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'pointer:email-undo', taskIds, messageIds });
      if (!r.ok) throw new Error(r.error ?? 'No answer from the extension');
      this.toast({ title: taskIds.length === 1 ? 'Task deleted' : 'Tasks deleted', icon: 'check', ms: 3000 });
    } catch (e) {
      this.toast({ title: "Couldn't delete every task", icon: 'alert', meta: [errMsg(e)], ms: 8000 });
    }
  }

  /** Every expanded email is in ClickUp already: say where, and offer to send it again. */
  private showSent(ids: string[]) {
    const records = ids.flatMap((id) => this.sent[id] ?? []).sort((a, b) => b.at - a.at);
    const tasks = [...new Map(records.flatMap((r) => r.tasks).map((t) => [t.id, t])).values()];
    const at = records[0]?.at;
    this.toast({
      title: 'Already in ClickUp',
      icon: 'check',
      meta: [`Sent${at ? ` on ${formatDate(new Date(at))}` : ''} as ${count(tasks.length, 'task')}.`],
      links: tasks.slice(0, 4).map((t) => ({ label: t.name, url: t.url })),
      actions: [{ label: 'Send again', run: () => void this.start({ again: true }) }],
      ms: 12_000,
    });
  }

  // ---------- Review ----------

  /** The review's frame: nearly the whole window over the dimmed app, with what was read in its header. */
  private openSheet(payload: EmailPayload, compact: boolean): Sheet {
    const overlay = this.mount();
    this.closeSheet();
    const open = payload.messages.filter((m) => !m.context);
    const latest = open.at(-1) ?? payload.messages.at(-1);
    const context = payload.messages.length - open.length;
    const title = h('span', { text: compact ? 'Which ClickUp project?' : 'Send to ClickUp' });
    const countEl = h('span', { class: 'note-num', attrs: { hidden: true } });
    const close = h('button', { class: 'note-close mail-close', attrs: { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' } }, ICON.close());
    const side = h('div', { class: 'mail-head-side' });
    const notes = h('div', { class: 'mail-warnings', attrs: { hidden: true } });
    const body = h('div', { class: 'mail-body' });
    const footer = h('footer', { class: 'mail-foot' });
    const from = h(
      'p',
      { class: 'mail-from', attrs: { title: payload.subject } },
      'From ',
      h('b', { text: latest?.from.name || latest?.from.email || 'the client' }),
      latest?.dateText ? ` · ${latest.dateText}` : '',
      open.length > 1 ? ` · ${open.length} emails` : '',
      context ? ` · ${count(context, 'earlier message')} for context` : '',
      payload.ticket?.id ? ` · Ticket #${payload.ticket.id}` : '',
      payload.subject ? `${payload.ticket?.id ? ':' : ' ·'} ${payload.subject}` : '',
    );
    const el = h(
      'section',
      { class: `mail-sheet${compact ? ' is-compact' : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send to ClickUp', tabindex: '-1' } },
      h(
        'header',
        { class: 'mail-head' },
        h('div', { class: 'mail-head-main' }, h('p', { class: 'mail-title' }, h('span', { class: 'note-pin', attrs: { 'aria-hidden': 'true' } }), title, countEl), from),
        side,
      ),
      close,
      notes,
      body,
      footer,
    );
    const backdrop = h('div', { class: 'mail-backdrop' });
    const sheet: Sheet = { el, backdrop, title, count: countEl, side, notes, body, footer, onClose: () => this.closeSheet() };
    close.addEventListener('click', () => sheet.onClose());
    backdrop.addEventListener('click', () => sheet.onClose());
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      sheet.onClose();
    });
    overlay.root.append(backdrop, el);
    this.sheet = sheet;
    el.focus({ preventScroll: true });
    return sheet;
  }

  private closeSheet() {
    this.sheet?.el.remove();
    this.sheet?.backdrop.remove();
    this.sheet = null;
  }

  /**
   * The tasks before they're made, in the sheet. With review on, everything can change: names,
   * descriptions, people, priority, due dates, files, and any task can be left out. Each task is one
   * row: name, person, priority and due date on a line, then what it asks for, folded into a short
   * summary until its description is opened. With review off, only the project is asked for, the
   * first time a sender is met. Resolves null when closed.
   */
  private async review(sheet: Sheet, s: Session, payload: EmailPayload, suggested: ProjectRef | null, full: boolean): Promise<{ project: ProjectRef; rows: Row[] } | null> {
    const p = s.prepared;
    const rows = s.rows ?? [];
    sheet.el.classList.toggle('is-compact', !full);
    sheet.title.textContent = full ? 'Send to ClickUp' : 'Which ClickUp project?';

    // where the tasks go
    const projectSelect = h('select', { class: 'note-select note-project', attrs: { 'aria-label': 'ClickUp project' } });
    const projects = [...p.projects.all];
    if (suggested && !projects.some((x) => x.listId === suggested.listId)) projects.unshift(suggested);
    projectSelect.append(h('option', { attrs: { value: '' }, text: projects.length ? 'Choose a ClickUp project' : 'No projects loaded' }));
    for (const x of projects) projectSelect.append(h('option', { attrs: { value: x.listId }, text: x.label }));
    projectSelect.value = suggested?.listId ?? '';
    const projectOf = () => projects.find((x) => x.listId === projectSelect.value) ?? null;
    const sender = p.senderKey.includes('@') ? p.senderKey : `@${p.senderKey}`;
    const { recognized, remembered } = p.projects;
    const projectHelp = h('p', { class: 'field-help mail-project-why' });
    const explain = () => {
      const chosen = projectSelect.value;
      let text = '';
      if (p.projects.error) text = `ClickUp's projects didn't load: ${p.projects.error}`;
      else if (recognized && chosen === recognized.listId) {
        text = `Recognized: ${recognized.why}.`;
        if (remembered && remembered.listId !== chosen) text += ` The last choice for ${sender} was ${remembered.label}.`;
      } else if (remembered && chosen === remembered.listId) text = `The project last chosen for ${sender}.`;
      else if (chosen && p.projects.rememberable) text = `Remembered for ${sender} from now on.`;
      else if (!chosen) text = recognized ? '' : "Pointer couldn't tell which project this is.";
      projectHelp.textContent = text;
      projectHelp.hidden = !text;
    };
    explain();
    sheet.side.replaceChildren(projectSelect, projectHelp);

    // people: the tasks after the first take its person until someone picks one for them
    const members = new Map<string, string>();
    for (const m of [p.assignees.mate, p.assignees.person, p.assignees.mateAccount]) if (m) members.set(String(m.id), m.name);
    const personSelects: { select: HTMLSelectElement; row: Row }[] = [];
    const fillPeople = (select: HTMLSelectElement, value: string) => {
      select.replaceChildren(h('option', { attrs: { value: '' }, text: 'No one' }), ...[...members].map(([id, name]) => h('option', { attrs: { value: id }, text: name })));
      select.value = members.has(value) ? value : '';
    };
    const mateId = p.assignees.mateAccount ? String(p.assignees.mateAccount.id) : '';
    const mateName = p.assignees.mateAccount?.name ?? 'Mate';
    const inherit = () => {
      const ids = inheritAssignees(rows, mateId);
      rows.forEach((row, i) => {
        row.assigneeId = ids[i] ?? row.assigneeId;
      });
    };
    if (full) inherit();
    const whyLines: (() => void)[] = [];
    const whyParts = (row: Row, i: number): (Node | string)[] => {
      const owner = p.assignees.owner ? ", the ticket's owner" : '';
      const suggestedName = row.route === 'mate' ? (p.assignees.mate?.name ?? 'the default assignee') : `${p.assignees.person?.name ?? 'you'}${p.assignees.person ? owner : ''}`;
      const reasons = row.reasons.length ? ` (${row.reasons.join('; ')})` : '';
      if (row.followsFirst) {
        const same = row.route === 'mate' || !mateId ? 'Same person as task 1.' : `Same person as task 1, unless that's ${mateName}.`;
        return [h('b', { text: same }), ` Suggested: ${suggestedName}${reasons}`];
      }
      const others = i === 0 && rows.some((r) => r.followsFirst) ? '. The other tasks get this person too, until you pick someone for them.' : '';
      return [h('b', { text: `Suggested: ${suggestedName}` }), `${reasons}${others}`];
    };

    const create = h('button', { class: 'btn btn--primary', attrs: { type: 'button' } });
    const cancel = h('button', { class: 'btn', attrs: { type: 'button' }, text: 'Cancel' });
    const refresh = () => {
      const n = rows.filter((r) => r.include).length;
      sheet.count.hidden = false;
      sheet.count.textContent = count(n, 'task');
      create.textContent = n ? `Create ${count(n, 'task')}` : 'Nothing to create';
      create.disabled = !n || !projectSelect.value;
      projectSelect.classList.toggle('is-empty', !projectSelect.value);
    };
    projectSelect.addEventListener('change', () => {
      s.project = projectOf();
      explain();
      refresh();
    });

    const failedFiles = payload.files.filter((f) => 'error' in (s.fetched.get(f.n) ?? { error: '' }));
    const unsplit = rows.find((r) => r.unsplit !== undefined)?.unsplit;
    const warnings = [
      ...(unsplit !== undefined ? [`The email wasn't split into tasks (${unsplit}), so it's one task with the whole text. Edit it here, or send it as it is.`] : []),
      ...(payload.messages.some((m) => m.clipped) ? [`${this.app.name} clipped a long message, so only the part it shows was read.`] : []),
      ...(failedFiles.length
        ? [`${count(failedFiles.length, 'file')} couldn't be copied from ${this.app.name}: ${failedFiles.map((f) => f.name).join(', ')}. ${(s.fetched.get(failedFiles[0]?.n ?? 0) as { error?: string } | undefined)?.error ?? ''}`]
        : []),
    ];
    sheet.notes.replaceChildren(...warnings.map((w) => h('p', { class: 'review-note', text: w })));
    sheet.notes.hidden = !warnings.length;

    const fileChip = (row: Row, n: number, rebuild: () => void) => {
      const f = payload.files.find((x) => x.n === n);
      if (!f) return null;
      const thumb = s.reading.files.find((x) => x.n === n)?.thumb;
      const box = h('input', { attrs: { type: 'checkbox', 'aria-label': `Attach ${f.name}` } });
      box.checked = row.files.includes(n);
      const pic = isImage(f) && thumb ? h('img', { class: 'mail-file-pic', attrs: { src: thumb, alt: '' } }) : h('span', { class: 'mail-file-pic' }, ICON.file());
      const chip = h(
        'label',
        { class: 'mail-file', attrs: { title: f.name } },
        box,
        pic,
        h('span', { class: 'mail-file-name', text: f.name }),
        h('span', { class: 'mail-file-tick' }, ICON.check()),
      );
      chip.classList.toggle('is-off', !box.checked);
      box.addEventListener('change', () => {
        row.files = box.checked ? [...row.files, n].sort((a, b) => a - b) : row.files.filter((x) => x !== n);
        chip.classList.toggle('is-off', !box.checked);
        rebuild();
      });
      return chip;
    };

    // one calendar open at a time, whichever chip opened it
    let closeCalendar: (() => void) | null = null;
    const card = (row: Row, i: number) => {
      const name = h('input', { class: 'mail-name', attrs: { type: 'text', 'aria-label': `Task ${i + 1} name`, spellcheck: 'false' } });
      name.value = row.name;
      name.addEventListener('input', () => {
        row.name = name.value;
      });

      const person = h('select', { class: 'mail-pick mail-person', attrs: { 'aria-label': `Task ${i + 1} assignee` } });
      fillPeople(person, row.assigneeId);
      personSelects.push({ select: person, row });
      const priority = h(
        'select',
        { class: 'mail-pick mail-priority', attrs: { 'aria-label': `Task ${i + 1} priority` } },
        h('option', { attrs: { value: '' }, text: 'Normal' }),
        h('option', { attrs: { value: 'high' }, text: 'High' }),
      );
      priority.value = row.priority ?? '';
      priority.classList.toggle('is-high', row.priority === 'high');

      // the due date: a chip like the others, opening Pointer's calendar
      const dueChip = h('button', {
        class: 'mail-pick mail-due',
        attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `Task ${i + 1} due date` },
      });
      const showDue = () => {
        dueChip.textContent = row.due ? dueLabel(row.due) : 'No due date';
        dueChip.classList.toggle('is-empty', !row.due);
        dueChip.title = row.due ? 'Change or clear the due date' : 'Set a due date';
      };
      showDue();
      dueChip.addEventListener('click', () => {
        const open = dueChip.getAttribute('aria-expanded') === 'true';
        closeCalendar?.();
        if (open) return;
        closeCalendar = openCalendar(sheet.el, dueChip, row.due, (date) => {
          row.due = date;
          showDue();
          rebuild();
        });
      });

      // its own actions, at the end of the line: edit the description, leave the task out
      const editButton = h(
        'button',
        { class: 'mail-icon-button', attrs: { type: 'button', 'data-action': 'edit', 'aria-pressed': 'false', 'aria-label': 'Edit the description', title: 'Edit the description' } },
        ICON.pencil(),
      );
      const outButton = h('button', { class: 'mail-icon-button', attrs: { type: 'button', 'data-action': 'out' } });

      // what it asks for, folded into a few lines; the whole description opens for editing
      const preview = h('ul', { class: 'mail-preview', attrs: { title: 'Click to edit the description' } });
      const renderPreview = () => {
        const lines = previewLines(row.description);
        preview.replaceChildren(
          ...lines.slice(0, 4).map((l) => h('li', { text: l })),
          ...(lines.length > 4 ? [h('li', { class: 'is-more', text: `+${lines.length - 4} more` })] : []),
        );
      };
      const description = h('textarea', {
        class: 'field-input review-description mail-description',
        attrs: { 'aria-label': `Task ${i + 1} description`, spellcheck: 'false', hidden: true },
      });
      description.value = row.description;
      const showEditor = (open: boolean) => {
        description.hidden = !open;
        editButton.setAttribute('aria-pressed', String(open));
        if (open) description.focus();
      };
      editButton.addEventListener('click', () => showEditor(description.hidden !== false));
      preview.addEventListener('click', () => showEditor(true));
      description.addEventListener('input', () => {
        row.description = description.value;
        row.edited = true;
        renderPreview();
      });
      const rebuild = () => {
        if (row.edited) return;
        row.description = this.describe(row, payload, p);
        description.value = row.description;
        renderPreview();
      };
      renderPreview();

      const why = h('p', { class: 'field-help mail-why' });
      const renderWhy = () => why.replaceChildren(...whyParts(row, i));
      whyLines[i] = renderWhy;
      renderWhy();
      person.addEventListener('change', () => {
        row.assigneeId = person.value;
        if (i === 0) {
          // the tasks still following take the new person
          inherit();
          for (const x of personSelects) if (x.row !== row) x.select.value = members.has(x.row.assigneeId) ? x.row.assigneeId : '';
        } else if (row.followsFirst) {
          // picked by hand: this one goes its own way from now on
          row.followsFirst = false;
          renderWhy();
          whyLines[0]?.();
        }
      });
      priority.addEventListener('change', () => {
        row.priority = priority.value === 'high' ? 'high' : null;
        priority.classList.toggle('is-high', row.priority === 'high');
        rebuild();
      });
      const chips = row.offered.flatMap((n) => fileChip(row, n, rebuild) ?? []);
      const el = h(
        'article',
        { class: 'mail-task' },
        h('span', { class: 'mail-task-num', text: String(i + 1) }),
        h('div', { class: 'mail-task-name' }, name),
        h(
          'div',
          { class: 'mail-task-controls' },
          h('span', { class: 'mail-out-label', text: 'Left out' }),
          person,
          priority,
          h('span', { class: 'mail-due-wrap' }, dueChip),
          h('div', { class: 'mail-task-actions' }, editButton, outButton),
        ),
        h(
          'div',
          { class: 'mail-task-detail' },
          preview,
          description,
          h('div', { class: 'mail-task-meta' }, why, chips.length ? h('div', { class: 'mail-files' }, ...chips) : null),
        ),
      );
      const setIncluded = () => {
        el.classList.toggle('is-out', !row.include);
        const label = row.include ? 'Leave this task out' : 'Put this task back';
        outButton.replaceChildren(row.include ? ICON.close() : ICON.undo());
        outButton.setAttribute('aria-label', label);
        outButton.title = label;
      };
      outButton.addEventListener('click', () => {
        row.include = !row.include;
        setIncluded();
        refresh();
      });
      setIncluded();
      return el;
    };

    const list = () =>
      h(
        'ul',
        { class: 'mail-list' },
        ...rows.map((r, i) =>
          h(
            'li',
            {},
            h('span', { class: 'mail-task-num', text: String(i + 1) }),
            h('span', { class: 'mail-list-name', text: r.name }),
            h('span', { class: 'mail-list-person', text: members.get(r.assigneeId) ?? (r.assigneeId ? 'Assigned' : 'No one') }),
          ),
        ),
      );

    const questions = p.split.questions;
    const questionsEl = questions.length
      ? h(
          'section',
          { class: 'mail-questions' },
          h(
            'div',
            { class: 'mail-questions-head' },
            h('span', { class: 'field-label', text: 'Questions to answer (not tasks)' }),
            h('button', { class: 'mail-link-button', attrs: { type: 'button' }, text: 'Copy', on: { click: (e) => copyQuestions(e.currentTarget as HTMLButtonElement, questions) } }),
          ),
          h('ul', {}, ...questions.map((q) => h('li', { text: q.quote }))),
        )
      : null;

    sheet.body.replaceChildren(...(full ? rows.map(card) : [list()]), ...(questionsEl ? [questionsEl] : []));
    sheet.footer.replaceChildren(
      h('div', { class: 'mail-hints' }, hint(['Ctrl', 'Enter'], full ? 'Create the tasks' : 'Create'), hint(['Esc'], full ? 'Close, edits kept' : 'Close')),
      h('div', { class: 'mail-actions' }, cancel, create),
    );
    refresh();

    // the people in the workspace, for the pickers, once ClickUp answers
    void send<MembersResponse>({ type: 'pointer:members' }).then(
      (r) => {
        if (!r.members.length) return;
        for (const m of r.members as Member[]) members.set(String(m.id), m.name);
        for (const { select, row } of personSelects) fillPeople(select, row.assigneeId);
      },
      () => {},
    );

    return new Promise((resolve) => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || create.disabled) return;
        e.preventDefault();
        finish(true);
      };
      const finish = (go: boolean) => {
        s.project = projectOf();
        sheet.el.removeEventListener('keydown', onKey);
        if (this.sheet === sheet) this.closeSheet();
        const project = s.project;
        resolve(go && project ? { project, rows: rows.filter((r) => r.include) } : null);
      };
      sheet.el.addEventListener('keydown', onKey);
      create.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      sheet.onClose = () => finish(false);
      (full ? sheet.el.querySelector<HTMLElement>('.mail-name') : projectSelect)?.focus({ preventScroll: true });
    });
  }

  // ---------- Overlay: the review and the toasts ----------

  private mount() {
    if (this.overlay?.host.isConnected) return this.overlay;
    const host = h('div', { attrs: { id: 'bid-pointer-mail' } });
    const root = host.attachShadow({ mode: 'open' });
    adoptStyles(root, css);
    const toast = h('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' } });
    root.append(toast);
    // typing in the review must not reach the app's keyboard shortcuts (Gmail's e archives, # deletes)
    for (const type of ['keydown', 'keyup', 'keypress', 'mousedown', 'pointerdown', 'click'] as const) host.addEventListener(type, (e) => e.stopPropagation());
    document.documentElement.append(host);
    this.overlay = { host, root, toast };
    return this.overlay;
  }

  private hideToast() {
    window.clearTimeout(this.toastTimer);
    this.overlay?.toast.classList.remove('is-visible');
  }

  private toast(t: ToastSpec) {
    const { toast } = this.mount();
    window.clearTimeout(this.toastTimer);
    const ms = t.ms ?? UNDO_MS;
    const icon = t.icon
      ? h('span', { class: `toast-icon toast-icon--${t.icon}` }, t.icon === 'busy' ? ICON.spinner() : t.icon === 'check' ? ICON.check() : ICON.alert())
      : null;
    const title = h('span', { class: 'toast-title', text: t.title });
    const fill = h('span');
    const bar = t.bar ? h('span', { class: 'toast-bar', attrs: { 'aria-hidden': 'true' } }, fill) : null;
    this.toastBar = bar ? { bar: fill, title } : null;
    const text = h(
      'span',
      { class: 'toast-text' },
      title,
      ...(t.meta ?? []).map((m) => h('span', { class: 'toast-meta', text: m })),
      t.links?.length
        ? h('span', { class: 'toast-links' }, ...t.links.map((l) => h('a', { class: 'toast-link', attrs: { href: l.url, target: '_blank', rel: 'noopener' }, text: l.label })))
        : null,
    );
    const actions = t.actions?.length
      ? h(
          'span',
          { class: 'toast-actions' },
          ...t.actions.map((a) => h('button', { class: 'toast-undo caps', attrs: { type: 'button' }, text: a.label, on: { click: (e) => a.run(e.currentTarget as HTMLButtonElement) } })),
        )
      : null;
    const undo = t.undo ? h('button', { class: 'toast-undo caps', attrs: { type: 'button', 'data-action': 'undo' }, text: 'Undo', on: { click: () => t.undo?.() } }) : null;
    const timer = t.undo && !t.sticky ? h('span', { class: 'toast-timer', attrs: { 'aria-hidden': 'true' } }) : null;
    timer?.style.setProperty('animation-duration', `${ms}ms`);
    const closeBtn =
      t.sticky && t.icon !== 'busy'
        ? h('button', { class: 'toast-close', attrs: { type: 'button', 'aria-label': 'Close' }, on: { click: () => this.hideToast() } }, ICON.close())
        : null;
    toast.replaceChildren(...[icon, text, actions, undo, closeBtn, timer, bar].filter((x): x is HTMLElement => x !== null));
    toast.classList.add('is-visible');
    if (!t.sticky) this.toastTimer = window.setTimeout(() => this.hideToast(), ms);
  }

  /** Moves the toast's progress bar, and says what's happening, while it shows one. */
  private toastProgress(percent: number, label: string) {
    if (!this.toastBar) return;
    this.toastBar.bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (this.toastBar.title.textContent !== label) this.toastBar.title.textContent = label;
  }
}

/** Starts Send to ClickUp in the app's top window (its iframes get nothing), once per page. */
export function bootMail(app: MailApp) {
  const injected = globalThis as unknown as { __bidPointerMail?: boolean };
  if (window.top !== window || injected.__bidPointerMail) return;
  injected.__bidPointerMail = true;
  appName = app.name;
  new MailPointer(app);
}
