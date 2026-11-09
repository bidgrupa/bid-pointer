/**
 * One page's SEO check, as the panel holds it: what was read and fetched, what it found, and what
 * the person chose (ticks, unfolded rows, links checked, what went to ClickUp). The panel shows it
 * (panel.ts); nothing here touches the page or the panel.
 */
import { googleMeasure } from './measure';
import { NO_SITE } from './net';
import { richResultsHtml, shareHtml, type RowState } from './rows';
import type { LinksView } from './view';
import { bareHost, evaluate, isProblem, sentKey, shareImage, startsTicked } from '../../shared/seo';
import type { SeoFinding, SeoNetwork, SeoSent, SeoSnapshot } from '../../shared/seo';
import type { PageInfo } from '../../shared/types';

const firstText = (list: string[]) => list.find((t) => t.trim())?.trim() ?? '';

export class PageCheck {
  readonly at = Date.now();
  net: SeoNetwork = {};
  findings: SeoFinding[] = [];
  /** How many checks still wait for something to load. */
  pending = 0;
  links: LinksView;
  /** The task this check's findings just went into. */
  justSent: SeoSent | null = null;
  /** Rows unfolded, by finding id. */
  readonly unfolded = new Set<string>();
  /** Ticks changed by hand, by finding id; the others start as startsTicked says. */
  private readonly ticks = new Map<string, boolean>();

  constructor(
    /** The page key (pageKeyOf) it was made for. */
    readonly key: string,
    readonly page: PageInfo,
    readonly snapshot: SeoSnapshot,
    readonly refs: Map<string, Element>,
    linksToCheck: number,
  ) {
    this.links = { state: 'idle', done: 0, total: linksToCheck };
    this.evaluate();
  }

  /** Another part of what Google fetches has arrived. */
  add(part: Partial<SeoNetwork>) {
    this.net = { ...this.net, ...part };
    this.evaluate();
  }

  private evaluate() {
    const { findings, waiting } = evaluate({ page: this.snapshot, net: this.net, measure: googleMeasure });
    this.findings = findings;
    this.pending = waiting;
  }

  /** What's still being fetched, for the line that says so. */
  waiting(): string[] {
    const n = this.net;
    return [
      !n.server || (this.page.environment === 'staging' && !n.access) ? "the page's own answer" : '',
      n.robots ? '' : 'robots.txt',
      n.sitemap ? '' : 'the sitemap',
      !n.ogImage && /^https?:\/\//i.test(shareImage(this.snapshot.social)) ? 'the share image' : '',
    ].filter(Boolean);
  }

  sentFor(f: SeoFinding): SeoSent | undefined {
    return this.net.site?.sent[sentKey(f, this.page.path)];
  }

  isTicked(f: SeoFinding): boolean {
    return this.ticks.get(f.id) ?? startsTicked(f, Boolean(this.sentFor(f)));
  }

  tick(id: string, on: boolean) {
    this.ticks.set(id, on);
  }

  ticked(): SeoFinding[] {
    return this.findings.filter((f) => isProblem(f) && this.isTicked(f));
  }

  row(f: SeoFinding): RowState {
    const sent = this.sentFor(f);
    return { ticked: this.isTicked(f), open: this.unfolded.has(f.id), ...(sent ? { sent } : {}), extra: this.extra(f) };
  }

  /** What a few findings fold out beyond their items: the share preview, Google's structured data test. */
  private extra(f: SeoFinding): string {
    const s = this.snapshot;
    if (f.check === 'og-image')
      return shareHtml({
        image: shareImage(s.social),
        site: s.social['og:site_name'] || bareHost(new URL(s.url).host),
        title: s.social['og:title'] || firstText(s.titles),
        description: s.social['og:description'] || firstText(s.descriptions),
      });
    return f.check === 'structured' && s.environment === 'production' ? richResultsHtml(s.url) : '';
  }

  /** The findings went into a task: unticked, linked to it, and remembered as the next check will. */
  markSent(findings: SeoFinding[], sent: Record<string, SeoSent>, task: SeoSent) {
    this.add({ site: { ...(this.net.site ?? NO_SITE), sent: { ...this.net.site?.sent, ...sent } } });
    for (const f of findings) this.ticks.delete(f.id);
    this.justSent = task;
  }

  /** Undo: the task's findings are back to unsent, and ticked again. */
  unsend(taskId: string) {
    const site = this.net.site;
    if (site) this.add({ site: { ...site, sent: Object.fromEntries(Object.entries(site.sent).filter(([, t]) => t.taskId !== taskId)) } });
    if (this.justSent?.taskId === taskId) this.justSent = null;
  }
}
