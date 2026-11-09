/**
 * Send to ClickUp in Gmail and HubSpot: a client's email becomes ClickUp tasks. Pure functions,
 * unit-tested.
 *
 * The Gmail and HubSpot scripts (gmail/read.ts, hubspot/read.ts) read the messages into an
 * EmailPayload: each one's
 * visible text, with [image N] where an inline image sits and links written out, and every image
 * and attached file numbered once for the whole email. GLM splits that into atomic points
 * (emailPrompt, then sanitizeSplit). Grouping and routing are rules (planTasks here, routing.ts),
 * not the model's call, so every task line traces back to the client's own words and the
 * grouping is easy to tune. Descriptions follow the page task's shape, which Mate already works
 * through: numbered points, each with an English instruction and the client's words quoted.
 */
import { formatDate } from './format';
import { ROUTING, routePoint, type RoutingRules } from './routing';
import { creditDomains, domainCandidates } from './site';

export type PointKind = 'content' | 'media' | 'style' | 'bug' | 'feature' | 'design' | 'other';
export type Sensitive = 'booking' | 'prices' | 'legal';

const KINDS: readonly PointKind[] = ['content', 'media', 'style', 'bug', 'feature', 'design', 'other'];
const SENSITIVES: readonly Sensitive[] = ['booking', 'prices', 'legal'];

export type EmailMessage = {
  /** 1-based, in the order Gmail shows them (oldest first). */
  n: number;
  /** Gmail's id for it (hex), '' when the page didn't show one. */
  id: string;
  from: { name: string; email: string };
  /** The sent date as Gmail shows it, e.g. "Thu, Oct 16, 2026, 9:12 AM". */
  dateText: string;
  /** When it was sent, in ms; 0 when unknown. */
  sentAt: number;
  /** Written by the agency, or sent to ClickUp before: read for context, no points taken from it. */
  context: 'ours' | 'sent' | null;
  /** The visible text, with [image N] where inline images sit and links as "text (url)". */
  text: string;
  /** Gmail cut the message short ("[Message clipped]"), so the rest wasn't read. */
  clipped: boolean;
};

export type EmailFile = {
  /** 1-based, one numbering for the whole email: what [image N] and the descriptions refer to. */
  n: number;
  /** The name it's attached under in ClickUp. */
  name: string;
  mime: string;
  /** Shown in the message's text (an inline image), or attached to the message. */
  kind: 'inline' | 'attachment';
  message: number;
};

/** A HubSpot Help Desk ticket, as HubSpot shows it beside the emails. '' for anything unset. */
export type Ticket = {
  id: string;
  name: string;
  /** The ticket's record in HubSpot. */
  url: string;
  /** The HubSpot user it's assigned to. */
  owner: string;
  /** "Low", "Medium", "High" or "Urgent". */
  priority: string;
  category: string;
  contact: { name: string; email: string; title: string };
  company: string;
};

export type EmailPayload = {
  /** Where it was read; Gmail when unset. */
  app?: 'Gmail' | 'HubSpot';
  /** The subject; for a HubSpot ticket, the ticket's name. */
  subject: string;
  /** Opens the conversation (or the ticket) again, for whoever logged it. */
  threadUrl: string;
  messages: EmailMessage[];
  files: EmailFile[];
  ticket?: Ticket;
};

export type Due = { date: string; said: string };

export type EmailPoint = {
  id: string;
  message: number;
  /** The client's own words for it, in their language. */
  quote: string;
  /** The quote is in the email word for word (spacing and quote marks aside). */
  quoteFound: boolean;
  title: string;
  instruction: string;
  kind: PointKind;
  /** Pages as the client names them. */
  pages: string[];
  /** Links from the email that point at those pages (only ones that really are in the email). */
  urls: string[];
  /** Other links from the email the work needs: a spreadsheet or document with the details. */
  links: string[];
  component: string | null;
  /** Numbers of the files that belong to it. */
  files: number[];
  sensitive: Sensitive | null;
  /** What's unclear, when it doesn't say concretely what to change. */
  vague: string | null;
  size: 'small' | 'larger';
  /** The words that make it urgent. */
  urgent: string | null;
  due: Due | null;
};

export type EmailQuestion = { message: number; quote: string; quoteFound: boolean };

export type EmailSplit = {
  client: string | null;
  points: EmailPoint[];
  questions: EmailQuestion[];
  /** Images that are only decoration (logos, signature pictures): they stay off the tasks. */
  decorative: number[];
};

export type EmailTaskPlan = {
  title: string;
  /** Point ids, in the email's order. */
  points: string[];
  route: 'mate' | 'person';
  reasons: string[];
  priority: 'high' | null;
  due: Due | null;
  needsClarification: boolean;
};

