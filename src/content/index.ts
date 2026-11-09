import css from './ui.css';
import { cssPath, describeElement, findBlock } from './detect';
import { DockDrag } from './dockdrag';
import { Confetti } from './confetti';
import { autoGrow, fitSelect, shake, wireReview } from './fields';
import { fixedSize, type FixedSize } from './fixedsize';
import { adoptStyles, installFonts } from './shadow';
import { SeoPanel, type SeoHost } from './seo/panel';
import {
  SHELL,
  assigneeOptionsHtml,
  draftPinsHtml,
  noteFoot,
  noteHtml,
  projectOptionsHtml,
  sheetHtml,
  targetHtml,
  toastHtml,
  type NoteError,
  type NoteKind,
  type NoteState,
  type Review,
  type TargetView,
  type ToastModel,
} from './view';
import { clock, hasBlock, slugify, videoExt } from '../shared/format';
import { DEFAULT_CORNER, isCorner } from '../shared/corner';
import { browserLabel, pageInfo, pageKeyOf } from '../shared/page';
import type {
  BlockInfo,
  CaptureRequest,
  CaptureResponse,
  CommentResult,
  ElementInfo,
  FindTaskResponse,
  InitResponse,
  MembersResponse,
  Msg,
  NoteSubmission,
  NoteVideo,
  OpenTask,
  PageInfo,
  PageTask,
  PageTaskItem,
  PagePrepareResponse,
  PageTaskResponse,
  PinAnchor,
  PrepareResponse,
  ProjectRef,
  ProjectsResponse,
  PublishResult,
  Rect,
  SubmitResult,
  TaskDraft,
} from '../shared/types';

const UNDO_MS = 10_000;
/** How often to check for client-side navigation and layout shifts under the page-task pins. */
const WATCH_MS = 800;
/** Comment Mode asks ClickUp again when a note has been open this long, in case the task moved on. */
const TARGET_FRESH_MS = 60_000;
/** How long sending waits for Comment Mode's lookup before going ahead without it. */
const LOOKUP_WAIT_MS = 8_000;
/** Nothing waits on the background longer than this, so Pointer can't get stuck. */
const SEND_TIMEOUT_MS = 90_000;

/*
 * Screen recording, kept light: the browser's own tab capture and encoder (hardware H.264 in MP4
 * where the browser has it, VP8 WebM otherwise), 15 frames a second at a capped size and bitrate,
 * and at most 30 seconds. An MP4 recording's frames are drawn onto a canvas of one size on the way
 * (fixedsize.ts), so the browser's "Sharing this tab" bar or a resized window can't break it; WebM
 * copes with a size change by itself. Nothing is re-encoded.
 */
const MAX_RECORDING_MS = 30_000;
const RECORDING_FPS = 15;
const RECORDING_BITRATE = 1_500_000;
const RECORDING_TYPES = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8', 'video/webm'];

/** What to do when the background is from another build (see BUILD in build.mjs). */
const STALE_STEPS =
  'Pointer was updated, but the browser is still running the old version. Open the extensions page (edge://extensions or chrome://extensions; about:addons in Firefox), reload bid Pointer, then reload this page.';

const canRecord = () =>
  window.isSecureContext && typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the recording"));
    reader.readAsDataURL(blob);
  });
}

/** A recording as the review sees it: described, without the file itself (it isn't sent twice). */
const describedOnly = (v: NoteVideo | undefined): NoteVideo | undefined => (v ? { name: v.name, mime: v.mime, ms: v.ms } : undefined);

type Recording = { blob: Blob; url: string; mime: string; ms: number };
type LiveRecording = {
  /** The capture as the browser shares it. */
  stream: MediaStream;
  /** The same at one size, for the recorder; null when that couldn't be had. */
  frames: FixedSize | null;
  /** Null while the capture settles on a size, before recording starts. */
  recorder: MediaRecorder | null;
  chunks: Blob[];
  started: number;
  tick: number;
  limit: number;
};
/** Space between the pin and the note. */
const NOTE_GAP = 16;
/** The pin's size (ui.css .pin) and the room it needs before it flips away from an edge. */
const PIN = 24;
const PIN_ROOM = PIN + 4;
/** Closest the note gets to the viewport edge. */
const EDGE = 8;

type Point = { x: number; y: number };

type Mode = 'block' | 'page';

/** Comment Mode's lookup for the open note: nothing to do, under way, or what ClickUp said. */
type Target =
  | { state: 'off' | 'no-block' | 'no-project' }
  | { state: 'looking'; key: string; mode: Mode }
  | { state: 'found'; key: string; mode: Mode; task: OpenTask; at: number }
  | { state: 'none'; key: string; mode: Mode; at: number }
  | { state: 'error'; key: string; mode: Mode; error: string }
  | { state: 'gone'; key: string; mode: Mode; name: string };

type NoteCtx = {
  blockEl: Element | null;
  block: BlockInfo;
  targetEl: Element;
  element: ElementInfo;
  /** Click offset inside the target element, so the pin stays on the spot while the page scrolls. */
  offset: Point;
  page: PageInfo;
  /** Set when the note is one of the page task's, reopened from its pin. */
  itemId?: string;
};

