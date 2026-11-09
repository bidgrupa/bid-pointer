// Types shared between the content script, the background worker and the options page.

import type { EmailPayload, EmailSplit, EmailTaskPlan } from './email';
import type { Environment } from './site';
import type { SeoRequest } from './seo/types';

export type { Environment };

export type BlockInfo = {
  name: string;
  id: string;
  /** Where the name came from: data attributes (future), the debug label span (today), or nothing. */
  source: 'data-attr' | 'debug-span' | 'none';
};

export type ElementInfo = {
  /** Short CSS-ish path, e.g. `section > button.btn-primary` */
  selector: string;
  /** Visible text of the clicked element, trimmed to ~120 chars. Empty if none. */
  text: string;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type CaptureRequest = {
  block: Rect;
  element: Rect;
  click: { x: number; y: number };
  dpr: number;
  viewport: { w: number; h: number };
};

export type ProjectRef = { listId: string; label: string };

export type PageInfo = {
  url: string;
  host: string;
  path: string;
  title: string;
  /** Staging (Vercel preview), production (a live site with a bid footer) or local. */
  environment: Environment;
  /** Key used to remember the chosen project: the Vercel project name (branch previews collapse to it), or the host. */
  projectKey: string;
  /** Human label for the page link, e.g. `pages-bluesun` */
  repoLabel: string;
  slugCandidates: string[];
};

export type Prepared = { title: string; bullets: string[] };

export type RewriteContext = {
  note: string;
  block: BlockInfo;
  element: ElementInfo;
  page: PageInfo;
  projectLabel: string;
};

/**
 * A screen recording that goes with a note: the attachment's name (the description mentions it),
 * its type and length, and the file itself as a data URL. Without `dataUrl` it only describes one
 * (for the review, so the video isn't sent twice).
 */
export type NoteVideo = { name: string; mime: string; ms: number; dataUrl?: string };

/** A task as it will go to ClickUp: its name and its whole Markdown description. */
export type TaskDraft = { name: string; description: string };

export type NoteSubmission = RewriteContext & {
  project: ProjectRef;
  /** A rewrite done earlier; when null the background rewrites itself. */
  prepared: Prepared | null;
  /** The name and description as edited in the review, sent exactly as they are. */
  edited?: TaskDraft;
  /** With `edited`: whether the reviewed text came from a rewrite (else the task is tagged needs-rewrite). */
  rewritten?: boolean;
  /** For a comment: the name its screenshot is attached under, which the comment mentions. */
  screenshotName?: string;
  /** A screen recording to attach as well. */
  video?: NoteVideo;
  /** PNG data URL from the capture step, or null when capture failed. */
  screenshot: string | null;
  /** Why the capture step failed, if it did. */
  screenshotError?: string;
  viewport: { w: number; h: number };
  browser: string;
  /** ClickUp user id picked in the note; '' means no one. Missing means the default from settings. */
  assigneeId?: string;
  /** Set by the background when the user declined Firefox's optional technical-data permission. */
  omitTechnical?: boolean;
  /** Filled in by the background from the logged-in ClickUp user. */
  reporter?: string;
};

// ---------- Page tasks: several notes on one page, published as one task ----------

/** Where a page-task note's pin sits, so it can be put back after a reload. */
export type PinAnchor = {
  /** CSS path to the clicked element. */
  path: string;
  /** The spot inside that element, as fractions of its width and height. */
  fx: number;
  fy: number;
  /** The spot in page coordinates, for when the element can't be found again. */
  pageX: number;
  pageY: number;
};

export type PageTaskItem = {
  id: string;
  note: string;
  block: BlockInfo;
  element: ElementInfo;
  anchor: PinAnchor;
  /** True when a screenshot is stored for it (under `pageShot:<id>`). */
  screenshot: boolean;
  screenshotError?: string;
  /** A screen recording stored with it (under `pageVideo:<id>`): its type and length. */
  video?: { mime: string; ms: number };
  /** Rewritten in the background after the note is added; null until then, or when that failed. */
  prepared: Prepared | null;
  createdAt: number;
};

export type PageTask = {
  /** The page's address without query or hash (pageKeyOf). */
  key: string;
  page: PageInfo;
  project: ProjectRef | null;
  /** ClickUp user id; '' means no one. */
  assigneeId: string;
  items: PageTaskItem[];
  viewport: { w: number; h: number };
  browser: string;
  updatedAt: number;
  /** Set right after publishing, so Undo can bring the notes back. */
  published?: { taskId: string; at: number };
};

/** A note to add to a page task, as the content script sends it. */
export type PageTaskNote = Omit<PageTaskItem, 'id' | 'screenshot' | 'prepared' | 'createdAt'>;

export type PageTaskResponse = { ok: true; task: PageTask | null } | { ok: false; error: string };

/** A task ready for review: rewritten where possible, built, not yet sent. */
export type PrepareResponse = { ok: true; draft: TaskDraft; rewritten: boolean; rewriteError?: string } | { ok: false; error: string };

export type PagePrepareResponse =
  | { ok: true; draft: TaskDraft; notes: number; unrewritten: number; rewriteError?: string }
  | { ok: false; stage: 'keys' | 'task'; error: string };

export type PublishResult =
  | {
      ok: true;
      task: RecentTask;
      notes: number;
      /** How many notes went out without a rewrite, and why the first one failed. */
      unrewritten: number;
      rewriteError?: string;
      /** Screenshots that didn't make it, one line each. */
      screenshotErrors: string[];
      /** Recordings that didn't make it, one line each. */
      videoErrors: string[];
    }
  | { ok: false; stage: 'keys' | 'task'; error: string };

// ---------- Comment Mode ----------

/** An open Pointer task a new note can go on as a comment. */
export type OpenTask = { id: string; name: string; url: string; status: string; kind: 'single' | 'page' };

export type FindTaskResponse = { ok: true; task: OpenTask | null } | { ok: false; error: string };

export type CommentResult =
  | {
      ok: true;
      task: OpenTask;
      commentId: string;
      rewritten: boolean;
      rewriteError?: string;
      screenshot: boolean;
      screenshotError?: string;
      /** Set when a recording went with the note. */
      video?: boolean;
      videoError?: string;
    }
  /** `closed`: the matched task was closed (or deleted) since; the note can become a new task. */
  | { ok: false; stage: 'keys' | 'task' | 'closed'; error: string };

export type ClickUpUser = { id: number; username: string; email: string };

/** Someone a task can be assigned to: a member of the ClickUp workspace. */
export type Member = { id: number; name: string };

export type RecentTask = {
  /** The task's id; for a comment, the id of the task it went on. */
  id: string;
  /** Set when this was a comment on an existing task (Comment Mode). */
  commentId?: string;
  url: string;
  name: string;
  createdAt: number;
  projectLabel: string;
  screenshot: boolean;
  /** Why the screenshot is missing (capture or upload error), for the options page. */
  screenshotError?: string;
  /** Set when a screen recording went with it: whether it was attached. */
  video?: boolean;
  /** Why the recording is missing, for the options page. */
  videoError?: string;
  /** Set for a task made from an email (Gmail, or a HubSpot ticket): how many of its files were attached, and how many weren't. */
  email?: { files: number; missing: number; error?: string; app?: 'Gmail' | 'HubSpot' };
  /** Set for a task made by the SEO check: how many findings went into it. */
  seo?: { findings: number };
};

export type Settings = {
  /** The person's own Z.ai key. Optional: without one, notes go to ClickUp as written. */
  zaiKey: string;
  /** Personal API token pasted in the options page. */
  clickupToken: string;
  /** Resolved from the token when it is saved; used for "reported by". */
  clickupUser: ClickUpUser | null;
  /** Default assignee for new tasks, a ClickUp user id; '' assigns no one. */
  assigneeId: string;
  /** That person's name, so notes can show it before the member list has loaded. */
  assigneeName: string;
  /** The ClickUp space whose folders and lists are the projects; '' until one is chosen. */
  spaceId: string;
  /** That space's name, with its workspace's ("Workspace › Space"), for the settings page. */
  spaceName: string;
  /**
   * The default assignee is a coding agent (bid's Mate is one): Send to ClickUp then gives it only
   * clear, small changes in a named place, and everything else to a person.
   */
  codingAgent: boolean;
  /** Hosts where Pointer starts by itself, besides localhost; `*` matches anything. Count as staging. */
  sites: string[];
  /**
   * Domains an agency credits itself with in its clients' footers ("bid.agency, bid.hr"): a page
   * whose footer links to one, or names it, gets Pointer too, as a live site. '' turns it off.
   */
  footerCredit: string;
  /** When the person agreed to what Pointer sends where (ISO time); '' until then. Not asked in Firefox, which asks at install. */
  consentAt: string;
  reviewBeforeSend: boolean;
  /** "Enable Page Specific Task": notes collect on the page and go out together as one task. */
  pageTask: boolean;
  /** "Comment Mode": a note about something with an open Pointer task becomes a comment on that task. */
  commentMode: boolean;
  /** "SEO checker": the SEO button beside Pointer, which checks the page the way Google reads it. */
  seoCheck: boolean;
  /** projectKey → project chosen the last time a task was created there; wins over the URL suggestion. */
  hostProjects: Record<string, ProjectRef>;
  /** Send to ClickUp: the project last chosen for a sender's domain (or address, for webmail). */
  domainProjects: Record<string, ProjectRef>;
  recent: RecentTask[];
};

// ---------- Send to ClickUp (Gmail) ----------

/** What Send to ClickUp needs before the tasks can be shown or made. */
export type EmailPrepareResponse =
  | {
      ok: true;
      split: EmailSplit;
      plans: EmailTaskPlan[];
      /** Set when GLM couldn't split the email: why. It then goes as one task. */
      unsplit?: string;
      /**
       * Who each route goes to (see routeAssignees): the default assignee (Mate unless changed), and
       * whoever runs Pointer, never Mate's own account. `mateAccount` is Mate itself, whom a task the
       * rules keep from Mate must not follow the first task to. From a HubSpot ticket with an owner
       * in ClickUp, `person` is that owner (`owner` true).
       */
      assignees: { mate: Member | null; person: Member | null; mateAccount: Member | null; owner?: boolean };
      reporter?: string;
      projects: {
        all: ProjectRef[];
        suggested: ProjectRef | null;
        /** Fine to use without asking: it's the sender's remembered project, and nothing in the email points elsewhere. */
        sure: boolean;
        /** The project last chosen for this sender, if any. */
        remembered: ProjectRef | null;
        /** What the email itself points to (see recognizeProject), and why. */
        recognized: { listId: string; why: string; strong: boolean } | null;
        /** The choice may be remembered for this sender (not bid's own domain). */
        rememberable: boolean;
        error?: string;
      };
      /** What the project choice is remembered by (see senderKey). */
      senderKey: string;
    }
  | { ok: false; stage: 'keys' | 'task'; error: string };

export type EmailPublish = {
  project: ProjectRef;
  senderKey: string;
  /** Remember the project for the sender (not when the email itself named it, nor for bid's own domain). */
  remember: boolean;
  tasks: { name: string; description: string; assigneeId: string; priority: 'high' | null; due: string | null; tags: string[] }[];
  /** Ids of the messages these tasks came from (Gmail's, or Pointer's for HubSpot), remembered so they aren't sent twice. */
  messageIds: string[];
  /** Where the email was read, for the options page's Recent tasks. */
  app?: 'Gmail' | 'HubSpot';
};

export type CreatedTask = { id: string; url: string; name: string };

export type EmailPublishResult =
  /** `index`: the task's place in the request, so its files can follow it. */
  | { ok: true; created: (CreatedTask & { index: number })[]; failed: { name: string; error: string }[] }
  | { ok: false; stage: 'keys' | 'task'; error: string };

/** Messages already sent to ClickUp (storage.local `emailSent`), by message id (Gmail's, or `hs:` ones for HubSpot). */
export type SentEmails = Record<string, { at: number; tasks: CreatedTask[] }>;

export type InitResponse = {
  keysOk: boolean;
  missing: string[];
  user: ClickUpUser | null;
  remembered: ProjectRef | null;
  reviewBeforeSend: boolean;
  pageTask: boolean;
  commentMode: boolean;
  seoCheck: boolean;
  /** The person's site list (see Settings.sites): those hosts count as staging. */
  sites: string[];
  /** The team's own email domains (see teamDomains): Send to ClickUp reads their messages as context. */
  ours: string[];
  /** Who new notes are assigned to unless someone else is picked; null assigns no one. */
  defaultAssignee: Member | null;
  /** The point-mode shortcut as the browser shows it, e.g. "Alt+Shift+P"; '' when none is set. */
  shortcut: string;
  /** The background's build; a page script from another build means Pointer wasn't reloaded. */
  build?: string;
};

export type MembersResponse = { members: Member[]; error?: string };

export type ProjectsResponse = {
  all: ProjectRef[];
  suggested: ProjectRef[];
  /** The URL suggestion to pre-select, when exactly one project matches best. */
  best: ProjectRef | null;
  error?: string;
};
export type CaptureResponse = { dataUrl: string | null; error?: string };

export type SubmitResult =
  | {
      ok: true;
      task: RecentTask;
      rewritten: boolean;
      screenshot: boolean;
      rewriteError?: string;
      screenshotError?: string;
      /** Set when a recording went with the note. */
      video?: boolean;
      videoError?: string;
    }
  | { ok: false; stage: 'keys' | 'task'; error: string };

export type Msg =
  | { type: 'pointer:init'; projectKey: string }
  | { type: 'pointer:projects'; page: PageInfo }
  | { type: 'pointer:members' }
  /** From the detector: this page is a bid site, inject the full Pointer. */
  | { type: 'pointer:activate' }
  | { type: 'pointer:capture'; capture: CaptureRequest }
  /** `as: 'comment'` builds the comment text instead of a task description. */
  | { type: 'pointer:prepare'; submission: NoteSubmission; as?: 'task' | 'comment' }
  /** Comment Mode: the open task this note would go on, if any. */
  | { type: 'pointer:find-task'; listId: string; mode: 'block' | 'page'; block: BlockInfo; page: PageInfo }
  | { type: 'pointer:comment'; submission: NoteSubmission; task: OpenTask }
  | { type: 'pointer:comment-undo'; commentId: string }
  | { type: 'pointer:submit'; submission: NoteSubmission }
  | { type: 'pointer:undo'; taskId: string }
  | { type: 'pointer:page-get'; key: string }
  | {
      type: 'pointer:page-add';
      key: string;
      page: PageInfo;
      project: ProjectRef;
      assigneeId: string;
      note: PageTaskNote;
      screenshot: string | null;
      /** The recording, as a data URL; its type and length are in `note.video`. */
      video: string | null;
      viewport: { w: number; h: number };
      browser: string;
    }
  | { type: 'pointer:page-update'; key: string; itemId: string; note: string; project: ProjectRef | null; assigneeId: string }
  | { type: 'pointer:page-remove'; key: string; itemId: string }
  | { type: 'pointer:page-discard'; key: string }
  | { type: 'pointer:page-prepare'; key: string }
  | { type: 'pointer:page-publish'; key: string; edited?: TaskDraft }
  | { type: 'pointer:page-undo'; key: string; taskId: string }
  | { type: 'pointer:open-options' }
  | { type: 'pointer:toggle' }
  // Send to ClickUp in Gmail and HubSpot
  | { type: 'pointer:email-prepare'; email: EmailPayload }
  | { type: 'pointer:email-publish'; publish: EmailPublish }
  /** One file for one task, as a data URL; the page script sends them one at a time after the tasks exist. */
  | { type: 'pointer:email-attach'; taskId: string; name: string; dataUrl: string }
  | { type: 'pointer:email-undo'; taskIds: string[]; messageIds: string[] }
  /**
   * A file the email shows that the page can't read itself (another site's image, a server that
   * doesn't allow the app's origin). `cookies`: with the person's session, for HubSpot's servers only.
   */
  | { type: 'pointer:fetch-file'; url: string; cookies?: boolean }
  // SEO check (src/background/seo)
  /** A text file on another site (the live site's sitemap, seen from staging). */
  | { type: 'pointer:seo-fetch'; url: string }
  /** The page without the person's cookies (staging): can a stranger, or Google, open it? */
  | { type: 'pointer:seo-access'; url: string }
  /** Whether a link to another site works, for Check links. */
  | { type: 'pointer:seo-head'; url: string }
  /** Remembers the page's title and description for its site; answers with what the site's other checks found. */
  | { type: 'pointer:seo-site'; site: string; path: string; title: string; description: string }
  | { type: 'pointer:seo-prepare'; request: SeoRequest }
  | { type: 'pointer:seo-publish'; request: SeoRequest; edited?: TaskDraft }
  | { type: 'pointer:seo-undo'; taskId: string };