/** A task as the review shows it and Create sends it. */
export type EmailTaskDraft = {
  name: string;
  description: string;
  /** ClickUp user id; '' assigns no one. */
  assigneeId: string;
  route: 'mate' | 'person';
  reasons: string[];
  priority: 'high' | null;
  /** YYYY-MM-DD, or null. */
  due: string | null;
  /** Numbers of the files attached to it. */
  files: number[];
  points: string[];
  needsClarification: boolean;
  tags: string[];
};

const pad2 = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

// ---------- Reading Gmail's ids ----------

/** Gmail's message ids carry the time the message arrived: the hex id without its last 5 digits is ms since 1970. */
export function messageTime(hexId: string): number {
  if (!/^[0-9a-f]{12,20}$/i.test(hexId)) return 0;
  const ms = parseInt(hexId.slice(0, -5), 16);
  return ms > Date.UTC(2004, 0, 1) && ms < Date.now() + DAY_MS ? ms : 0;
}

/** "#msg-f:1798325123456789012" (data-message-id) → the same id in hex, as data-legacy-message-id has it. */
export function hexIdFromSync(syncId: string): string {
  const m = syncId.match(/msg-[a-z]:(\d+)/);
  if (!m?.[1]) return '';
  try {
    return BigInt(m[1]).toString(16);
  } catch {
    return '';
  }
}

// ---------- Which ClickUp project ----------

/** Webmail domains: anyone can have an address there, so they say nothing about the client. */
const WEBMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'gmx.de',
  'web.de',
  'proton.me',
  'protonmail.com',
  'yandex.com',
  'zoho.com',
  'net.hr',
  't-com.hr',
  'htnet.hr',
  'inet.hr',
  'email.t-com.hr',
]);

/**
 * What the project choice is remembered by: the sender's domain, or the whole address for
 * webmail (one gmail.com for every client would be wrong).
 */
export function senderKey(address: string): string {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 1 || at === a.length - 1) return '';
  const domain = a.slice(at + 1);
  return WEBMAIL.has(domain) ? a : domain;
}

/** Names to match against ClickUp projects for a sender: "cresanka" for anyone@cresanka.hr; none for webmail. */
export const senderNames = (key: string): string[] => (key && !key.includes('@') ? domainCandidates(key) : []);

/**
 * The team's own email domains: the ClickUp account's (unless it's webmail) and the agency's from
 * the footer-credit setting. Their people write about every project, so a sender there says
 * nothing about which, and their messages in a thread are context, not requests.
 */
export function teamDomains(o: { email?: string | undefined; footerCredit: string }): string[] {
  const own = (o.email ?? '').toLowerCase().split('@')[1] ?? '';
  return [...new Set([...(own && !isWebmail(own) ? [own] : []), ...creditDomains(o.footerCredit)])];
}

