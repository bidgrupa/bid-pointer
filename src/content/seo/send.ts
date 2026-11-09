/**
 * Sending a check's ticked findings to ClickUp from the SEO panel, as one task: the request, the
 * review (with "Review the rewrite" on, the task's name and description show in the panel first;
 * Ctrl+Enter creates it, Esc or Back return to the findings), the toast, and Undo.
 */
import type { PageCheck } from './check';
import type { Send } from './net';
import { wireReview } from '../fields';
import { reviewFields, type ToastModel } from '../view';
import { browserLabel } from '../../shared/page';
import { forTask, siteKey, type SeoPrepareResponse, type SeoPublishResult, type SeoRequest } from '../../shared/seo';
import type { InitResponse, ProjectRef, TaskDraft } from '../../shared/types';

const UNDO_MS = 10_000;

type Failure = { ok: false; stage: 'keys' | 'task'; error: string };

export type SendHost = {
  send: Send;
  toast(t: ToastModel, ms: number): HTMLElement;
  init(): InitResponse;
  /** A task went to this project from the page: the site's notes start with it from now on. */
  used(project: ProjectRef): void;
};

/** What the panel hears while sending: what it's busy with, and when the check changed (or the review closed). */
export type SendHooks = { busy(label: string | null): void; changed(): void };

const failure = (e: unknown): Failure => ({ ok: false, stage: 'task', error: e instanceof Error ? e.message : String(e) });

export class SeoSender {
  /** Set while the review shows: leaves it, as Back does. */
  private back: (() => void) | null = null;

  constructor(
    private readonly host: SendHost,
    private readonly panel: HTMLElement,
  ) {}

  get reviewing(): boolean {
    return this.back !== null;
  }

  /** Esc while the review shows: back to the findings. False when it isn't showing. */
  escape(): boolean {
    if (!this.back) return false;
    this.back();
    return true;
  }

  async send(check: PageCheck, project: ProjectRef, assigneeId: string, hooks: SendHooks): Promise<void> {
    const findings = check.ticked();
    const request: SeoRequest = {
      page: check.page,
      project,
      assigneeId,
      findings: findings.map(forTask),
      site: siteKey(check.page),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      browser: browserLabel(navigator.userAgent),
    };
    try {
      let edited: TaskDraft | undefined;
      if (this.host.init().reviewBeforeSend) {
        hooks.busy('Getting the task ready');
        const p = await this.host.send<SeoPrepareResponse>({ type: 'pointer:seo-prepare', request }).catch(failure);
        hooks.busy(null);
        if (!p.ok) return this.failed(p);
        const reviewed = await this.review(p.draft);
        if (!reviewed) return;
        edited = reviewed;
      }
      hooks.busy('Creating the task');
      const r = await this.host.send<SeoPublishResult>({ type: 'pointer:seo-publish', request, ...(edited ? { edited } : {}) }).catch(failure);
      hooks.busy(null);
      if (!r.ok) return this.failed(r);
      check.markSent(findings, r.sent, { taskId: r.task.id, name: r.task.name, url: r.task.url });
      this.host.used(project);
      const n = findings.length;
      const toast = this.host.toast({ title: 'SEO task created', icon: 'check', meta: [`${n} ${n === 1 ? 'finding' : 'findings'}, in ${project.label}`], link: r.task.url, undo: true }, UNDO_MS);
      toast.querySelector('[data-action="undo"]')?.addEventListener('click', () => void this.undo(check, r.task.id, hooks));
    } finally {
      hooks.changed();
    }
  }

  private async undo(check: PageCheck, taskId: string, hooks: SendHooks) {
    this.host.toast({ title: 'Deleting the task…' }, 30_000);
    try {
      const r = await this.host.send<{ ok?: boolean; error?: string } | undefined>({ type: 'pointer:seo-undo', taskId });
      if (!r?.ok) throw new Error(r?.error ?? 'No answer from the extension');
      check.unsend(taskId);
      hooks.changed();
      this.host.toast({ title: 'Task deleted', icon: 'check', meta: ['Its findings are ticked again.'] }, 3000);
    } catch (e) {
      this.host.toast({ title: "Couldn't delete the task", icon: 'alert', meta: [failure(e).error] }, 6000);
    }
  }

  private failed(r: Failure) {
    const title = r.stage === 'keys' ? 'Finish setting up Pointer' : "The task wasn't created";
    this.host.toast({ title, icon: 'alert', meta: [r.error, 'The findings are still ticked.'] }, 8000);
  }

  /** The task's name and description in the panel; resolves with them as edited, or null for Back. */
  private review(draft: TaskDraft): Promise<TaskDraft | null> {
    const body = this.panel.querySelector<HTMLElement>('.seo-body');
    const foot = this.panel.querySelector<HTMLElement>('.seo-foot');
    if (!body || !foot) return Promise.resolve(draft);
    body.innerHTML = reviewFields(draft, 'nothing is attached');
    foot.innerHTML = `<div class="seo-send-row">
        <span class="hint"><kbd>Ctrl</kbd><kbd>Enter</kbd><span>Create task</span></span>
        <span class="seo-send-actions">
          <button class="btn" type="button" data-review="back">Back</button>
          <button class="btn btn--primary" type="button" data-review="create">Create task</button>
        </span>
      </div>`;
    return new Promise((resolve) => {
      const finish = (d: TaskDraft | null) => {
        this.back = null;
        resolve(d);
      };
      const create = wireReview(body, draft, finish, () => {});
      foot.querySelector('[data-review="create"]')?.addEventListener('click', () => create?.());
      foot.querySelector('[data-review="back"]')?.addEventListener('click', () => finish(null));
      this.back = () => finish(null);
    });
  }
}
