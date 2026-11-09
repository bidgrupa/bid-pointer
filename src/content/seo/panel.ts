/**
 * The SEO panel. The SEO button in the dock opens it beside the dock and checks the page; the check
 * (check.ts) stays until the page changes, so closing and opening the panel shows it again. Findings
 * can be ticked for a ClickUp task (send.ts), unfolded, and shown on the page, and the button keeps
 * a count.
 */
import { PageCheck } from './check';
import { checkLinks, linksToCheck } from './links';
import { SeoMark } from './mark';
import { googleMeasure } from './measure';
import { readNetwork } from './net';
import { readPage } from './read';
import { SeoSender, type SendHost } from './send';
import { footHtml, linksHtml, seoPanelHtml, type FootView } from './view';
import { fitSelect, shake } from '../fields';
import { ICONS, assigneeOptionsHtml, projectOptionsHtml } from '../view';
import { pageInfo, pageKeyOf } from '../../shared/page';
import { serpPreview, siteKey } from '../../shared/seo';
import type { MembersResponse, PageInfo, ProjectRef, ProjectsResponse } from '../../shared/types';

/** What the panel needs from Pointer: messages and toasts, and the project and person picked on the page. */
export type SeoHost = SendHost & {
  /** The background is from another build, so nothing may be sent; showStale says what to do. */
  stale(): boolean;
  showStale(): void;
  /** The project and person picked on this page, which the notes share. */
  picked(): { listId: string; assigneeId: string };
  pick(p: { listId?: string; assigneeId?: string }): void;
  projects(page: PageInfo): Promise<ProjectsResponse>;
  members(): Promise<MembersResponse>;
  project(listId: string): ProjectRef | null;
};

export class SeoPanel {
  private open = false;
  private check: PageCheck | null = null;
  private passedOpen = false;
  /** What sending is busy with, for the send button. */
  private busy: string | null = null;
  private projects: ProjectsResponse | null = null;
  private members: MembersResponse | null = null;
  private stopNet: (() => void) | null = null;
  private readonly mark: SeoMark;
  private readonly sender: SeoSender;

  constructor(
    private readonly host: SeoHost,
    private readonly button: HTMLButtonElement,
    private readonly el: HTMLElement,
    markBox: HTMLElement,
  ) {
    this.mark = new SeoMark(markBox);
    this.sender = new SeoSender(host, el);
    el.addEventListener('click', this.onClick);
    el.addEventListener('change', this.onChange);
  }