/** True for an address or domain of the team's own (see teamDomains). */
export function isOurDomain(addressOrDomain: string, ours: readonly string[]): boolean {
  const domain = addressOrDomain.toLowerCase().split('@').pop() ?? '';
  return ours.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Webmail, whose domain says nothing about the client either. */
export const isWebmail = (domain: string): boolean => WEBMAIL.has(domain.toLowerCase());

// ---------- The model's prompt ----------

export const EMAIL_SYSTEM_PROMPT = `You read an email a client sent to a web agency and list the work it asks for, so it can become ClickUp tasks.
Reply with JSON only, exactly this shape:
{"client": string or null,
 "points": [{"message": number, "quote": string, "title": string, "instruction": string, "kind": string, "pages": string[], "urls": string[], "links": string[], "component": string or null, "files": number[], "sensitive": string or null, "vague": string or null, "size": "small" or "larger", "urgent": string or null, "due": {"date": "YYYY-MM-DD", "said": string} or null}],
 "questions": [{"message": number, "quote": string}],
 "decorative": number[]}

What counts:
- A point is one change someone could make and tick off. One sentence with two requests is two points.
- Greetings, thanks, background, signatures, legal footers and sign-offs are not points.
- A question to the agency that needs an answer rather than work ("When will the spa page be live?") goes in "questions". A request phrased as a question ("Can the button be bigger?") is a point.
- Messages marked "context_only" were written by the agency or were handled before: use them to understand the rest, never take points or questions from them.

Each point:
- message: the number of the message it comes from.
- quote: the client's own words for it, copied exactly, in their language: the sentence, or the part of it, that asks for this. Never translate, shorten or correct the quote.
- title: a short imperative in English, ideally under 70 characters, e.g. "Change the Deluxe Suite size to 52 m²".
- instruction: one or two complete sentences in English saying what to change, where, and what it should be instead. Never invent details that aren't in the email.
- kind: "content" (text, numbers, typos, translations), "media" (replace or add images or video), "style" (a precise visual fix that needs no decision: a wrong colour, spacing or alignment, something overlapping or cut off), "bug" (something broken or behaving wrongly), "feature" (new functionality, sections or pages), "design" (needs a design decision: how visible, prominent or appealing something is, even when the client suggests a fix, e.g. "it's hard to see, can it be bigger?", "make it stand out more"), or "other".
- pages: the pages it's on, named as the client names them ("Rooms page", "homepage"); empty if none is named.
- urls: links from the email that point at those pages; empty if none. Only links that appear in the email.
- links: other links from the email that this point needs, such as a spreadsheet, document or folder listing the details ("the list of links is below"); empty if none. Only links that appear in the email.
- component: the element or section it's about ("Book Now button", "hero photo"), or null.
- files: the numbers of the files that belong to it: an [image N] placed beside it, or an attached file it mentions ("the attached photo"). Empty if none.
- sensitive: "booking" (booking engine, reservations, availability), "prices" (prices, rates, payments, vouchers), "legal" (terms, privacy, cookies, any legal text), or null.
- vague: when it doesn't say concretely what to change ("make it feel more premium"), a few words on what's unclear; otherwise null.
- size: "small" for one clear change in one place, otherwise "larger".
- urgent: the client's words that make it urgent ("broken", "guests complained", "urgent", "ASAP"), or null.
- due: only when the email names a deadline ("by Friday", "before Easter"): the date, worked out from the sent date of that message, and the words used; otherwise null.

Also:
- client: the hotel or company the email comes from (from the signature, the sender or the text), or null.
- decorative: the numbers of the files that are only decoration and no point needs: logos, pictures in a signature, banners, social media icons. Empty if none.
- If the email asks for nothing, return empty lists.`;

function sentLabel(m: EmailMessage): string {
  if (!m.sentAt) return m.dateText || 'unknown';
  const d = new Date(m.sentAt);
  return `${WEEKDAYS[d.getDay()]} ${isoDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const fromLabel = (f: EmailMessage['from']) => (f.name && f.email ? `${f.name} <${f.email}>` : f.name || f.email || 'unknown');

/** What GLM gets: the messages, oldest first, and the files they show or carry. */
export function emailPrompt(email: EmailPayload): string {
  return JSON.stringify({
    subject: email.subject,
    messages: email.messages.map((m) => ({
      message: m.n,
      from: fromLabel(m.from),
      sent: sentLabel(m),
      ...(m.context ? { context_only: true } : {}),
      text: m.text,
    })),
    files: email.files.map((f) => ({
      number: f.n,
      name: f.name,
      type: f.mime,
      where: f.kind === 'inline' ? `shown as [image ${f.n}] in message ${f.message}` : `attached to message ${f.message}`,
    })),
  });
}

// ---------- Tidying the model's answer ----------

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Models write "none" or "false" where they mean null. */
const maybe = (v: unknown, max: number): string | null => {
  const s = str(v, max);
  return !s || /^(null|none|no|false|n\/a|-)$/i.test(s) ? null : s;
};

const strs = (v: unknown, count: number): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .map((x) => str(x, 300))
    .filter(Boolean)
    .slice(0, count);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
};

const ints = (v: unknown): number[] => {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  return [...new Set(list.map((x) => Math.round(Number(x))).filter((n) => Number.isFinite(n) && n > 0))];
};

const normUrl = (u: string) =>
  u
    .trim()
    .replace(/[).,;:!?'"»]+$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();

/** Every link written out in the email's text. */
function linksIn(text: string): Set<string> {
  return new Set((text.match(/https?:\/\/[^\s<>()"']+/gi) ?? []).map(normUrl));
}

/** For comparing a quote with the email: spacing, quote marks, dashes and image markers don't count. */
const fold = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/\s*\[image \d+\]\s*/g, ' ')
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The quote really is in the text, word for word. */
export function quoteFound(quote: string, text: string): boolean {
  const q = fold(quote)
    .replace(/^["']+|["']+$/g, '')
    .replace(/[.!?…:;,]+$/, '')
    .trim();
  return q.length >= 3 && fold(text).includes(q);
}

/** A deadline the model worked out, if it's a real date near the message it came from. */
function cleanDue(v: unknown, sentAt: number): Due | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const date = str(d.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = new Date(`${date}T12:00:00`);
  if (Number.isNaN(t.getTime()) || isoDate(t) !== date) return null;
  const from = sentAt || Date.now();
  if (t.getTime() < from - 2 * DAY_MS || t.getTime() > from + 730 * DAY_MS) return null;
  return { date, said: str(d.said, 80) || date };
}

/** A title when the model gave none: the first sentence, cut at a word if it's long. */
function shortTitle(s: string): string {
  const first = s.split(/(?<=[.!?])\s/)[0] ?? s;
  if (first.length <= 80) return first.replace(/[.!?]+$/, '');
  return `${first.slice(0, 77).replace(/\s+\S*$/, '')}…`;
}

/**
 * Validates and tidies GLM's answer against the email it was given. Points from the agency's own
 * or already-sent messages are dropped, links the email doesn't contain are dropped, and every
 * quote is checked against the text. Returns null when the answer is unusable.
 */
export function sanitizeSplit(raw: unknown, email: EmailPayload): EmailSplit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.points) && !Array.isArray(r.questions)) return null;
  const byN = new Map(email.messages.map((m) => [m.n, m]));
  const latest = (email.messages.filter((m) => !m.context).at(-1) ?? email.messages.at(-1))?.n ?? 1;
  const messageOf = (v: unknown) => {
    const n = Math.round(Number(v));
    return byN.has(n) ? n : latest;
  };
  const allText = email.messages.map((m) => m.text).join('\n');
  const linked = linksIn(allText);
  const fileNs = new Set(email.files.map((f) => f.n));
  const found = (quote: string, message: number) => Boolean(quote) && (quoteFound(quote, byN.get(message)?.text ?? '') || quoteFound(quote, allText));

  const points: EmailPoint[] = [];
  for (const item of Array.isArray(r.points) ? r.points : []) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const message = messageOf(p.message);
    if (byN.get(message)?.context) continue;
    const quote = str(p.quote, 1200);
    const instruction = str(p.instruction, 800);
    const title = str(p.title, 200) || shortTitle(instruction || quote);
    if (!title) continue;
    points.push({
      id: `p${points.length + 1}`,
      message,
      quote,
      quoteFound: found(quote, message),
      title,
      instruction: instruction || title,
      kind: oneOf(p.kind, KINDS) ?? 'other',
      pages: strs(p.pages, 4),
      urls: strs(p.urls, 4).filter((u) => /^https?:\/\//i.test(u) && linked.has(normUrl(u))),
      links: strs(p.links, 4).filter((u) => /^https?:\/\//i.test(u) && linked.has(normUrl(u)) && !strs(p.urls, 4).some((x) => normUrl(x) === normUrl(u))),
      component: maybe(p.component, 120),
      files: ints(p.files ?? p.images).filter((n) => fileNs.has(n)),
      sensitive: oneOf(p.sensitive, SENSITIVES),
      vague: maybe(p.vague, 200),
      size: p.size === 'small' ? 'small' : 'larger',
      urgent: maybe(p.urgent, 120),
      due: cleanDue(p.due, byN.get(message)?.sentAt ?? 0),
    });
  }

  const questions: EmailQuestion[] = [];
  for (const item of Array.isArray(r.questions) ? r.questions : []) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const message = messageOf(q.message);
    const quote = str(q.quote, 600);
    if (!quote || byN.get(message)?.context) continue;
    questions.push({ message, quote, quoteFound: found(quote, message) });
  }

  // decoration no point claimed (a point that needs a picture knows better)
  const claimed = new Set(points.flatMap((p) => p.files));
  const decorative = ints(r.decorative).filter((n) => fileNs.has(n) && !claimed.has(n));
  return { client: maybe(r.client, 120), points, questions, decorative };
}

// ---------- Grouping and routing ----------

const KIND_TITLE: Record<PointKind, string> = {
  content: 'Content fixes',
  media: 'Image changes',
  style: 'Style fixes',
  bug: 'Fixes',
  feature: 'Additions',
  design: 'Design changes',
  other: 'Changes',
};

const fold2 = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** "Rooms page", "the rooms page" and "Rooms" are one page; "homepage" and "home page" too. */
function pageName(name: string): string {
  const s = fold2(name)
    .replace(/\bhome\s*page\b|\bnaslovnic\w*/g, 'home')
    .replace(/\b(the|page|pages|stranic\w*|on|na)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  return s;
}

/** The one page a point is on, or null when it names none or several (those don't group by page). */
function pageKey(p: EmailPoint): string | null {
  if (p.urls.length === 1 && p.pages.length <= 1) {
    try {
      const u = new URL(p.urls[0] ?? '');
      return `u:${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return null;
    }
  }
  if (p.urls.length || p.pages.length !== 1) return null;
  const name = pageName(p.pages[0] ?? '');
  return name ? `p:${name}` : null;
}

