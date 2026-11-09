import { ENVIRONMENT_LABEL } from './site';
import type { BlockInfo, ElementInfo, NoteSubmission, PageInfo, PageTask, PageTaskItem, Prepared } from './types';

/** MediaRecorder writes MP4 where the browser can (Chrome, Edge) and WebM elsewhere (Firefox). */
export const videoExt = (mime: string): string => (/mp4/i.test(mime) ? 'mp4' : 'webm');

/** "0:07", "1:30": a recording's length. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Soft targets given to the model. Nothing is truncated in code — sentences stay whole. */
export const TITLE_MAX = 70;
export const BULLET_MAX = 120;
/** Hard cap on the number of bullets (a count, not a cut). */
export const BULLETS_MAX = 3;

export const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

const pad2 = (n: number) => String(n).padStart(2, '0');
export const formatDate = (d: Date): string =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export const slugify = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'note';

export const hasBlock = (name: string): boolean => !!name && name !== 'N/A';

/** Title used when the rewrite is unavailable: first line of the note, prefixed with the block name. */
export function fallbackTitle(note: string, blockName: string): string {
  const first = note.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Pointer note';
  return hasBlock(blockName) ? `${blockName}: ${first}` : first;
}

/** Validates and tidies whatever the model returned. Returns null when it is unusable. */
export function sanitizePrepared(raw: unknown, note: string): Prepared | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().replace(/\s+/g, ' ') : '';
  if (!title) return null;
  const list = Array.isArray(r.bullets) ? r.bullets : typeof r.bullets === 'string' ? [r.bullets] : [];
  let bullets = list
    .filter((b): b is string => typeof b === 'string')
    .map((b) => b.trim().replace(/^[-•*]\s*/, '').replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, BULLETS_MAX);
  if (bullets.length === 0) bullets = [note.trim().replace(/\s+/g, ' ')];
  return { title, bullets };
}

/** Pulls a JSON object out of a model reply that may be wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The page link and environment, as every kind of task shows them. */
export function whereLines(page: PageInfo): string[] {
  const env = page.environment ?? 'staging';
  return [
    `🔗 [${page.repoLabel} › ${page.path || '/'}](${page.url})`,
    `**Environment** ${ENVIRONMENT_LABEL[env]}${env === 'production' ? ' (live site)' : ''}`,
  ];
}

