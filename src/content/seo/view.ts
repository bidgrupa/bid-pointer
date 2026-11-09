/**
 * Markup for the SEO panel as pure functions of its state (panel.ts keeps the state): the page and
 * when it was checked, the Google preview, the findings by how much they matter, the passed checks
 * folded away, Check links, and where the task goes.
 */
import { findingHtml, SEO_ICONS, type RowState } from './rows';
import { esc, ICONS } from '../view';
import { ENVIRONMENT_LABEL, type Environment } from '../../shared/site';
import { SEVERITY_LABEL, type SeoFinding, type SeoSent, type SerpPreview, type Severity } from '../../shared/seo';

export type LinksView = { state: 'idle' | 'running' | 'done'; done: number; total: number };

export type FootView = {
  projectOptions: string;
  projectChosen: boolean;
  assigneeOptions: string;
  count: number;
  busy: string | null;
  /** No ClickUp token yet: the button opens the setup page instead. */
  setup: boolean;
};

export type SeoView = {
  environment: Environment;
  path: string;
  checkedAt: number;
  /** What's still being fetched, for the line that says so. */
  waiting: string[];
  serp: SerpPreview;
  findings: SeoFinding[];
  row: (f: SeoFinding) => RowState;
  passedOpen: boolean;
  links: LinksView;
  /** The task this check's findings just went into. */
  justSent: SeoSent | null;
  foot: FootView;
};

const COUNTED: Partial<Record<Severity, string>> = { fix: 'to fix', improve: 'to improve', notice: 'good to know', pass: 'passed' };
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
const list = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

function headHtml(v: SeoView): string {
  return `<header class="note-head seo-head">
      <div class="note-top">
        <p class="note-block"><span class="note-pin" aria-hidden="true"></span><span>SEO check</span></p>
        <span class="note-env note-env--${v.environment}">${ENVIRONMENT_LABEL[v.environment]}</span>
        <button class="seo-icon-btn" type="button" data-action="seo-rerun" aria-label="Check again" title="Check again">${SEO_ICONS.refresh}</button>
        <button class="note-close" type="button" data-action="seo-close" aria-label="Close" title="Close (Esc)">${ICONS.close}</button>
      </div>
      <p class="seo-where"><span class="seo-path" title="${esc(v.path)}">${esc(v.path)}</span><span class="seo-when">Checked ${clock(v.checkedAt)}</span></p>
    </header>`;
}

function serpHtml(s: SerpPreview): string {
  const title = s.title ? `<p class="seo-serp-title">${esc(s.title.text)}</p>` : '<p class="seo-serp-title is-missing">No title, so Google makes one up</p>';
  const description = s.description ? `<p class="seo-serp-desc">${esc(s.description.text)}</p>` : '<p class="seo-serp-desc is-missing">No description, so Google picks text from the page</p>';
  return `<section class="seo-serp" aria-label="How Google may show the page">
      <span class="seo-serp-label">Google preview</span>
      <span class="seo-serp-site"><span class="seo-serp-icon" aria-hidden="true">${esc((s.site.trim()[0] ?? '?').toUpperCase())}</span><span class="seo-serp-names"><span class="seo-serp-name">${esc(s.site)}</span><span class="seo-serp-url">${esc(s.crumbs)}</span></span></span>
      ${title}${description}
    </section>`;
}

function summaryHtml(v: SeoView): string {
  const counts = (['fix', 'improve', 'notice', 'pass'] as const)
    .map((s) => ({ s, n: v.findings.filter((f) => f.severity === s).length }))
    .filter((c) => c.n)
    .map((c) => `<span class="seo-count seo-count--${c.s}"><b>${c.n}</b> ${COUNTED[c.s]}</span>`)
    .join('');
  const waiting = v.waiting.length ? `<p class="seo-waiting" role="status"><span class="seo-spinner" aria-hidden="true"></span>Checking ${list(v.waiting)}…</p>` : '';
  const clear =
    !v.waiting.length && !v.findings.some((f) => f.severity === 'fix' || f.severity === 'improve')
      ? `<p class="seo-clear"><span class="seo-state seo-state--pass" aria-hidden="true">${ICONS.check}</span>Nothing to fix or improve on this page.</p>`
      : '';
  return `<div class="seo-summary">${counts}</div>${waiting}${clear}`;
}