function pageLabel(p: EmailPoint): string {
  const name = p.pages[0];
  if (name) return /\bpage\b|homepage|stranic/i.test(name) ? name : `${name} page`;
  try {
    return new URL(p.urls[0] ?? '').pathname || '/';
  } catch {
    return 'the page';
  }
}

const componentKey = (p: EmailPoint) => (p.component ? fold2(p.component).replace(/[^a-z0-9]+/g, '') : '');

type Routed = { p: EmailPoint; to: 'mate' | 'person'; reasons: string[] };

/**
 * The tasks an email's points become. Points go together when they'd naturally be done together
 * (one pull request, or one CMS session):
 *   - the same component on several pages, same kind of work, or
 *   - the same page and the same kind of work,
 * and only when they go to the same person. Vague points, and anything touching booking, prices
 * or legal text, are tasks of their own. A point that names neither page nor component stays
 * alone (when unsure, don't group: merging in the review is easy). Groups above
 * `rules.maxPoints` are split.
 */
export function planTasks(split: EmailSplit, rules: RoutingRules = ROUTING): EmailTaskPlan[] {
  const routed: Routed[] = split.points.map((p) => ({ p, ...routePoint(p, rules) }));
  const order = new Map(split.points.map((p, i) => [p.id, i]));
  const groups: { items: Routed[]; title: (items: Routed[]) => string }[] = [];
  const taken = new Set<string>();
  const alone = (r: Routed) => Boolean(r.p.vague) || (r.p.sensitive !== null && rules.ownTask.includes(r.p.sensitive));
  const single = (items: Routed[]) => items[0]?.p.title ?? 'Change';

  for (const r of routed) {
    if (!alone(r)) continue;
    groups.push({ items: [r], title: single });
    taken.add(r.p.id);
  }

  // the same component on more than one page
  const byComponent = new Map<string, Routed[]>();
  for (const r of routed) {
    const c = componentKey(r.p);
    if (taken.has(r.p.id) || !c) continue;
    const key = `${r.to}|${r.p.kind}|${c}`;
    byComponent.set(key, [...(byComponent.get(key) ?? []), r]);
  }
  for (const items of byComponent.values()) {
    const pages = new Set(items.map((r) => pageKey(r.p) ?? `?${r.p.id}`));
    if (items.length < 2 || pages.size < 2) continue;
    groups.push({
      items,
      title: (list) => {
        const first = list[0]?.p;
        const names = [...new Set(list.flatMap((r) => (r.p.pages.length ? r.p.pages : r.p.urls)))];
        const where = names.length ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})` : '';
        return first ? `${KIND_TITLE[first.kind]}: ${first.component ?? 'element'}${where}` : 'Changes';
      },
    });
    for (const r of items) taken.add(r.p.id);
  }

  // the same page
  const byPage = new Map<string, Routed[]>();
  for (const r of routed) {
    const page = pageKey(r.p);
    if (taken.has(r.p.id) || !page) continue;
    const key = `${r.to}|${r.p.kind}|${page}`;
    byPage.set(key, [...(byPage.get(key) ?? []), r]);
  }
  for (const items of byPage.values()) {
    groups.push({
      items,
      title: (list) => {
        const first = list[0]?.p;
        if (!first) return 'Changes';
        return list.length === 1 ? first.title : `${KIND_TITLE[first.kind]} on ${pageLabel(first)}`;
      },
    });
    for (const r of items) taken.add(r.p.id);
  }

  for (const r of routed) if (!taken.has(r.p.id)) groups.push({ items: [r], title: single });

  const plans: (EmailTaskPlan & { at: number })[] = [];
  for (const g of groups) {
    const items = [...g.items].sort((a, b) => (order.get(a.p.id) ?? 0) - (order.get(b.p.id) ?? 0));
    const max = Math.max(1, rules.maxPoints);
    const chunks = Math.ceil(items.length / max);
    for (let c = 0; c < chunks; c++) {
      const part = items.slice(c * max, (c + 1) * max);
      const first = part[0];
      if (!first) continue;
      const dues = part.map((r) => r.p.due).filter((d): d is Due => d !== null);
      plans.push({
        at: order.get(first.p.id) ?? 0,
        title: `${part.length === 1 ? first.p.title : g.title(part)}${chunks > 1 ? ` (${c + 1} of ${chunks})` : ''}`,
        points: part.map((r) => r.p.id),
        route: first.to,
        reasons: [...new Set(part.flatMap((r) => r.reasons))],
        priority: part.some((r) => r.p.urgent) ? 'high' : null,
        due: dues.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
        needsClarification: part.some((r) => r.p.vague),
      });
    }
  }
  return plans.sort((a, b) => a.at - b.at).map(({ at: _, ...plan }) => plan);
}

// ---------- Task descriptions ----------

export const isImage = (f: Pick<EmailFile, 'mime' | 'name'>) => /^image\//i.test(f.mime) || /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i.test(f.name);

const filesWord = (files: EmailFile[]) => (files.every(isImage) ? (files.length === 1 ? 'Image' : 'Images') : files.length === 1 ? 'File' : 'Files');

/** "Fri 17.10.2026" */
export function dueLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getDay()]?.slice(0, 3)} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** A due date for ClickUp: midday local time, so no time zone moves it to another day. */
export const dueTimestamp = (date: string): number => new Date(`${date}T12:00:00`).getTime();

/** A HubSpot ticket marked High or Urgent: every task from it is high priority. */
export const ticketIsUrgent = (email: Pick<EmailPayload, 'ticket'>): boolean => /^(high|urgent|visok\w*|hitn\w*)$/i.test(email.ticket?.priority.trim() ?? '');

type Described = Pick<EmailPayload, 'app' | 'subject' | 'threadUrl' | 'messages' | 'files' | 'ticket'>;

/**
 * The lines every task starts with: who sent it and when, linking back to the conversation, then
 * the subject. From HubSpot: the ticket's record instead, and what HubSpot says about the ticket.
 */
function headLines(email: Described, ns: number[]): string[] {
  const msgs = email.messages.filter((m) => ns.includes(m.n));
  const latest = msgs.at(-1) ?? email.messages.filter((m) => !m.context).at(-1) ?? email.messages.at(-1);
  const who = latest
    ? `**${latest.from.name || latest.from.email || 'the client'}**${latest.from.name && latest.from.email ? ` (${latest.from.email})` : ''}`
    : '**the client**';
  const count = msgs.length > 1 ? `${msgs.length} emails from` : 'Email from';
  const when = latest?.dateText ? ` · ${latest.dateText}` : '';
  const t = email.ticket;
  if (t) {
    const url = t.url || email.threadUrl;
    const name = t.id ? `#${t.id}` : 'ticket';
    const facts = [t.company && `**Company** ${t.company}`, t.category && `**Category** ${t.category}`, t.owner && `**Owner** ${t.owner}`].filter(Boolean);
    return [
      `🎫 HubSpot ${url ? `[${name}](${url})` : name} · ${count} ${who}${when}`,
      ...(email.subject ? [`**Ticket** ${email.subject}`] : []),
      ...(facts.length ? [facts.join(' · ')] : []),
    ];
  }
  const link = email.threadUrl ? ` · [Open in ${email.app ?? 'Gmail'}](${email.threadUrl})` : '';
  return [`📧 ${count} ${who}${when}${link}`, ...(email.subject ? [`**Subject** ${email.subject}`] : [])];
}

const footer = (app: EmailPayload['app'], reporter: string | undefined, now: Date) => [
  '',
  '---',
  `Sent from ${app ?? 'Gmail'} with Pointer · ${formatDate(now)}${reporter ? ` · by ${reporter}` : ''}`,
];

/** What a link is, for its label: "Google Sheet", "Dropbox", else its site. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'docs.google.com') {
      const kind = u.pathname.split('/')[1];
      return kind === 'spreadsheets' ? 'Google Sheet' : kind === 'document' ? 'Google Doc' : kind === 'presentation' ? 'Google Slides' : kind === 'forms' ? 'Google Form' : 'Google Docs';
    }
    const known: [RegExp, string][] = [
      [/(^|\.)drive\.google\.com$/, 'Google Drive'],
      [/(^|\.)dropbox\.com$/, 'Dropbox'],
      [/(^|\.)(wetransfer\.com|we\.tl)$/, 'WeTransfer'],
      [/(^|\.)figma\.com$/, 'Figma'],
      [/(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms)$/, 'OneDrive'],
    ];
    return known.find(([re]) => re.test(host))?.[1] ?? host;
  } catch {
    return url;
  }
}

const quoteLines = (text: string) => text.split('\n').map((l) => `> ${l}`.trimEnd());

export type DescribeTask = {
  email: Described;
  points: EmailPoint[];
  priority: 'high' | null;
  due: Due | null;
  /** Files attached to the task: its points' own, and any no point of the email claimed. */
  attached: number[];
  reporter?: string;
  now?: Date;
};