/** Promise form only: Firefox's `browser.runtime.sendMessage` doesn't take a callback. */
async function send<T>(msg: Msg): Promise<T> {
  let timer = 0;
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('The extension stopped answering. Reload the page and try again.')), SEND_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([chrome.runtime.sendMessage(msg), late])) as T;
  } catch (e) {
    throw new Error(e instanceof Error && e.message ? e.message : 'Extension unavailable. Reload the page.');
  } finally {
    window.clearTimeout(timer);
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isEmptyRect = (r: DOMRect) => r.width === 0 && r.height === 0;
const sameBox = (a: Element, b: Element) => {
  const r = a.getBoundingClientRect();
  const s = b.getBoundingClientRect();
  return Math.abs(r.left - s.left) < 1 && Math.abs(r.top - s.top) < 1 && Math.abs(r.width - s.width) < 1 && Math.abs(r.height - s.height) < 1;
};

/** The line above a review when the model couldn't rewrite (some of) it. */
const rewriteNote = (error: string, count = 1) =>
  `${count === 1 ? "This wasn't" : `${count} of the notes weren't`} rewritten (${error}). Edit it here, or send it as it is.`;

class Pointer {
  private readonly host = document.createElement('div');
  private readonly root: ShadowRoot;
  private readonly launcher: HTMLButtonElement;
  private readonly publishBtn: HTMLButtonElement;
  private readonly drafts: HTMLElement;
  private readonly outlineBlock: HTMLElement;
  private readonly outlineTab: HTMLElement;
  private readonly outlineEl: HTMLElement;
  private readonly pin: HTMLElement;
  private readonly note: HTMLElement;
  private readonly sheet: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly recbar: HTMLElement;
  /** The SEO check, opened by its button in the dock. */
  private readonly seo: SeoPanel;

  private pointMode = false;
  private busy = false;
  private state: NoteState = 'edit';
  private step = 0;
  private thumb: string | null = null;
  private error: NoteError = { title: '', detail: '', showOptions: false };

  private hover: { block: Element | null; el: Element | null } = { block: null, el: null };
  private raf = 0;
  private ctx: NoteCtx | null = null;
  /** Where the pin's tip sits, in viewport coordinates. Follows the clicked element while it is on the page. */
  private pinAt: Point = { x: 0, y: 0 };
  /** The pin's body points up and right unless an edge is in the way. */
  private pinFlip = { x: false, y: false };
  private draft = '';
  private selectedListId = '';
  private reviewDraft: Review = { name: '', description: '' };
  private reviewResolve: ((d: TaskDraft | null) => void) | null = null;
  /** The page task's review, above the dock; resolves with the edited task or null for Back. */
  private sheetResolve: ((d: TaskDraft | null) => void) | null = null;

  private init: InitResponse = {
    keysOk: false,
    missing: [],
    user: null,
    remembered: null,
    reviewBeforeSend: false,
    pageTask: false,
    commentMode: false,
    seoCheck: false,
    sites: [],
    ours: [],
    defaultAssignee: null,
    shortcut: '',
  };
  private members: MembersResponse | null = null;
  private membersLoading: Promise<MembersResponse> | null = null;
  /** ClickUp user id the task goes to; '' is no one. */
  private assigneeId = '';
  /** Set once someone is picked by hand on this page; until then notes follow the default. */
  private assigneePicked = false;
  /** False until the first answer from the extension, so a very early click doesn't count as "not set up". */
  private initLoaded = false;
  private projects: ProjectsResponse | null = null;
  private projectsLoading: Promise<ProjectsResponse> | null = null;
  private toastTimer = 0;
  private prevCursor = '';

  /** The notes waiting on this page (page-task mode), and the page they belong to. */
  private pageTask: PageTask | null = null;
  private pageKey = pageKeyOf(location);
  /** Each note's element, found again from its anchor path; null when it isn't on the page. */
  private readonly anchors = new Map<string, Element | null>();
  /** The text of a page-task note being edited, apart from the draft of a new note. */
  private itemDraft = '';
  private publishing = false;

  /** Comment Mode: the open task the open note goes on, and whether this note was switched to a new task. */
  private target: Target = { state: 'off' };
  private targetOverride = false;
  private targetRun: { key: string; done: Promise<void> } | null = null;
  /** Set while sending waits for that lookup; Esc and the launcher call it to stop waiting. */
  private cancelWait: (() => void) | null = null;
  /** Said in the next toast: the lookup was too slow, so the note went out without it. */
  private lookupSkipped: string | null = null;
  private busyLabel: string | null = null;

  /** The background is from another build: the files changed but Pointer wasn't reloaded. */
  private stale = false;

  /** Moves the dock to the corner it's dragged to; the choice holds in every tab. */
  private dockDrag: DockDrag;

  /** Screen recording under way: Pointer steps aside and the page gets its clicks back. */
  private recording: LiveRecording | null = null;
  /** The recording made for the note being written; it goes with it, like the draft. */
  private video: Recording | null = null;

  constructor() {
    installFonts();
    this.host.id = 'bid-pointer';
    this.host.setAttribute('style', 'all:initial');
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.innerHTML = SHELL;
    adoptStyles(this.root, css);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.launcher = q('.launcher');
    this.publishBtn = q('.publish');
    this.drafts = q('.drafts');
    this.outlineBlock = q('.outline--block');
    this.outlineTab = q('.outline-tab');
    this.outlineEl = q('.outline--element');
    this.pin = q('.pin');
    this.note = q('.note:not(.sheet)');
    this.sheet = q('.sheet');
    this.toast = q('.toast');
    this.recbar = q('.recbar');
    const seoButton = q<HTMLButtonElement>('.seo-btn');
    this.seo = new SeoPanel(this.seoHost(), seoButton, q('.note.seo'), q('.seo-mark'));
    seoButton.addEventListener('click', () => this.toggleSeo());
    this.recbar.querySelector('.recbar-stop')?.addEventListener('click', () => this.stopRecording());
    const limit = this.recbar.querySelector('.recbar-limit');
    if (limit) limit.textContent = `of ${clock(MAX_RECORDING_MS)}`;
    const confetti = new Confetti(this.root.querySelector('.confetti') as HTMLCanvasElement, this.host, this.launcher);
    this.dockDrag = new DockDrag(this.host, q('.dock'), this.root.querySelector('.dock-guide') as SVGSVGElement, {
      moved: (corner) => {
        chrome.storage.local.set({ dockCorner: corner }).catch(() => {});
      },
      spun: (turnsPerSecond) => confetti.spin(turnsPerSecond),
      released: () => confetti.release(),
    });
    document.documentElement.appendChild(this.host);
    // the dock stays hidden until it's in the corner it was left in (or a second has passed)
    const placeAnyway = window.setTimeout(() => this.dockDrag.place(DEFAULT_CORNER), 1000);
    const placeDock = (corner: unknown) => {
      window.clearTimeout(placeAnyway);
      if (!this.dockDrag.corner) this.dockDrag.place(isCorner(corner) ? corner : DEFAULT_CORNER);
    };
    chrome.storage.local.get('dockCorner').then(
      (r) => placeDock(r.dockCorner),
      () => placeDock(null),
    );

    this.launcher.addEventListener('click', () => this.toggle());
    this.publishBtn.addEventListener('click', () => void this.publish());
    this.drafts.addEventListener('click', (e) => {
      const id = (e.target as Element | null)?.closest<HTMLElement>('[data-item]')?.dataset.item;
      if (id) this.openItem(id);
    });
    window.addEventListener('mousemove', this.onMove, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('scroll', this.scheduleReposition, true);
    window.addEventListener('resize', this.scheduleReposition);
    chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
      if (msg.type !== 'pointer:toggle') return;
      this.toggle();
      sendResponse(true); // tells the background Pointer is here, so it doesn't inject it again
    });
    // Pasting the token in the options tab makes this page ready without a reload.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      // notes added, rewritten, published or discarded, here or in another tab
      if (changes.pageTasks) void this.loadPageTask();
      // the dock dragged to another corner in another tab follows here too
      if (isCorner(changes.dockCorner?.newValue)) this.dockDrag.place(changes.dockCorner.newValue, !document.hidden);
      if (!changes.settings) return;
      // e.g. loaded without a token; load again with the new one
      if (this.projects?.error) this.projects = null;
      if (this.members?.error) this.members = null;
      void this.refreshInit();
    });
    // Client-side navigation changes the page without reloading Pointer, and late images or
    // fonts move things under the pins; neither sends an event this script can hear.
    window.setInterval(() => {
      const key = pageKeyOf(location);
      if (key !== this.pageKey) {
        this.pageKey = key;
        this.anchors.clear();
        if (this.ctx?.itemId && !this.busy) this.closeNote();
        this.setPageTask(null);
        void this.loadPageTask();
        this.seo.pageChanged();
      } else if (this.pageTask) this.placePins();
    }, WATCH_MS);
    void this.refreshInit();
    void this.loadPageTask();
  }

  // ---------- Point mode ----------

  toggle() {
    if (this.recording) return this.stopRecording();
    // waiting for ClickUp can always be stopped; other work can't be interrupted
    if (this.cancelWait) this.cancelWait();
    else if (this.busy) return;
    if (this.pointMode) this.exitPointMode();
    // an old background would drop what this page script sends (a recording, say): reload first
    else if (this.stale) this.showStale();
    // Pointing is pointless without a token: go straight to setup instead.
    else if (this.initLoaded && !this.init.keysOk) send({ type: 'pointer:open-options' }).catch(() => {});
    else this.enterPointMode();
  }

  private setPointMode(on: boolean) {
    this.pointMode = on;
    this.launcher.classList.toggle('is-active', on);
    this.launcher.setAttribute('aria-pressed', String(on));
  }

  private enterPointMode() {
    this.seo.close(); // one thing at a time beside the dock
    this.setPointMode(true);
    this.prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    void this.refreshInit();
  }

  private exitPointMode() {
    this.setPointMode(false);
    document.documentElement.style.cursor = this.prevCursor;
    this.closeNote();
    this.hover = { block: null, el: null };
    this.reposition();
  }

  // ---------- SEO check (src/content/seo) ----------

  private toggleSeo() {
    if (this.recording || this.busy) return;
    if (this.pointMode) this.exitPointMode();
    this.seo.toggle();
  }

  /** What the SEO panel gets from Pointer: the same messages and toasts, and the page's project and person. */
  private seoHost(): SeoHost {
    return {
      send,
      toast: (t, ms) => {
        this.showToast(t, ms);
        return this.toast;
      },
      init: () => this.init,
      stale: () => this.stale,
      showStale: () => this.showStale(),
      picked: () => ({
        listId: this.selectedListId || this.init.remembered?.listId || '',
        assigneeId: this.assigneePicked ? this.assigneeId : String(this.init.defaultAssignee?.id ?? ''),
      }),
      pick: (p) => {
        if (p.listId !== undefined) this.selectedListId = p.listId;
        if (p.assigneeId === undefined) return;
        this.assigneeId = p.assigneeId;
        this.assigneePicked = true;
      },
      projects: (page) => this.fetchProjects(page),
      members: () => this.fetchMembers(),
      project: (listId) => this.projectFor(listId),
      used: (project) => {
        this.init.remembered = project;
      },
    };
  }

  private async refreshInit() {
    try {
      const key = pageInfo(location, document.title).projectKey;
      this.init = await send<InitResponse>({ type: 'pointer:init', projectKey: key });
      this.initLoaded = true;
      this.seo.setAvailable(this.init.seoCheck);
      const who = this.init.user ? ` Tasks are created as ${this.init.user.username}.` : '';
      const keys = this.init.shortcut ? ` (${this.init.shortcut})` : '';
      this.stale = this.init.build !== __POINTER_BUILD__;
      if (this.stale) this.setLauncher('Reload Pointer', false, STALE_STEPS);
      else if (!this.init.keysOk) this.setLauncher('Set up Pointer', false, `Pointer needs your ${this.init.missing.join(' and ')}. Click to set it up.`);
      else if (this.init.pageTask)
        this.setLauncher('Page task', true, `Point at something to add a note to this page's task${keys}. Publish task sends them all as one task.${who}`);
      else this.setLauncher('Pointer', true, `Point at something on the page${keys}.${who}`);
    } catch {
      this.setLauncher('Pointer', false, 'Pointer lost its connection to the extension. Reload the page.');
    }
    this.launcher.classList.toggle('is-page', this.pageMode());
    this.renderDock();
    // Comment Mode may have been switched on or off while a note is open
    if (this.ctx && this.state === 'edit') void this.lookupTarget();
  }

  /** "Enable Page Specific Task" is on: notes collect on the page instead of each making a task. */
  private pageMode() {
    return this.init.keysOk && this.init.pageTask;
  }

  private setLauncher(label: string, ready: boolean, title: string) {
    const text = this.launcher.querySelector('.launcher-label');
    if (text) text.textContent = label;
    this.launcher.classList.toggle('needs-setup', !ready);
    this.launcher.title = `${title}\nDrag it to any corner of the window to move it.`;
  }

  // ---------- Page task: pins and the Publish task button ----------

  private async loadPageTask() {
    const key = this.pageKey;
    try {
      const r = await send<PageTaskResponse>({ type: 'pointer:page-get', key });
      if (r.ok && key === this.pageKey) this.setPageTask(r.task);
    } catch {
      // keep what's shown; the next change tries again
    }
  }

  private setPageTask(task: PageTask | null) {
    this.pageTask = task;
    for (const id of this.anchors.keys()) if (!task?.items.some((i) => i.id === id)) this.anchors.delete(id);
    if (task) {
      // the page task's project and person, unless someone picked others on this page
      if (task.project) this.selectedListId ||= task.project.listId;
      if (!this.assigneePicked) {
        this.assigneeId = task.assigneeId;
        this.assigneePicked = true;
      }
    }
    // a reopened note that was removed or published elsewhere
    if (this.ctx?.itemId && !task?.items.some((i) => i.id === this.ctx?.itemId) && !this.busy) this.closeNote();
    this.renderPins();
    this.renderDock();
  }

  /** Shown while page-task mode is on, and whenever this page has notes waiting (even with the mode off). */
  private renderDock() {
    const n = this.pageTask?.items.length ?? 0;
    this.publishBtn.hidden = !(this.pageMode() || n > 0);
    this.publishBtn.disabled = n === 0 || this.publishing;
    this.publishBtn.classList.toggle('is-busy', this.publishing);
    const count = this.publishBtn.querySelector('.publish-count');
    const label = this.publishBtn.querySelector('.publish-label');
    if (count) count.textContent = String(n);
    if (label) label.textContent = this.publishing ? 'Publishing…' : 'Publish task';
    this.publishBtn.title =
      n === 0
        ? 'No notes yet. Click Page task, then the thing on the page, to add the first one.'
        : `Create one ClickUp task from the ${n} ${n === 1 ? 'note' : 'notes'} on this page`;
  }

  private renderPins() {
    this.drafts.innerHTML = draftPinsHtml(this.pageTask?.items ?? []);
    this.placePins();
  }

  private placePins() {
    const vw = document.documentElement.clientWidth;
    const items = this.pageTask?.items ?? [];
    for (const pin of Array.from(this.drafts.querySelectorAll<HTMLElement>('.draft-pin'))) {
      const item = items.find((i) => i.id === pin.dataset.item);
      if (!item) continue;
      const { x, y } = this.anchorPoint(item);
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
      pin.classList.toggle('flip-x', x + PIN_ROOM > vw);
      pin.classList.toggle('flip-y', y - PIN_ROOM < 0);
      pin.classList.toggle('is-editing', item.id === this.ctx?.itemId);
    }
  }

  private anchorEl(item: PageTaskItem): Element | null {
    const cached = this.anchors.get(item.id);
    if (cached?.isConnected) return cached;
    let el: Element | null = null;
    try {
      el = item.anchor.path ? document.querySelector(item.anchor.path) : null;
    } catch {
      el = null;
    }
    this.anchors.set(item.id, el);
    return el;
  }

  /** Where a note's pin goes: on its element if it's on the page, else where it was in the page. */
  private anchorPoint(item: PageTaskItem): Point {
    const el = this.anchorEl(item);
    const r = el?.getBoundingClientRect();
    if (r && !isEmptyRect(r)) return { x: r.left + item.anchor.fx * r.width, y: r.top + item.anchor.fy * r.height };
    return { x: item.anchor.pageX - window.scrollX, y: item.anchor.pageY - window.scrollY };
  }

  /** Remembers the clicked spot so its pin can be put back after a reload. */
  private anchorFor(c: NoteCtx): PinAnchor {
    const p = this.pinAt;
    const el = c.targetEl.isConnected && c.targetEl !== document.body ? c.targetEl : null;
    const r = el?.getBoundingClientRect();
    const sized = r && r.width > 0 && r.height > 0;
    return {
      path: el ? cssPath(el) : '',
      fx: r && sized ? clamp((p.x - r.left) / r.width, 0, 1) : 0,
      fy: r && sized ? clamp((p.y - r.top) / r.height, 0, 1) : 0,
      pageX: p.x + window.scrollX,
      pageY: p.y + window.scrollY,
    };
  }

  // ---------- Hover and positioning ----------

  private onMove = (e: MouseEvent) => {
    if (this.recording || !this.pointMode || this.ctx || this.busy) return;
    const target = e.target as Element | null;
    if (!target || target === this.host || this.host.contains(target)) return;
    const found = findBlock(target);
    this.hover = { block: found?.el ?? null, el: target };
    this.outlineTab.textContent = found?.info.name ?? '';
    this.scheduleReposition();
  };

  private scheduleReposition = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.reposition();
    });
  };

  private reposition() {
    const c = this.ctx;
    this.placePins();
    const block = c ? c.blockEl : this.hover.block;
    // a reopened note whose element is gone hangs off <body>, which isn't worth outlining
    const el = c ? (c.targetEl === document.body ? null : c.targetEl) : this.hover.el;
    this.placeOutline(this.outlineBlock, block);
    // when the element *is* the block's box, a second outline would only hide the first
    this.placeOutline(this.outlineEl, el && el !== block && !(block && sameBox(el, block)) ? el : null);
    if (!c) return;
    const item = c.itemId ? this.pageTask?.items.find((i) => i.id === c.itemId) : undefined;
    if (item) this.pinAt = this.anchorPoint(item);
    else this.trackPin(c);
    const { x, y } = this.pinAt;
    this.pinFlip = { x: x + PIN_ROOM > document.documentElement.clientWidth, y: y - PIN_ROOM < 0 };
    this.pin.classList.toggle('flip-x', this.pinFlip.x);
    this.pin.classList.toggle('flip-y', this.pinFlip.y);
    this.pin.style.left = `${x}px`;
    this.pin.style.top = `${y}px`;
    this.placeNote();
  }

  private placeOutline(box: HTMLElement, target: Element | null) {
    const r = this.pointMode && target?.isConnected ? target.getBoundingClientRect() : null;
    if (!r || isEmptyRect(r)) {
      box.classList.remove('is-visible');
      return;
    }
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.classList.add('is-visible');
    if (box === this.outlineBlock) this.outlineTab.classList.toggle('is-inside', r.top < 30);
  }

  /** Keeps the pin on the clicked spot. Holds still if the element vanished (a closed hover menu, say). */
  private trackPin(c: NoteCtx) {
    if (!c.targetEl.isConnected) return;
    const r = c.targetEl.getBoundingClientRect();
    if (isEmptyRect(r)) return;
    this.pinAt = { x: r.left + c.offset.x, y: r.top + c.offset.y };
  }

  /**
   * Puts the note beside the pin's tip, flipping left or up when there's no room, and keeps
   * it on screen. Vertically it always clears the pin's body, whichever way that points.
   */
  private placeNote() {
    if (!this.ctx) return;
    const { x, y } = this.pinAt;
    const w = this.note.offsetWidth;
    const h = this.note.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = x + NOTE_GAP;
    if (left + w > vw - EDGE) left = x - NOTE_GAP - w;
    const below = this.pinFlip.y ? y + PIN + NOTE_GAP : y + NOTE_GAP;
    const above = this.pinFlip.y ? y - NOTE_GAP - h : y - PIN - NOTE_GAP - h;
    let top = below;
    if (top + h > vh - EDGE) top = above;
    if (top < EDGE) {
      // Too tall for either side: sit beside the pin's body instead, centred on the tip.
      const right = this.pinFlip.x ? x + NOTE_GAP : x + PIN + NOTE_GAP;
      const leftEnd = this.pinFlip.x ? x - PIN - NOTE_GAP : x - NOTE_GAP;
      left = right + w <= vw - EDGE ? right : leftEnd - w;
      top = y - h / 2;
    }
    left = clamp(left, EDGE, Math.max(EDGE, vw - w - EDGE));
    top = clamp(top, EDGE, Math.max(EDGE, vh - h - EDGE));
    this.note.style.left = `${left}px`;
    this.note.style.top = `${top}px`;
    // the entrance animation grows out of the pin
    this.note.style.transformOrigin = `${x - left}px ${y - top}px`;
  }

  // ---------- Click and keys ----------

  private onClick = (e: MouseEvent) => {
    // while recording, clicks are the page's: the person is showing the problem
    if (!this.pointMode || this.recording) return;
    const target = e.target as Element | null;
    if (!target || target === this.host || this.host.contains(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.busy) return;
    if (this.ctx) {
      // clicking somewhere else moves the note there and keeps the draft
      if (this.state !== 'edit') return;
      this.closeNote();
    }
    this.openNote(target, { x: e.clientX, y: e.clientY });
  };

  private onKey = (e: KeyboardEvent) => {
    // Esc while dragging the dock puts it back
    if (e.key === 'Escape' && this.dockDrag.cancel()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (this.recording) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stopRecording();
      }
      return; // every other key is the page's
    }
    if (e.key === 'Escape' && this.cancelWait) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancelWait();
      return;
    }
    // the page task's review is open whether or not point mode is
    if (e.key === 'Escape' && this.sheetResolve) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.finishSheet(null);
      return;
    }
    // the SEO panel: from its review back to the findings, else closed
    if (e.key === 'Escape' && this.seo.escape()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key !== 'Escape' || !this.pointMode) return;
    if (this.ctx && this.state === 'review') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.finishReview(null);
      return;
    }
    if (this.busy) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.ctx) this.closeNote();
    else this.exitPointMode();
  };

  // ---------- Note ----------

  private openNote(target: Element, click: Point) {
    const found = findBlock(target);
    const r = target.getBoundingClientRect();
    this.ctx = {
      blockEl: found?.el ?? null,
      block: found?.info ?? { name: '', id: '', source: 'none' },
      targetEl: target,
      element: describeElement(target, found?.el ?? null),
      offset: { x: click.x - r.left, y: click.y - r.top },
      page: pageInfo(location, document.title, this.init.sites),
    };
    this.pinAt = click;
    this.hover = { block: this.ctx.blockEl, el: target };
    this.outlineTab.textContent = found?.info.name ?? '';
    // Keep a project picked earlier on this page; otherwise start with the site's last-used
    // project, then the URL suggestion. If projects are still loading, loadProjects() fills it in.
    this.selectedListId ||= this.init.remembered?.listId ?? this.projects?.best?.listId ?? '';
    if (!this.assigneePicked) this.assigneeId = this.init.defaultAssignee ? String(this.init.defaultAssignee.id) : '';
    this.state = 'edit';
    this.target = { state: 'off' };
    this.targetOverride = false;
    this.targetRun = null;
    this.replay(this.note, 'is-open');
    this.replay(this.pin, 'is-visible');
    this.renderNote();
    this.reposition();
    this.focusInput();
    void this.loadProjects();
    void this.loadMembers();
    void this.lookupTarget();
  }

  /** Reopens one of the page task's notes from its pin, to change or remove it. */
  private openItem(id: string) {
    if (this.busy) return;
    const item = this.pageTask?.items.find((i) => i.id === id);
    if (!item) return;
    if (this.ctx) {
      if (this.state !== 'edit') return;
      this.closeNote();
    }
    const el = this.anchorEl(item);
    const at = this.anchorPoint(item);
    const target = el ?? document.body;
    const r = target.getBoundingClientRect();
    const found = el ? findBlock(el) : null;
    this.ctx = {
      blockEl: found?.el ?? null,
      block: item.block,
      targetEl: target,
      element: item.element,
      offset: { x: at.x - r.left, y: at.y - r.top },
      page: pageInfo(location, document.title, this.init.sites),
      itemId: id,
    };
    this.itemDraft = item.note;
    this.target = { state: 'off' };
    this.pinAt = at;
    this.hover = { block: this.ctx.blockEl, el };
    this.outlineTab.textContent = found?.info.name ?? '';
    if (this.pageTask?.project) this.selectedListId ||= this.pageTask.project.listId;
    this.state = 'edit';
    this.replay(this.note, 'is-open');
    this.renderNote();
    this.reposition();
    this.focusInput();
    void this.loadProjects();
    void this.loadMembers();
  }

  /** Re-adds a class so its entrance animation plays again, e.g. when the note moves to a new spot. */
  private replay(el: HTMLElement, cls: string) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** The note's × button: like Esc it keeps the draft and stays in point mode, and it also abandons a review. */
  private dismissNote() {
    if (this.state === 'review') this.finishReview(null);
    else if (this.busy) return;
    this.closeNote();
  }

  private closeNote() {
    const input = this.input();
    // a reopened page-task note just closes; only a new note's draft is kept
    if (input && this.state === 'edit' && !this.ctx?.itemId) this.draft = input.value;
    this.ctx = null;
    this.note.classList.remove('is-open');
    this.pin.classList.remove('is-visible');
    this.reposition();
  }

  private input() {
    return this.note.querySelector<HTMLTextAreaElement>('.note-input');
  }

  private select() {
    return this.note.querySelector<HTMLSelectElement>('.note-project');
  }

  private focusInput() {
    const input = this.input();
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** ClickUp's projects, asked for once for the notes and the SEO panel alike. */
  private fetchProjects(page: PageInfo): Promise<ProjectsResponse> {
    if (this.projects) return Promise.resolve(this.projects);
    this.projectsLoading ??= send<ProjectsResponse>({ type: 'pointer:projects', page })
      .catch((e): ProjectsResponse => ({ all: [], suggested: [], best: null, error: errMsg(e) }))
      .then((r) => {
        this.projects = r;
        this.projectsLoading = null;
        return r;
      });
    return this.projectsLoading;
  }

  private async loadProjects() {
    if (this.projects || !this.ctx) return;
    const projects = await this.fetchProjects(this.ctx.page);
    if (!this.ctx) return;
    if (!this.selectedListId && projects.best) this.selectedListId = projects.best.listId;
    this.renderProjectSelect();
    void this.lookupTarget();
  }

  private projectOptions() {
    return projectOptionsHtml({ selectedId: this.selectedListId, remembered: this.init.remembered, projects: this.projects });
  }

  /** The workspace's people, asked for once for the notes and the SEO panel alike. */
  private fetchMembers(): Promise<MembersResponse> {
    if (this.members) return Promise.resolve(this.members);
    this.membersLoading ??= send<MembersResponse>({ type: 'pointer:members' })
      .catch((e): MembersResponse => ({ members: [], error: errMsg(e) }))
      .then((r) => {
        this.members = r;
        this.membersLoading = null;
        return r;
      });
    return this.membersLoading;
  }

  private async loadMembers() {
    if (this.members || !this.ctx) return;
    await this.fetchMembers();
    if (this.ctx) this.renderAssigneeSelect();
  }

  private assigneeOptions() {
    return assigneeOptionsHtml({ selectedId: this.assigneeId, defaultAssignee: this.init.defaultAssignee, members: this.members });
  }

  private renderAssigneeSelect() {
    const select = this.note.querySelector<HTMLSelectElement>('.note-assignee');
    if (!select) return;
    select.innerHTML = this.assigneeOptions();
    fitSelect(select);
  }

  private projectFor(listId: string): ProjectRef | null {
    if (!listId) return null;
    if (this.init.remembered?.listId === listId) return this.init.remembered;
    if (this.pageTask?.project?.listId === listId) return this.pageTask.project;
    return this.projects?.all.find((p) => p.listId === listId) ?? this.projects?.suggested.find((p) => p.listId === listId) ?? null;
  }

  private renderProjectSelect() {
    const select = this.select();
    if (!select) return;
    select.innerHTML = this.projectOptions();
    select.classList.toggle('is-empty', !this.selectedListId);
  }

  private noteKind(c: NoteCtx): NoteKind {
    if (c.itemId) return 'page-item';
    if (this.commentTarget()) return 'comment';
    return this.pageMode() ? 'page-add' : 'task';
  }

  // ---------- Screen recording ----------

  /**
   * Records the tab with the browser's screen sharing (Chrome and Edge offer just this tab;
   * Firefox asks for a window or screen). Pointer steps aside while it runs, so the person can
   * scroll, hover and click to make the problem happen; Stop, Esc, the browser's own "Stop sharing"
   * or the 30-second limit end it, and the note comes back with the recording to preview.
   */
  private async startRecording() {
    const c = this.ctx;
    if (!c || this.recording || this.busy) return;
    const input = this.input();
    if (input) this.draft = input.value;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: RECORDING_FPS, max: RECORDING_FPS }, width: { max: 1600 }, height: { max: 1000 } },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return; // they chose not to share
      this.showToast({ title: "Couldn't start recording", icon: 'alert', meta: [errMsg(e)] }, 6000);
      return;
    }
    if (this.ctx !== c) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const r: LiveRecording = {
      stream,
      frames: null,
      recorder: null,
      chunks: [],
      started: 0,
      tick: window.setInterval(() => this.renderRecbar(), 250),
      limit: 0,
    };
    this.recording = r;
    // the browser's own "Stop sharing" ends it too
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopRecording());
    // out of the way: the normal cursor, no note, pin or dock; just the recording bar
    document.documentElement.style.cursor = this.prevCursor;
    this.host.classList.add('is-recording');
    this.renderRecbar();
    const mimeType = RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    // an MP4 can't change picture size partway, so it starts once the capture has settled on one
    // (a moment, for the sharing bar); WebM's VP8 can, so Firefox records the capture as it comes
    if (mimeType?.startsWith('video/mp4')) {
      const frames = await fixedSize(stream, RECORDING_FPS).catch(() => null);
      if (this.recording !== r) {
        frames?.stop(); // stopped while it settled
        return;
      }
      r.frames = frames;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(r.frames?.stream ?? stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: RECORDING_BITRATE });
      recorder.ondataavailable = (e) => {
        if (e.data.size) r.chunks.push(e.data);
      };
      recorder.onstop = () => this.finishRecording();
      recorder.start(1000);
    } catch (e) {
      this.finishRecording(e);
      return;
    }
    r.recorder = recorder;
    r.started = Date.now();
    r.limit = window.setTimeout(() => this.stopRecording(), MAX_RECORDING_MS);
    this.renderRecbar();
  }

  private stopRecording() {
    const r = this.recording;
    if (!r) return;
    // the recorder's last data comes with its stop event; before it starts there's none to wait for
    if (!r.recorder) this.finishRecording();
    else if (r.recorder.state !== 'inactive') r.recorder.stop();
  }

  /** Ends the recording: Pointer comes back with it to preview, or says why there's nothing. */
  private finishRecording(failed?: unknown) {
    const r = this.recording;
    if (!r) return;
    this.recording = null;
    window.clearInterval(r.tick);
    window.clearTimeout(r.limit);
    r.frames?.stop();
    for (const track of r.stream.getTracks()) track.stop();
    this.host.classList.remove('is-recording');
    if (this.pointMode) document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
    const blob = new Blob(r.chunks, { type: r.recorder?.mimeType || r.chunks[0]?.type || 'video/webm' });
    if (failed !== undefined) {
      this.showToast({ title: "Couldn't start recording", icon: 'alert', meta: [errMsg(failed)] }, 6000);
    } else if (blob.size) {
      this.clearVideo();
      this.video = { blob, url: URL.createObjectURL(blob), mime: blob.type, ms: Date.now() - r.started };
    } else {
      this.showToast({ title: 'Nothing was recorded', icon: 'alert' }, 4000);
    }
    if (this.ctx && this.state === 'edit') {
      this.renderNote();
      this.reposition();
      this.focusInput();
    }
  }

  private renderRecbar() {
    const r = this.recording;
    const time = this.recbar.querySelector('.recbar-time');
    if (r && time) time.textContent = clock(r.started ? Date.now() - r.started : 0);
  }

  private clearVideo() {
    if (this.video) URL.revokeObjectURL(this.video.url);
    this.video = null;
  }

  /** The note's recording for sending, named after its block like the screenshot. */
  private async videoFor(c: NoteCtx): Promise<NoteVideo | undefined> {
    const v = this.video;
    if (!v) return undefined;
    const stem = `pointer-${slugify(hasBlock(c.block.name) ? c.block.name : 'note')}-${Date.now()}`;
    return { name: `${stem}.${videoExt(v.mime)}`, mime: v.mime.split(';')[0] || v.mime, ms: v.ms, dataUrl: await blobToDataUrl(v.blob) };
  }

  /**
   * The toast's line about a recording, when one went with the note. A background that says
   * nothing about it is from an older build, which drops recordings.
   */
  private videoLine(sentVideo: boolean, attached: boolean | undefined, error: string | undefined): string[] {
    if (!sentVideo) return [];
    if (attached === undefined) return [`The screen recording wasn't attached: ${STALE_STEPS}`];
    return [attached ? 'Screen recording attached.' : `Screen recording missing: ${error ?? 'unknown reason'}`];
  }

  /** The screenshot, unless the note has a recording: then the recording shows it, and there's no screenshot. */
  private async screenshotUnlessRecorded(c: NoteCtx): Promise<CaptureResponse> {
    if (this.video) {
      this.setBusy(1);
      this.thumb = null;
      return { dataUrl: null };
    }
    this.setBusy(0);
    const capture = await this.captureScreenshot(c);
    this.thumb = capture.dataUrl;
    return capture;
  }

  // ---------- Comment Mode ----------

  /** The open task this note goes on as a comment: Comment Mode found one, and this note wasn't switched to a new task. */
  private commentTarget(): OpenTask | null {
    const t = this.target;
    return t.state === 'found' && !this.targetOverride && this.ctx && !this.ctx.itemId ? t.task : null;
  }

  /**
   * Asks the background which open Pointer task this note would go on: one about the same block
   * on this page, or with page tasks, this page's task. Runs when the note opens and when the
   * project changes; an answer for an older note or project is dropped.
   */
  private lookupTarget(): Promise<void> {
    const c = this.ctx;
    if (!c || c.itemId || !this.init.commentMode || !this.init.keysOk) return this.setTarget({ state: 'off' });
    const mode: Mode = this.pageMode() ? 'page' : 'block';
    if (mode === 'block' && c.block.source === 'none') return this.setTarget({ state: 'no-block' });
    const listId = this.selectedListId;
    if (!listId) return this.setTarget({ state: 'no-project' });
    const key = [listId, mode, pageKeyOf(location), c.block.name, c.block.id].join('|');
    const t = this.target;
    if ((t.state === 'found' || t.state === 'none') && t.key === key && Date.now() - t.at < TARGET_FRESH_MS) return Promise.resolve();
    if (this.targetRun?.key === key) return this.targetRun.done;
    this.setTarget({ state: 'looking', key, mode });
    const done = (async () => {
      let r: FindTaskResponse;
      try {
        r = await send<FindTaskResponse>({ type: 'pointer:find-task', listId, mode, block: c.block, page: c.page });
      } catch (e) {
        r = { ok: false, error: errMsg(e) };
      }
      if (this.targetRun?.key !== key) return; // another note or project since
      this.targetRun = null;
      if (!r.ok) this.setTarget({ state: 'error', key, mode, error: r.error });
      else if (r.task) this.setTarget({ state: 'found', key, mode, task: r.task, at: Date.now() });
      else this.setTarget({ state: 'none', key, mode, at: Date.now() });
    })();
    this.targetRun = { key, done };
    return done;
  }

  /**
   * Before sending: makes sure the note goes where its line says. An answer already on screen is
   * used as it is (a stale one is asked for again). A lookup still running is waited for, with
   * the note saying so, for at most LOOKUP_WAIT_MS; then the note goes ahead without it, as the
   * line promises for a failed check. Esc or the launcher stop the wait: returns false then.
   */
  private async awaitTarget(): Promise<boolean> {
    const t = this.target;
    const stale = (t.state === 'found' || t.state === 'none') && Date.now() - t.at >= TARGET_FRESH_MS;
    if (t.state !== 'looking' && !stale) return true;
    const lookup = this.lookupTarget();
    const running = this.target;
    if (running.state !== 'looking') return true; // answered straight away
    this.busy = true;
    this.setBusy(0, 'Checking ClickUp for an open task');
    let timer = 0;
    const outcome = await new Promise<'done' | 'slow' | 'stopped'>((resolve) => {
      this.cancelWait = () => resolve('stopped');
      timer = window.setTimeout(() => resolve('slow'), LOOKUP_WAIT_MS);
      void lookup.then(() => resolve('done'));
    });
    window.clearTimeout(timer);
    this.cancelWait = null;
    this.busy = false;
    if (outcome === 'stopped') {
      if (this.ctx) {
        this.state = 'edit';
        this.renderNote();
        this.focusInput();
      }
      return false;
    }
    if (outcome === 'slow') {
      // whatever ClickUp says later is for nobody now
      this.targetRun = null;
      this.target = { state: 'error', key: running.key, mode: running.mode, error: 'ClickUp took too long to answer' };
      this.lookupSkipped = `Not checked for an open task: ClickUp took more than ${LOOKUP_WAIT_MS / 1000}s to answer.`;
    }
    return true;
  }

  /** The toast's line about a skipped lookup, once. */
  private takeLookupNote(): string[] {
    const line = this.lookupSkipped;
    this.lookupSkipped = null;
    return line ? [line] : [];
  }

  private setTarget(t: Target): Promise<void> {
    this.target = t;
    this.renderTarget();
    return Promise.resolve();
  }

  private targetView(): TargetView {
    const t = this.target;
    switch (t.state) {
      case 'off':
      case 'no-block':
      case 'no-project':
        return { state: t.state };
      case 'looking':
      case 'none':
        return { state: t.state, mode: t.mode };
      case 'error':
        return { state: 'error', mode: t.mode, error: t.error };
      case 'gone':
        return { state: 'gone', mode: t.mode, name: t.name };
      case 'found':
        return { state: 'found', mode: t.mode, task: t.task, override: this.targetOverride };
    }
  }

  /** Updates the target line, the send hint and the person picker in place, so typing isn't interrupted. */
  private renderTarget() {
    const c = this.ctx;
    if (!c || c.itemId || this.state !== 'edit') return;
    const box = this.note.querySelector('.note-target');
    if (box) box.innerHTML = targetHtml(this.targetView());
    const foot = this.note.querySelector('.note-foot');
    if (foot) foot.innerHTML = noteFoot('edit', this.noteKind(c));
    // a comment keeps the task's assignee
    const assignee = this.note.querySelector<HTMLSelectElement>('.note-assignee');
    if (assignee) assignee.disabled = Boolean(this.commentTarget());
    this.wireTarget();
    this.scheduleReposition();
  }

  private wireTarget() {
    const flip = (override: boolean) => () => {
      this.targetOverride = override;
      this.renderTarget();
      this.focusInput();
    };
    this.note.querySelector('[data-action="target-new"]')?.addEventListener('click', flip(true));
    this.note.querySelector('[data-action="target-comment"]')?.addEventListener('click', flip(false));
  }

  private renderNote() {
    const c = this.ctx;
    if (!c) return;
    const index = c.itemId ? (this.pageTask?.items.findIndex((i) => i.id === c.itemId) ?? -1) : -1;
    const itemVideo = index >= 0 ? this.pageTask?.items[index]?.video : undefined;
    this.note.innerHTML = noteHtml({
      state: this.state,
      kind: this.noteKind(c),
      ...(index >= 0 ? { itemNumber: index + 1 } : {}),
      blockName: c.block.source === 'none' ? null : c.block.name,
      environment: c.page.environment,
      elementSelector: c.element.selector,
      projectOptions: this.projectOptions(),
      projectChosen: Boolean(this.selectedListId),
      assigneeOptions: this.assigneeOptions(),
      draft: c.itemId ? this.itemDraft : this.draft,
      canRecord: canRecord(),
      video: this.video ? { url: this.video.url, ms: this.video.ms, size: this.video.blob.size } : null,
      ...(itemVideo ? { itemVideoMs: itemVideo.ms } : {}),
      step: this.step,
      ...(this.busyLabel ? { busyLabel: this.busyLabel } : {}),
      thumb: this.thumb,
      review: this.reviewDraft,
      error: this.error,
      target: this.targetView(),
    });
    this.wireNote();
    this.wireTarget();
    this.placeNote();
  }

  private wireNote() {
    const select = this.select();
    select?.addEventListener('change', () => {
      this.selectedListId = select.value;
      select.classList.toggle('is-empty', !select.value);
      this.targetOverride = false;
      void this.lookupTarget(); // another project has other open tasks
      this.focusInput();
    });
    const assignee = this.note.querySelector<HTMLSelectElement>('.note-assignee');
    fitSelect(assignee);
    assignee?.addEventListener('change', () => {
      fitSelect(assignee);
      this.assigneeId = assignee.value;
      this.assigneePicked = true;
      this.focusInput();
      this.scheduleReposition(); // the picker's width follows the name
    });

    const input = this.input();
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.submit();
      }
    });
    input?.addEventListener('input', () => {
      if (this.ctx?.itemId) this.itemDraft = input.value;
      else this.draft = input.value;
      this.scheduleReposition(); // the note grows with its text
    });

    const create = wireReview(this.note, this.reviewDraft, (d) => this.finishReview(d), () => this.scheduleReposition());
    if (input) autoGrow(input);

    const on = (action: string, fn: () => void) => this.note.querySelector(`[data-action="${action}"]`)?.addEventListener('click', fn);
    on('close', () => this.dismissNote());
    on('remove', () => void this.removeItem());
    on('record', () => void this.startRecording());
    on('remove-video', () => {
      this.clearVideo();
      this.renderNote();
      this.focusInput();
    });
    on('create', () => create?.());
    on('back', () => this.finishReview(null));
    on('retry', () => {
      this.state = 'edit';
      this.renderNote();
      this.focusInput();
    });
    on('options', () => void send({ type: 'pointer:open-options' }));

  }

  private setBusy(step: number, label: string | null = null) {
    this.state = 'busy';
    this.step = step;
    this.busyLabel = label;
    this.renderNote();
  }

  private showError(error: NoteError) {
    this.state = 'error';
    this.error = error;
    this.renderNote();
  }

  // ---------- Submit ----------

  private async submit() {
    const c = this.ctx;
    if (!c || this.busy) return;
    const note = (this.input()?.value ?? '').trim();
    const select = this.select();
    if (!note) {
      shake(this.note);
      this.focusInput();
      return;
    }
    const project = this.projectFor(select?.value ?? '');
    if (!project) {
      shake(select);
      select?.focus();
      return;
    }
    if (this.stale) {
      this.showError({ title: 'Pointer needs reloading', detail: STALE_STEPS, showOptions: false });
      return;
    }
    if (c.itemId) return this.saveItem(c.itemId, note, project);
    // Comment Mode: wait for the lookup (it started when the note opened), then send the note where it belongs
    if (this.init.commentMode && this.init.keysOk) {
      if (!(await this.awaitTarget()) || this.ctx !== c) return; // stopped, or closed meanwhile
      const task = this.commentTarget();
      if (task) return this.sendComment(c, note, project, task);
    }
    if (this.pageMode()) return this.addToPage(c, note, project);
    if (!this.init.keysOk) {
      this.showError({
        title: 'Finish setting up Pointer',
        detail: `Add your ${this.init.missing.join(' and ')} in the Pointer options.`,
        showOptions: true,
      });
      return;
    }

    this.draft = note;
    this.selectedListId = project.listId;
    this.busy = true;
    this.thumb = null;

    // 1. capture (our UI is hidden so it isn't in the screenshot); a recording replaces the screenshot
    const capture = await this.screenshotUnlessRecorded(c);
    const video = await this.videoFor(c);

    const submission: NoteSubmission = {
      note,
      block: c.block,
      element: c.element,
      page: c.page,
      projectLabel: project.label,
      project,
      prepared: null,
      screenshot: capture.dataUrl,
      ...(capture.error ? { screenshotError: `capture failed: ${capture.error}` } : {}),
      ...(video ? { video } : {}),
      assigneeId: this.assigneeId,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      browser: browserLabel(navigator.userAgent),
    };

    // 2. optional review: the task's name and whole description, rewritten and ready to edit
    const reviewing = this.init.reviewBeforeSend;
    if (reviewing) {
      this.setBusy(1);
      let p: PrepareResponse;
      try {
        p = await send<PrepareResponse>({ type: 'pointer:prepare', submission: { ...submission, screenshot: null, video: describedOnly(video) } });
      } catch (e) {
        p = { ok: false, error: errMsg(e) };
      }
      if (!p.ok) {
        this.busy = false;
        this.showError({ title: "The task couldn't be prepared", detail: p.error, showOptions: false });
        return;
      }
      this.reviewDraft = { ...p.draft, ...(p.rewriteError ? { note: rewriteNote(p.rewriteError) } : {}) };
      const edited = await this.review();
      if (!edited) {
        this.busy = false;
        this.state = 'edit';
        this.renderNote();
        this.focusInput();
        return;
      }
      submission.edited = edited;
      submission.rewritten = p.rewritten;
    }

    // 3. rewrite (unless reviewed) and create the task
    this.setBusy(reviewing ? 2 : 1, video ? 'Creating the task and uploading the recording' : null);
    let result: SubmitResult;
    try {
      result = await send<SubmitResult>({ type: 'pointer:submit', submission });
    } catch (e) {
      result = { ok: false, stage: 'task', error: errMsg(e) };
    }
    this.busy = false;

    if (result.ok) {
      this.init.remembered = project;
      this.draft = '';
      this.clearVideo();
      this.closeNote();
      this.showCreated(result, Boolean(video));
    } else {
      const setup = result.stage === 'keys';
      this.showError({
        title: setup ? 'Finish setting up Pointer' : "The task wasn't created",
        detail: result.error,
        showOptions: setup,
      });
    }
  }

  /** Comment Mode: the note, rewritten, goes on the open task as a comment; its screenshot into the task's attachments. */
  private async sendComment(c: NoteCtx, note: string, project: ProjectRef, task: OpenTask) {
    this.draft = note;
    this.selectedListId = project.listId;
    this.busy = true;
    this.thumb = null;

    const capture = await this.screenshotUnlessRecorded(c);
    const video = await this.videoFor(c);
    const submission: NoteSubmission = {
      note,
      block: c.block,
      element: c.element,
      page: c.page,
      projectLabel: project.label,
      project,
      prepared: null,
      screenshot: capture.dataUrl,
      ...(capture.dataUrl ? { screenshotName: `pointer-${slugify(hasBlock(c.block.name) ? c.block.name : 'note')}-${Date.now()}.png` } : {}),
      ...(capture.error ? { screenshotError: `capture failed: ${capture.error}` } : {}),
      ...(video ? { video } : {}),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      browser: browserLabel(navigator.userAgent),
    };

    if (this.init.reviewBeforeSend) {
      this.setBusy(1);
      let p: PrepareResponse;
      try {
        p = await send<PrepareResponse>({ type: 'pointer:prepare', submission: { ...submission, screenshot: null, video: describedOnly(video) }, as: 'comment' });
      } catch (e) {
        p = { ok: false, error: errMsg(e) };
      }
      if (!p.ok) {
        this.busy = false;
        this.showError({ title: "The comment couldn't be prepared", detail: p.error, showOptions: false });
        return;
      }
      this.reviewDraft = { ...p.draft, commentOn: task.name, ...(p.rewriteError ? { note: rewriteNote(p.rewriteError) } : {}) };
      const edited = await this.review();
      if (!edited) {
        this.busy = false;
        this.state = 'edit';
        this.renderNote();
        this.focusInput();
        return;
      }
      submission.edited = edited;
      submission.rewritten = p.rewritten;
    }

    this.setBusy(2, video ? 'Adding the comment and uploading the recording' : null);
    const found = this.target;
    let r: CommentResult;
    try {
      r = await send<CommentResult>({ type: 'pointer:comment', submission, task });
    } catch (e) {
      r = { ok: false, stage: 'task', error: errMsg(e) };
    }
    this.busy = false;
    if (!r.ok && r.stage === 'closed' && found.state === 'found') {
      // closed since the note found it: the note says so, keeps its text, and Enter makes a new one
      this.target = { state: 'gone', key: found.key, mode: found.mode, name: task.name };
      this.state = 'edit';
      this.renderNote();
      this.focusInput();
      return;
    }
    if (!r.ok) {
      const setup = r.stage === 'keys';
      this.showError({ title: setup ? 'Finish setting up Pointer' : "The comment wasn't added", detail: r.error, showOptions: setup });
      return;
    }
    this.init.remembered = project;
    this.draft = '';
    this.clearVideo();
    this.closeNote();
    const meta: string[] = this.videoLine(Boolean(video), r.video, r.videoError);
    if (!r.screenshot && !video) meta.push(`Screenshot missing: ${r.screenshotError ?? 'unknown reason'}`);
    // only a rewrite that failed is news; without a Z.ai key, notes go as written on purpose
    if (!r.rewritten && r.rewriteError) meta.push(`Sent without rewriting: ${r.rewriteError}`);
    this.showToast({ title: `Comment added to ${task.name}`, icon: 'check', meta, link: task.url, undo: true }, UNDO_MS);
    const { commentId } = r;
    const files = [r.screenshot ? 'screenshot' : '', r.video ? 'recording' : ''].filter(Boolean);
    this.toast.querySelector('[data-action="undo"]')?.addEventListener('click', () => void this.undoComment(commentId, files));
  }

  private async undoComment(commentId: string, files: string[]) {
    this.showToast({ title: 'Deleting the comment…' }, 30_000);
    try {
      const r = await send<{ ok?: boolean; error?: string } | undefined>({ type: 'pointer:comment-undo', commentId });
      if (!r?.ok) throw new Error(r?.error ?? 'No answer from the extension');
      // ClickUp's API can't delete attachments, so the screenshot (and recording) stay
      const meta = files.length ? [`Its ${files.join(' and ')} ${files.length === 1 ? 'stays' : 'stay'} in the task's attachments.`] : [];
      this.showToast({ title: 'Comment deleted', icon: 'check', meta }, 4000);
    } catch (e) {
      this.showToast({ title: "Couldn't delete the comment", icon: 'alert', meta: [errMsg(e)] }, 6000);
    }
  }

  // ---------- Page task: adding, changing and publishing notes ----------

  /** Page-task mode: the note and its screenshot are kept, and its pin stays on the page. */
  private async addToPage(c: NoteCtx, note: string, project: ProjectRef) {
    this.draft = note;
    this.selectedListId = project.listId;
    this.busy = true;
    this.thumb = null;
    const key = this.pageKey;
    const anchor = this.anchorFor(c); // before the capture scrolls the page

    const capture = await this.screenshotUnlessRecorded(c);
    const video = this.video;
    const videoData = video ? await blobToDataUrl(video.blob) : null;
    this.setBusy(1);
    let r: PageTaskResponse;
    try {
      r = await send<PageTaskResponse>({
        type: 'pointer:page-add',
        key,
        page: c.page,
        project,
        assigneeId: this.assigneeId,
        note: {
          note,
          block: c.block,
          element: c.element,
          anchor,
          ...(capture.error ? { screenshotError: `capture failed: ${capture.error}` } : {}),
          ...(video ? { video: { mime: video.mime.split(';')[0] || video.mime, ms: video.ms } } : {}),
        },
        screenshot: capture.dataUrl,
        video: videoData,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        browser: browserLabel(navigator.userAgent),
      });
    } catch (e) {
      r = { ok: false, error: errMsg(e) };
    }
    this.busy = false;
    if (!r.ok) {
      this.showError({ title: "The note wasn't added", detail: r.error, showOptions: false });
      return;
    }
    this.draft = '';
    this.clearVideo();
    this.closeNote();
    if (key === this.pageKey) this.setPageTask(r.task);
    const n = r.task?.items.length ?? 0;
    const meta = [
      ...this.takeLookupNote(),
      ...(video ? [`With its screen recording (${clock(video.ms)}).`] : []),
      capture.dataUrl || video ? 'Add more, then press Publish task.' : `No screenshot: ${capture.error ?? 'unknown reason'}`,
    ];
    this.showToast({ title: `Note ${n} added to the page task`, icon: 'check', meta }, 3500);
  }

  private async saveItem(itemId: string, note: string, project: ProjectRef) {
    this.selectedListId = project.listId;
    this.busy = true;
    let r: PageTaskResponse;
    try {
      r = await send<PageTaskResponse>({ type: 'pointer:page-update', key: this.pageKey, itemId, note, project, assigneeId: this.assigneeId });
    } catch (e) {
      r = { ok: false, error: errMsg(e) };
    }
    this.busy = false;
    if (!r.ok) {
      this.showError({ title: "The note wasn't saved", detail: r.error, showOptions: false });
      return;
    }
    this.closeNote();
    this.setPageTask(r.task);
    this.showToast({ title: 'Note saved', icon: 'check' }, 2000);
  }

  private async removeItem() {
    const itemId = this.ctx?.itemId;
    if (!itemId || this.busy) return;
    this.busy = true;
    let r: PageTaskResponse;
    try {
      r = await send<PageTaskResponse>({ type: 'pointer:page-remove', key: this.pageKey, itemId });
    } catch (e) {
      r = { ok: false, error: errMsg(e) };
    }
    this.busy = false;
    if (!r.ok) {
      this.showError({ title: "The note wasn't removed", detail: r.error, showOptions: false });
      return;
    }
    this.closeNote();
    this.setPageTask(r.task);
    this.showToast({ title: 'Note removed', icon: 'check' }, 2000);
  }

  /** The Publish task button: one ClickUp task from every note on the page. */
  private async publish() {
    const n = this.pageTask?.items.length ?? 0;
    if (!n || this.busy) return;
    if (this.stale) return this.showStale();
    if (this.initLoaded && !this.init.keysOk) {
      void send({ type: 'pointer:open-options' }).catch(() => {});
      return;
    }
    if (this.ctx) {
      if (this.state !== 'edit') return;
      this.closeNote(); // a new note's draft is kept for later
    }
    const key = this.pageKey;
    const notes = `${n} ${n === 1 ? 'note' : 'notes'}`;
    this.busy = true;

    // with "Review the rewrite" on, the task's name and description can be changed first
    let edited: TaskDraft | undefined;
    if (this.init.reviewBeforeSend) {
      this.showToast({ title: `Getting ${notes} ready…` }, 120_000);
      let p: PagePrepareResponse;
      try {
        p = await send<PagePrepareResponse>({ type: 'pointer:page-prepare', key });
      } catch (e) {
        p = { ok: false, stage: 'task', error: errMsg(e) };
      }
      this.hideToast();
      const reviewed = p.ok ? await this.reviewSheet(p) : null;
      if (!reviewed) {
        this.busy = false;
        if (!p.ok) {
          const title = p.stage === 'keys' ? 'Finish setting up Pointer' : "The task couldn't be prepared";
          this.showToast({ title, icon: 'alert', meta: [p.error, 'Your notes are kept.'] }, 8000);
        }
        return;
      }
      edited = reviewed;
    }

    this.publishing = true;
    this.renderDock();
    this.showToast({ title: `Publishing ${notes}…` }, 120_000);
    let r: PublishResult;
    try {
      r = await send<PublishResult>({ type: 'pointer:page-publish', key, ...(edited ? { edited } : {}) });
    } catch (e) {
      r = { ok: false, stage: 'task', error: errMsg(e) };
    }
    this.busy = false;
    this.publishing = false;
    if (!r.ok) {
      this.renderDock();
      const title = r.stage === 'keys' ? 'Finish setting up Pointer' : "The task wasn't created";
      this.showToast({ title, icon: 'alert', meta: [r.error, 'Your notes are kept.'] }, 8000);
      return;
    }
    if (key === this.pageKey) this.setPageTask(null);
    const meta: string[] = [];
    if (r.screenshotErrors.length) meta.push(`${r.screenshotErrors.length} screenshot${r.screenshotErrors.length === 1 ? '' : 's'} missing. ${r.screenshotErrors[0]}`);
    if (r.videoErrors.length) meta.push(`${r.videoErrors.length} screen recording${r.videoErrors.length === 1 ? '' : 's'} missing. ${r.videoErrors[0]}`);
    if (r.unrewritten) meta.push(`${r.unrewritten} sent without rewriting${r.rewriteError ? `: ${r.rewriteError}` : ''}`);
    this.showToast({ title: `Task created from ${r.notes} ${r.notes === 1 ? 'note' : 'notes'}`, icon: 'check', meta, link: r.task.url, undo: true }, UNDO_MS);
    const taskId = r.task.id;
    this.toast.querySelector('[data-action="undo"]')?.addEventListener('click', () => void this.undoPublish(key, taskId));
  }

  private async undoPublish(key: string, taskId: string) {
    this.showToast({ title: 'Deleting the task…' }, 30_000);
    try {
      const r = await send<{ ok?: boolean; restored?: boolean; error?: string } | undefined>({ type: 'pointer:page-undo', key, taskId });
      if (!r?.ok) throw new Error(r?.error ?? 'No answer from the extension');
      if (key === this.pageKey) await this.loadPageTask();
      this.showToast({ title: r.restored ? 'Task deleted. Your notes are back.' : 'Task deleted', icon: 'check' }, 3000);
    } catch (e) {
      this.showToast({ title: "Couldn't delete the task", icon: 'alert', meta: [errMsg(e)] }, 6000);
    }
  }

  private review(): Promise<TaskDraft | null> {
    this.state = 'review';
    this.renderNote();
    return new Promise((resolve) => {
      this.reviewResolve = resolve;
    });
  }

  private finishReview(d: TaskDraft | null) {
    const resolve = this.reviewResolve;
    this.reviewResolve = null;
    resolve?.(d);
  }

  /** The page task's review: its name and whole description in a sheet above the dock. */
  private reviewSheet(p: Extract<PagePrepareResponse, { ok: true }>): Promise<TaskDraft | null> {
    const review: Review = { ...p.draft, ...(p.rewriteError ? { note: rewriteNote(p.rewriteError, p.unrewritten) } : {}) };
    this.sheet.innerHTML = sheetHtml({ ...review, notes: p.notes });
    this.replay(this.sheet, 'is-open'); // shown first, so the name field can take focus
    const publish = wireReview(this.sheet, review, (d) => this.finishSheet(d), () => {});
    this.sheet.querySelector('[data-action="sheet-publish"]')?.addEventListener('click', () => publish?.());
    for (const back of Array.from(this.sheet.querySelectorAll('[data-action="sheet-back"]'))) back.addEventListener('click', () => this.finishSheet(null));
    return new Promise((resolve) => {
      this.sheetResolve = resolve;
    });
  }

  private finishSheet(d: TaskDraft | null) {
    const resolve = this.sheetResolve;
    this.sheetResolve = null;
    this.sheet.classList.remove('is-open');
    this.sheet.innerHTML = ''; // no stale fields left behind for the note's own review
    resolve?.(d);
  }

  private async captureScreenshot(c: NoteCtx): Promise<CaptureResponse> {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    // Hide the whole shadow tree in one go; visibility (unlike display) replays no animations.
    this.host.style.visibility = 'hidden';
    try {
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      const dpr = window.devicePixelRatio || 1;
      // React can replace the clicked node between click and capture. Fall back to the block,
      // then to the whole viewport with the marker where the pin was.
      const target = c.targetEl.isConnected ? c.targetEl : c.blockEl?.isConnected ? c.blockEl : null;
      if (!target) {
        await nextFrame();
        await nextFrame();
        const p = this.pinAt;
        const capture: CaptureRequest = {
          block: { x: 0, y: 0, w: viewport.w, h: viewport.h },
          element: { x: p.x - 40, y: p.y - 40, w: 80, h: 80 },
          click: p,
          dpr,
          viewport,
        };
        return await send<CaptureResponse>({ type: 'pointer:capture', capture });
      }
      const blockEl = c.blockEl?.isConnected ? c.blockEl : target;
      blockEl.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy(0, -16);
      await nextFrame();
      await nextFrame();
      let er = target.getBoundingClientRect();
      if (er.top < 0 || er.bottom > window.innerHeight) {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        await nextFrame();
        await nextFrame();
        er = target.getBoundingClientRect();
      }
      const br = blockEl.getBoundingClientRect();
      const block: Rect = c.blockEl?.isConnected ? toRect(br) : { x: er.left - 40, y: er.top - 40, w: er.width + 80, h: er.height + 80 };
      const click =
        target === c.targetEl ? { x: er.left + c.offset.x, y: er.top + c.offset.y } : { x: er.left + er.width / 2, y: er.top + er.height / 2 };
      const capture: CaptureRequest = { block, element: toRect(er), click, dpr, viewport };
      return await send<CaptureResponse>({ type: 'pointer:capture', capture });
    } catch (e) {
      return { dataUrl: null, error: errMsg(e) };
    } finally {
      window.scrollTo(scrollX, scrollY);
      this.host.style.visibility = '';
      this.reposition();
    }
  }

  // ---------- Toast ----------

  private showStale() {
    this.showToast({ title: 'Pointer needs reloading', icon: 'alert', meta: [STALE_STEPS] }, 12_000);
  }

  private hideToast() {
    window.clearTimeout(this.toastTimer);
    this.toast.classList.remove('is-visible');
  }

  private showToast(t: ToastModel, ms: number) {
    window.clearTimeout(this.toastTimer);
    this.toast.innerHTML = toastHtml(t);
    this.toast.querySelector<HTMLElement>('.toast-timer')?.style.setProperty('animation-duration', `${ms}ms`);
    this.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('is-visible'), ms);
  }

  private showCreated(res: Extract<SubmitResult, { ok: true }>, sentVideo: boolean) {
    const meta: string[] = [...this.takeLookupNote(), ...this.videoLine(sentVideo, res.video, res.videoError)];
    if (!res.screenshot && !sentVideo) meta.push(`Screenshot missing: ${res.screenshotError ?? 'unknown reason'}`);
    if (!res.rewritten && res.rewriteError) meta.push(`Sent without rewriting: ${res.rewriteError}`);
    this.showToast({ title: 'Task created', icon: 'check', meta, link: res.task.url, undo: true }, UNDO_MS);
    this.toast.querySelector('[data-action="undo"]')?.addEventListener('click', () => void this.undo(res.task.id));
  }

  private async undo(taskId: string) {
    this.showToast({ title: 'Deleting the task…' }, 30_000);
    try {
      const r = await send<{ ok?: boolean; error?: string } | undefined>({ type: 'pointer:undo', taskId });
      if (!r?.ok) throw new Error(r?.error ?? 'No answer from the extension');
      this.showToast({ title: 'Task deleted', icon: 'check' }, 2500);
    } catch (e) {
      this.showToast({ title: "Couldn't delete the task", icon: 'alert', meta: [errMsg(e)] }, 6000);
    }
  }
}

// The background injects this file once the detector (detector.ts) recognises a bid site.
// The flag lives in the extension's own script world, so a second injection is a no-op.
const injected = globalThis as unknown as { __bidPointer?: boolean };
if (window.top === window && !injected.__bidPointer) {
  injected.__bidPointer = true;
  new Pointer();
}