function groupHtml(v: SeoView, severity: 'fix' | 'improve' | 'notice'): string {
  const rows = v.findings.filter((f) => f.severity === severity);
  if (!rows.length) return '';
  return `<section class="seo-group seo-group--${severity}"><h3 class="seo-group-title">${SEVERITY_LABEL[severity]}</h3><ul class="seo-list">${rows.map((f) => findingHtml(f, v.row(f))).join('')}</ul></section>`;
}

function passedHtml(v: SeoView): string {
  const rows = v.findings.filter((f) => f.severity === 'pass' || f.severity === 'skip');
  if (!rows.length) return '';
  const passed = rows.filter((f) => f.severity === 'pass').length;
  const skipped = rows.length - passed;
  const label = `${passed} ${passed === 1 ? 'check' : 'checks'} passed${skipped ? ` · ${skipped} not checked` : ''}`;
  return `<section class="seo-group seo-group--pass">
      <button class="seo-fold" type="button" data-action="seo-passed" aria-expanded="${v.passedOpen}"><span class="seo-state seo-state--pass" aria-hidden="true">${ICONS.check}</span><span class="seo-fold-label">${label}</span><span class="seo-chevron">${SEO_ICONS.chevron}</span></button>
      <ul class="seo-list seo-list--passed"${v.passedOpen ? '' : ' hidden'}>${rows.map((f) => findingHtml(f, v.row(f))).join('')}</ul>
    </section>`;
}

export function linksHtml(l: LinksView): string {
  const count = (n: number) => `${n} ${n === 1 ? 'link' : 'links'}`;
  if (!l.total) return '<div class="seo-extra"><p class="seo-extra-text"><b>Broken links</b> No links to this site to check.</p></div>';
  const text =
    l.state === 'running' ? `Checking ${l.done} of ${l.total}…` : l.state === 'done' ? `${count(l.done)} to this site checked.` : `${count(l.total)} to this site. Checking requests each one.`;
  const button = l.state === 'running' ? '' : `<button class="btn btn--small" type="button" data-action="seo-links">${l.state === 'done' ? 'Check again' : 'Check links'}</button>`;
  const bar = l.state === 'running' ? '<span class="seo-bar" aria-hidden="true"><span class="seo-bar-fill"></span></span>' : '';
  return `<div class="seo-extra"><p class="seo-extra-text"><b>Broken links</b> <span>${text}</span></p>${button}${bar}</div>`;
}

/** The footer's inside: where the task goes and who gets it, and the send button. */
export function footHtml(f: FootView): string {
  const label = f.busy ? `${f.busy}…` : f.setup ? 'Set up Pointer to send' : f.count ? `Send ${f.count} to ClickUp` : 'Nothing ticked';
  const locked = f.busy ? ' disabled' : '';
  const ready = f.setup || (f.count && !f.busy);
  return `<div class="note-pickers">
      <select class="note-select note-project seo-project${f.projectChosen ? '' : ' is-empty'}" aria-label="ClickUp project"${locked}>${f.projectOptions}</select>
      <select class="note-select note-assignee seo-assignee" aria-label="Assignee"${locked}>${f.assigneeOptions}</select>
    </div>
    <div class="seo-send-row">
      <span class="hint"><kbd>Esc</kbd><span>Close</span></span>
      <button class="btn btn--primary seo-send" type="button" data-action="seo-send"${ready ? '' : ' disabled'}>${esc(label)}</button>
    </div>`;
}

export function seoPanelHtml(v: SeoView): string {
  const sent = v.justSent
    ? `<p class="seo-sent" role="status">${ICONS.check}<span>Sent to <a href="${esc(v.justSent.url)}" target="_blank" rel="noopener">${esc(v.justSent.name)}</a></span></p>`
    : '';
  const groups = (['fix', 'improve', 'notice'] as const).map((s) => groupHtml(v, s)).join('');
  return `${headHtml(v)}
    <div class="note-body seo-body">${sent}${serpHtml(v.serp)}${summaryHtml(v)}${groups}${passedHtml(v)}${linksHtml(v.links)}</div>
    <footer class="seo-foot">${footHtml(v.foot)}</footer>`;
}