/**
 * A task's Markdown description, in the page task's shape: the email it came from, then each point
 * with an English instruction, where it is, its files, and the client's words quoted as they wrote them.
 */
export function buildEmailDescription(t: DescribeTask): string {
  const fileOf = (n: number) => t.email.files.find((f) => f.n === n);
  const lines: string[] = headLines(t.email, [...new Set(t.points.map((p) => p.message))]);
  if (t.priority === 'high') {
    const why = t.points.find((p) => p.urgent)?.urgent;
    lines.push(`**Priority** High${why ? ` (“${why}”)` : ticketIsUrgent(t.email) ? ` (HubSpot ticket priority: ${t.email.ticket?.priority})` : ''}`);
  }
  // the client's words only while the date is still the one they gave
  if (t.due) lines.push(`**Due** ${dueLabel(t.due.date)}${t.due.said && t.due.said !== t.due.date ? ` (“${t.due.said}”)` : ''}`);
  const unclear = t.points.flatMap((p) => (p.vague ? [p.vague] : []));
  if (unclear.length) lines.push(`**Needs clarification** ${unclear.join('; ')}`);

  const several = t.points.length > 1;
  const messages = new Set(t.points.map((p) => p.message));
  const claimed = new Set<number>();
  t.points.forEach((p, i) => {
    lines.push('');
    if (several) lines.push(`**${i + 1}. ${p.title}**`);
    lines.push(`- ${p.instruction}`);
    const parts: string[] = [];
    if (p.urls.length) parts.push(`**Page** ${p.urls.map((u, j) => `[${p.pages[j] ?? p.pages[0] ?? u}](${u})`).join(', ')}`);
    else if (p.pages.length) parts.push(`**Page** ${p.pages.join(', ')} (no link)`);
    if (p.component) parts.push(`**Element** ${p.component}`);
    if (p.links?.length) parts.push(`**${p.links.length === 1 ? 'Link' : 'Links'}** ${p.links.map((u) => `[${linkLabel(u)}](${u})`).join(', ')}`);
    const own = p.files.filter((n) => t.attached.includes(n)).flatMap((n) => fileOf(n) ?? []);
    for (const f of own) claimed.add(f.n);
    if (own.length) parts.push(`**${filesWord(own)}** ${own.map((f) => f.name).join(', ')}`);
    if (messages.size > 1) {
      const m = t.email.messages.find((x) => x.n === p.message);
      if (m) parts.push(`**From** ${m.from.name || m.from.email}${m.dateText ? `, ${m.dateText}` : ''}`);
    }
    if (parts.length) lines.push(parts.join(' · '));
    if (p.quote) {
      const quoted = quoteLines(p.quote);
      if (!p.quoteFound) quoted[quoted.length - 1] += ' _(not found word for word in the email)_';
      lines.push(...quoted);
    }
  });

  const others = t.attached.filter((n) => !claimed.has(n)).flatMap((n) => fileOf(n) ?? []);
  if (others.length) lines.push('', `**Other ${filesWord(others).toLowerCase()} from the email** ${others.map((f) => f.name).join(', ')} (not tied to one point)`);

  lines.push(...footer(t.email.app, t.reporter, t.now ?? new Date()));
  return lines.join('\n');
}