/** Block and element, one part each, or nothing when neither is known. */
function locationParts(block: BlockInfo, element: ElementInfo): string[] {
  const parts: string[] = [];
  if (hasBlock(block.name)) parts.push(`**Block** ${block.name}${block.id ? ` · #${block.id}` : ''}`);
  if (element.selector || element.text) {
    const el = [element.selector ? `\`${element.selector}\`` : '', element.text ? `"${element.text}"` : ''].filter(Boolean);
    parts.push(`**Element** ${el.join(' — ')}`);
  }
  return parts;
}

export type FooterInfo = { viewport: { w: number; h: number }; browser: string; reporter?: string; omitTechnical?: boolean };

export function footerLines(f: FooterInfo, now: Date): string[] {
  const who = f.reporter ? ` · reported by ${f.reporter}` : '';
  const technical = f.omitTechnical ? '' : ` · ${f.viewport.w}×${f.viewport.h} · ${f.browser}`;
  return ['', '---', `Reported with Pointer${technical} · ${formatDate(now)}${who}`];
}

const quote = (note: string) => note.split('\n').map((l) => `> ${l}`);

/**
 * ClickUp markdown description. Short and scannable:
 * bullets (or the raw note), where it was reported with a clickable page link,
 * block + element, the original note, and a one-line footer.
 */
export function buildDescription(s: NoteSubmission, now: Date = new Date()): string {
  const lines: string[] = [];
  const note = s.note.trim();

  if (s.prepared) lines.push(...s.prepared.bullets.map((b) => `- ${b}`));
  else lines.push(note);

  lines.push('', '**Where**', ...whereLines(s.page), ...locationParts(s.block, s.element));
  if (s.video) lines.push(`**Video** ${s.video.name} (${clock(s.video.ms)})`);

  if (s.prepared) lines.push('', '**Original note**', ...quote(note));

  lines.push(...footerLines(s, now));
  return lines.join('\n');
}

// ---------- Comments (Comment Mode) ----------

/**
 * A note as a comment on an existing task. ClickUp's comment API takes plain text, so this
 * uses plain lines instead of Markdown: the point first, then where it is, then the note as
 * written, and the same footer as a task.
 */
export function buildCommentText(s: NoteSubmission, now: Date = new Date()): string {
  const note = s.note.trim();
  const lines: string[] = [];
  if (s.prepared) lines.push(s.prepared.title, ...s.prepared.bullets.map((b) => `• ${b}`));
  else lines.push(note);

  const env = s.page.environment ?? 'staging';
  lines.push('', `Page: ${s.page.url}`, `Environment: ${ENVIRONMENT_LABEL[env]}${env === 'production' ? ' (live site)' : ''}`);
  if (hasBlock(s.block.name)) lines.push(`Block: ${s.block.name}${s.block.id ? ` · #${s.block.id}` : ''}`);
  if (s.element.selector || s.element.text) {
    lines.push(`Element: ${[s.element.selector, s.element.text ? `"${s.element.text}"` : ''].filter(Boolean).join(' — ')}`);
  }
  // named only when there is one (the content script names it after a capture that worked)
  if (s.screenshotName) lines.push(`Screenshot: ${s.screenshotName} (in the task's attachments)`);
  if (s.video) lines.push(`Video: ${s.video.name} (${clock(s.video.ms)}, in the task's attachments)`);
  if (s.prepared) lines.push('', note.includes('\n') ? `Original note:\n${note}` : `Original note: “${note}”`);

  const who = s.reporter ? ` · reported by ${s.reporter}` : '';
  const technical = s.omitTechnical ? '' : ` · ${s.viewport.w}×${s.viewport.h} · ${s.browser}`;
  lines.push('', `Reported with Pointer${technical} · ${formatDate(now)}${who}`);
  return lines.join('\n');
}

// ---------- Page tasks ----------

/**
 * The page's name for a page task's title: the first part of the document title
 * ("Superior room | Cresanka" → "Superior room"), else the last part of the path, else "Home page".
 */
export function pageName(title: string, path: string): string {
  const fromTitle = title.split(/\s[|–—·•-]\s/)[0]?.replace(/\s+/g, ' ').trim();
  if (fromTitle) return fromTitle;
  let segment = path.split(/[?#]/)[0]?.split('/').filter(Boolean).at(-1) ?? '';
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // keep it as it is
  }
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Home page';
}

export const pageTaskTitle = (page: Pick<PageInfo, 'title' | 'path'>): string => `${pageName(page.title, page.path)} Changes`;

/** The attachment name for a page-task note's screenshot; the description refers to it. */
export const shotName = (index: number, item: Pick<PageTaskItem, 'block'>): string =>
  `pointer-${index + 1}-${hasBlock(item.block.name) ? slugify(item.block.name) : 'note'}.png`;

/** The attachment name for a page-task note's recording, numbered like its screenshot. */
export const videoName = (index: number, item: Pick<PageTaskItem, 'block' | 'video'>): string =>
  `pointer-${index + 1}-${hasBlock(item.block.name) ? slugify(item.block.name) : 'note'}.${videoExt(item.video?.mime ?? '')}`;

/**
 * One task for a page's notes: the page link and environment once, then each note numbered,
 * in the order they were added, with its own block, element, screenshot and original wording.
 */
export function buildPageDescription(
  t: Pick<PageTask, 'page' | 'items'> & FooterInfo,
  now: Date = new Date(),
): string {
  const n = t.items.length;
  const [link = '', env = ''] = whereLines(t.page);
  const lines: string[] = [link, `${env} · ${n} ${n === 1 ? 'note' : 'notes'}`];

  t.items.forEach((item, i) => {
    const note = item.note.trim();
    if (item.prepared) {
      lines.push('', `**${i + 1}. ${item.prepared.title}**`, ...item.prepared.bullets.map((b) => `- ${b}`));
    } else {
      lines.push('', `**${i + 1}. ${hasBlock(item.block.name) ? item.block.name : 'Note'}**`, note);
    }
    const parts = locationParts(item.block, item.element);
    if (item.screenshot) parts.push(`**Screenshot** ${shotName(i, item)}`);
    if (item.video) parts.push(`**Video** ${videoName(i, item)} (${clock(item.video.ms)})`);
    if (parts.length) lines.push(parts.join(' · '));
    if (item.prepared) lines.push(...quote(note));
  });

  lines.push(...footerLines(t, now));
  return lines.join('\n');
}