  /** The "SEO checker" setting: off takes the button and the panel away. */
  setAvailable(on: boolean) {
    this.button.hidden = !on;
    if (!on) this.close();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  close() {
    if (!this.open) return;
    this.sender.escape();
    this.open = false;
    this.mark.hide();
    this.el.classList.remove('is-open');
    this.el.innerHTML = '';
    this.button.setAttribute('aria-expanded', 'false');
  }

  /** Esc: from the review back to the findings, else closes. False when the panel isn't open. */
  escape(): boolean {
    if (!this.open) return false;
    if (!this.sender.escape()) this.close();
    return true;
  }

  /** Another page (client-side navigation): the check was the old page's. */
  pageChanged() {
    this.stopNet?.();
    this.check = null;
    this.render();
    if (this.open) this.start();
  }

  private show() {
    this.open = true;
    this.button.setAttribute('aria-expanded', 'true');
    this.el.classList.remove('is-open');
    void this.el.offsetWidth; // replays the entrance
    this.el.classList.add('is-open');
    if (this.check?.key === pageKeyOf(location)) this.render();
    else this.start();
    void this.loadPickers();
  }

  /** Reads the page afresh and fetches what goes with it. */
  private start() {
    this.stopNet?.();
    const page = pageInfo(location, document.title, this.host.init().sites);
    const { snapshot, refs } = readPage(page.environment);
    const check = new PageCheck(pageKeyOf(location), page, snapshot, refs, linksToCheck(snapshot).length);
    this.check = check;
    this.mark.hide();
    this.stopNet = readNetwork(snapshot, siteKey(page), this.host.send, (part) => {
      check.add(part);
      if (this.check === check) this.render();
    });
    this.render();
  }

  private async loadPickers() {
    const check = this.check;
    if (!check) return;
    [this.projects, this.members] = await Promise.all([this.host.projects(check.page), this.host.members()]);
    if (this.open) this.renderFoot();
  }

  // ---------- Rendering ----------

  private render() {
    const c = this.check;
    this.badge(c);
    if (!c || !this.open || this.sender.reviewing) return;
    const scroll = this.el.querySelector('.seo-body')?.scrollTop ?? 0;
    this.el.innerHTML = seoPanelHtml({
      environment: c.page.environment,
      path: c.page.path,
      checkedAt: c.at,
      waiting: c.waiting(),
      serp: serpPreview(c.snapshot, googleMeasure),
      findings: c.findings,
      row: (f) => c.row(f),
      passedOpen: this.passedOpen,
      links: c.links,
      justSent: c.justSent,
      foot: this.foot(),
    });
    const body = this.el.querySelector('.seo-body');
    if (body) body.scrollTop = scroll;
    fitSelect(this.el.querySelector('.seo-assignee'));
    this.paintBar();
  }

  private renderFoot() {
    const foot = this.el.querySelector('.seo-foot');
    if (!foot || this.sender.reviewing) return;
    foot.innerHTML = footHtml(this.foot());
    fitSelect(this.el.querySelector('.seo-assignee'));
  }

  private renderLinks() {
    const box = this.el.querySelector('.seo-extra');
    if (box && this.check && !this.sender.reviewing) box.outerHTML = linksHtml(this.check.links);
    this.paintBar();
  }

  /** The progress bar's width, set through the CSSOM: a site's CSP may refuse inline styles. */
  private paintBar() {
    const fill = this.el.querySelector<HTMLElement>('.seo-bar-fill');
    const links = this.check?.links;
    if (fill && links?.total) fill.style.width = `${Math.round((links.done / links.total) * 100)}%`;
  }

  private listId(): string {
    return this.host.picked().listId || this.projects?.best?.listId || '';
  }

  private foot(): FootView {
    const init = this.host.init();
    const listId = this.listId();
    return {
      projectOptions: projectOptionsHtml({ selectedId: listId, remembered: init.remembered, projects: this.projects }),
      projectChosen: Boolean(listId),
      assigneeOptions: assigneeOptionsHtml({ selectedId: this.host.picked().assigneeId, defaultAssignee: init.defaultAssignee, members: this.members }),
      count: this.check?.ticked().length ?? 0,
      busy: this.busy,
      setup: !init.keysOk,
    };
  }

  /** The button's count: findings to fix or improve (red when any is to fix), or a tick when there are none. */
  private badge(c: PageCheck | null) {
    const count = this.button.querySelector<HTMLElement>('.seo-btn-count');
    if (!count) return;
    const fix = c?.findings.filter((f) => f.severity === 'fix').length ?? 0;
    const n = fix + (c?.findings.filter((f) => f.severity === 'improve').length ?? 0);
    count.hidden = !c || (!n && c.pending > 0);
    count.className = `seo-btn-count ${fix ? 'is-fix' : n ? 'is-improve' : 'is-clean'}`;
    if (n) count.textContent = String(n);
    else count.innerHTML = ICONS.check;
    this.button.title = !c ? "Check this page's SEO" : n ? `${n} to fix or improve on this page` : 'Nothing to fix or improve on this page';
  }

  // ---------- What people do in it ----------

  private onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'seo-close') this.close();
    else if (action === 'seo-rerun') this.start();
    else if (action === 'seo-expand') this.fold(el, this.check?.unfolded ?? null, el.closest('.seo-row')?.querySelector('.seo-more'));
    else if (action === 'seo-passed') this.passedOpen = this.fold(el, null, el.parentElement?.querySelector('.seo-list--passed'));
    else if (action === 'seo-show') this.showOnPage(el.dataset.ref ?? '', el.dataset.label ?? '');
    else if (action === 'seo-links') void this.checkLinks();
    else if (action === 'seo-send') void this.send();
  };

  /** Folds or unfolds `part` in place; returns whether it's open now. */
  private fold(button: HTMLElement, remember: Set<string> | null, part: Element | null | undefined): boolean {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    if (part instanceof HTMLElement) part.hidden = !open;
    const id = button.dataset.id ?? '';
    if (remember && open) remember.add(id);
    else remember?.delete(id);
    return open;
  }

  private onChange = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.dataset.action === 'seo-tick') {
      this.check?.tick(t.dataset.id ?? '', t.checked);
      this.renderFoot();
    } else if (t instanceof HTMLSelectElement && t.classList.contains('seo-project')) {
      this.host.pick({ listId: t.value });
      t.classList.toggle('is-empty', !t.value);
    } else if (t instanceof HTMLSelectElement && t.classList.contains('seo-assignee')) {
      this.host.pick({ assigneeId: t.value });
      fitSelect(t);
    }
  };

  private showOnPage(ref: string, label: string) {
    const shown = this.mark.show(this.check?.refs.get(ref), label);
    if (shown === 'hidden') this.host.toast({ title: "It's hidden right now", meta: ["It's on the page, but in a closed slide, menu or tab."] }, 4000);
    else if (shown === 'gone') this.host.toast({ title: "It's no longer on the page", meta: ['Check again to read the page as it is now.'] }, 4000);
  }

  private async checkLinks() {
    const c = this.check;
    if (!c || c.links.state === 'running') return;
    c.links = { state: 'running', done: 0, total: linksToCheck(c.snapshot).length };
    this.renderLinks();
    const progress = (done: number, total: number) => {
      c.links = { state: 'running', done, total };
      if (this.check === c) this.renderLinks();
    };
    const result = await checkLinks(c.snapshot, this.host.send, progress, () => this.check !== c);
    c.links = { state: 'done', done: result.checked, total: c.links.total };
    c.add({ links: result });
    if (this.check === c) this.render();
  }

  private async send() {
    const c = this.check;
    if (!c || this.busy) return;
    if (this.host.stale()) return this.host.showStale();
    if (!this.host.init().keysOk) return void this.host.send({ type: 'pointer:open-options' }).catch(() => {});
    const project = this.host.project(this.listId());
    if (!project) {
      const select = this.el.querySelector<HTMLSelectElement>('.seo-project');
      shake(select);
      select?.focus();
      return;
    }
    if (!c.ticked().length) return;
    await this.sender.send(c, project, this.host.picked().assigneeId, {
      busy: (label) => {
        this.busy = label;
        this.renderFoot();
      },
      changed: () => this.render(),
    });
  }
}