/** The task's name when the email couldn't be split: who it's from and what about. */
export function fallbackName(email: Pick<EmailPayload, 'subject' | 'messages'>): string {
  const from = (email.messages.filter((m) => !m.context).at(-1) ?? email.messages.at(-1))?.from;
  const who = from?.name || from?.email || 'client';
  const name = email.subject ? `Email from ${who}: ${email.subject}` : `Email from ${who}`;
  return name.length > 120 ? `${name.slice(0, 117).trimEnd()}…` : name;
}

/** The whole email as one task, for when it couldn't be split: its text quoted as written, every file attached. */
export function buildFallbackDescription(t: {
  email: Described;
  reason: string;
  attached: number[];
  priority?: 'high' | null;
  reporter?: string;
  now?: Date;
}): string {
  const open = t.email.messages.filter((m) => !m.context);
  const shown = open.length ? open : t.email.messages;
  const name = (n: number) => t.email.files.find((f) => f.n === n)?.name ?? `image ${n}`;
  const lines = headLines(t.email, shown.map((m) => m.n));
  if (t.priority === 'high') lines.push(`**Priority** High${ticketIsUrgent(t.email) ? ` (HubSpot ticket priority: ${t.email.ticket?.priority})` : ''}`);
  lines.push('',`Pointer couldn't split this email into tasks (${t.reason}), so here it is as it was written.`);
  for (const m of shown) {
    lines.push('');
    if (shown.length > 1) lines.push(`**From ${m.from.name || m.from.email}${m.dateText ? `, ${m.dateText}` : ''}**`);
    lines.push(...quoteLines(m.text.replace(/\[image (\d+)\]/g, (_, n: string) => `[${name(Number(n))}]`)));
  }
  const files = t.attached.flatMap((n) => t.email.files.find((f) => f.n === n) ?? []);
  if (files.length) lines.push('', `**${filesWord(files)}** ${files.map((f) => f.name).join(', ')}`);
  lines.push(...footer(t.email.app, t.reporter, t.now ?? new Date()));
  return lines.join('\n');
}

