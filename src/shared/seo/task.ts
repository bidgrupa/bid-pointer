/**
 * Findings as one ClickUp task per page, shaped like a page task (numbered points): each says how
 * much it matters, whether it's this page's or the whole site's, and where it's fixed. Also the
 * keys sent findings are remembered under, so a later check doesn't send them again.
 */
import { footerLines, pageName, whereLines, type FooterInfo } from '../format';
import { normalizePath } from '../match';
import type { PageInfo } from '../types';
import type { SeoFinding, SeoItem } from './types';

export const seoTaskTitle = (page: Pick<PageInfo, 'title' | 'path'>): string => `${pageName(page.title, page.path)} SEO`;

/** What a site's checks are remembered under, staging and the live site apart. */
export const siteKey = (page: Pick<PageInfo, 'environment' | 'projectKey'>): string => `${page.environment}:${page.projectKey}`;

/** What a sent finding is remembered under: a whole-site one by its kind, a page's by its kind and page. */
export const sentKey = (f: Pick<SeoFinding, 'id' | 'scope'>, path: string): string =>
  f.scope === 'site' ? `site|${f.id}` : `page|${normalizePath(path)}|${f.id}`;

/** Ticked to begin with: what's to fix or improve, unless an open task has it already. */
export const startsTicked = (f: Pick<SeoFinding, 'severity'>, sent: boolean): boolean => !sent && (f.severity === 'fix' || f.severity === 'improve');

/** A finding as it goes to the background: without element ids and pictures. */
export const forTask = (f: SeoFinding): SeoFinding => (f.items ? { ...f, items: f.items.map(({ ref: _ref, thumb: _thumb, ...item }) => item) } : f);

const WEIGHT: Partial<Record<SeoFinding['severity'], string>> = { fix: 'To fix', improve: 'To improve', notice: 'Good to know' };
const FIXED_IN: Record<'cms' | 'code', string> = { cms: 'fix in the CMS', code: 'fix in the code' };

function itemLine(item: SeoItem): string {
  const label = item.code ? `\`${item.label.replace(/`/g, "'")}\`` : item.label;
  return `- ${item.level ? `H${item.level} ` : ''}${label}${item.note ? ` · ${item.note}` : ''}`;
}

/**
 * The task's description. It opens with the lines every Pointer task has (the page link and the
 * environment). No line starts with "Block", and the environment line doesn't count notes, so
 * Comment Mode never takes an SEO task for a note's task (see shared/match.ts).
 */
export function buildSeoDescription(t: { page: PageInfo; findings: SeoFinding[] } & FooterInfo, now: Date = new Date()): string {
  const n = t.findings.length;
  const [link = '', env = ''] = whereLines(t.page);
  const lines = [link, `${env} · SEO check · ${n} ${n === 1 ? 'finding' : 'findings'}`];
  t.findings.forEach((f, i) => {
    lines.push('', `**${i + 1}. ${f.title}**`);
    lines.push([WEIGHT[f.severity], f.scope === 'site' ? 'whole site' : 'this page', f.fixIn ? FIXED_IN[f.fixIn] : ''].filter(Boolean).join(' · '));
    if (f.detail) lines.push(f.detail);
    lines.push(...(f.items ?? []).map(itemLine));
    if (f.more) lines.push(`- …and ${f.more} more`);
    if (f.why) lines.push(`Why: ${f.why}`);
    if (f.fix) lines.push(`Fix: ${f.fix}`);
  });
  lines.push(...footerLines(t, now));
  return lines.join('\n');
}