export const emailTags = (needsClarification: boolean, unsplit: boolean, app?: EmailPayload['app']): string[] => [
  'pointer',
  'email',
  ...(app === 'HubSpot' ? ['hubspot'] : []),
  ...(needsClarification ? ['needs-clarification'] : []),
  ...(unsplit ? ['needs-rewrite'] : []),
];

/**
 * Who the two routes go to, as ClickUp user ids ('' is no one). Mate's tasks go to the default
 * assignee. The rest go to whoever runs Pointer, unless that's Mate's own account (its token pasted
 * into Pointer): then to the default assignee if that's someone else, or else to no one. Mate
 * never gets a task the rules keep from it just because its token is the one in use.
 */
export function routeAssignees(o: { defaultId: string; ownerId: string; mateId: string }): { mate: string; person: string } {
  const isMate = (id: string) => Boolean(id) && id === o.mateId;
  if (!isMate(o.ownerId)) return { mate: o.defaultId, person: o.ownerId };
  return { mate: o.defaultId, person: isMate(o.defaultId) ? '' : o.defaultId };
}

/**
 * A task's instructions for the review's summary: the description's "- " lines without Markdown,
 * or, for an email sent whole, its first quoted lines.
 */
export function previewLines(description: string): string[] {
  const plain = (s: string) =>
    s
      .replace(/\*\*/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`/g, '')
      .trim();
  const lines = description.split('\n');
  const bullets = lines.filter((l) => /^[-*] /.test(l)).map((l) => plain(l.slice(2)));
  if (bullets.length) return bullets.filter(Boolean);
  return lines
    .filter((l) => l.startsWith('> '))
    .map((l) => plain(l.slice(2)))
    .filter(Boolean)
    .slice(0, 2);
}

/**
 * The review's people. The tasks after the first follow its person until someone picks one for
 * them (`followsFirst` turns off), except that a task the rules keep from Mate never follows the
 * first one to Mate: it keeps the person it has. Returns each task's person, in order.
 */
export function inheritAssignees(tasks: { assigneeId: string; route: 'mate' | 'person'; followsFirst: boolean }[], mateId: string): string[] {
  const first = tasks[0]?.assigneeId ?? '';
  return tasks.map((t, i) => {
    if (i === 0 || !t.followsFirst) return t.assigneeId;
    if (mateId && first === mateId && t.route !== 'mate') return t.assigneeId;
    return first;
  });
}

/** Files the email has that no point claimed, decoration aside. They go on every task, so none is lost. */
export function unclaimedFiles(email: Pick<EmailPayload, 'files'>, split: EmailSplit): number[] {
  const claimed = new Set([...split.points.flatMap((p) => p.files), ...(split.decorative ?? [])]);
  return email.files.map((f) => f.n).filter((n) => !claimed.has(n));
}

export type DraftInput = {
  email: EmailPayload;
  split: EmailSplit;
  plans: EmailTaskPlan[];
  /** Set when the email couldn't be split: why. It then goes as one task. */
  unsplit?: string;
  /** Who each route goes to: ClickUp user ids, '' for no one. */
  assignees: { mate: string; person: string };
  /** Files that can be attached (they downloaded); the rest stay off the tasks and out of the descriptions. Default: all. */
  available?: number[];
  reporter?: string;
  now?: Date;
};

/** The tasks as the review shows them and Create sends them. */
export function draftTasks(d: DraftInput): EmailTaskDraft[] {
  const all = d.email.files.map((f) => f.n).filter((n) => !d.available || d.available.includes(n));
  if (d.unsplit !== undefined) {
    const priority = ticketIsUrgent(d.email) ? 'high' : null;
    return [
      {
        name: fallbackName(d.email),
        description: buildFallbackDescription({
          email: d.email,
          reason: d.unsplit,
          attached: all,
          priority,
          ...(d.reporter ? { reporter: d.reporter } : {}),
          ...(d.now ? { now: d.now } : {}),
        }),
        assigneeId: d.assignees.person,
        route: 'person',
        reasons: ["the email couldn't be split, so someone should read it"],
        priority,
        due: null,
        files: all,
        points: [],
        needsClarification: false,
        tags: emailTags(false, true, d.email.app),
      },
    ];
  }
  const extra = unclaimedFiles(d.email, d.split);
  return d.plans.map((plan) => {
    const points = plan.points.flatMap((id) => d.split.points.find((p) => p.id === id) ?? []);
    const own = points.flatMap((p) => p.files);
    const files = all.filter((n) => own.includes(n) || extra.includes(n));
    return {
      name: plan.title,
      description: buildEmailDescription({
        email: d.email,
        points,
        priority: plan.priority,
        due: plan.due,
        attached: files,
        ...(d.reporter ? { reporter: d.reporter } : {}),
        ...(d.now ? { now: d.now } : {}),
      }),
      assigneeId: plan.route === 'mate' ? d.assignees.mate : d.assignees.person,
      route: plan.route,
      reasons: plan.reasons,
      priority: plan.priority,
      due: plan.due?.date ?? null,
      files,
      points: plan.points,
      needsClarification: plan.needsClarification,
      tags: emailTags(plan.needsClarification, false, d.email.app),
    };
  });
}
