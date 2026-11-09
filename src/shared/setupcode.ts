/**
 * Setup codes: a team's Pointer setup as one string to paste, so a new colleague doesn't fill in
 * every field by hand. A code is the shareable settings as JSON, deflated (zlib's checksum catches a
 * code that's cut off or mistyped) and written in URL-safe base64 after "PTR1.".
 *
 * It's encoded, not encrypted: anyone with a code can read it, so a code with the Z.ai key in it is
 * as secret as the key. Never in a code: the ClickUp token, the person's OK on what Pointer sends,
 * and anything they've built up (remembered projects, recent tasks). Pure functions, unit-tested.
 */
import { creditDomains, sitePattern } from './site';
import type { Settings } from './types';

const PREFIX = 'PTR1.';
const VERSION = 1;

/** What a code can carry, under a short name, to keep codes short. */
const FIELDS = {
  spaceId: 's',
  spaceName: 'sn',
  assigneeId: 'a',
  assigneeName: 'an',
  codingAgent: 'c',
  sites: 'w',
  footerCredit: 'f',
  zaiKey: 'z',
  reviewBeforeSend: 'r',
  pageTask: 'p',
  commentMode: 'm',
  seoCheck: 'o',
} as const;

type Field = keyof typeof FIELDS;
export type SharedSettings = Partial<Pick<Settings, Field>>;

/** The settings a team shares. The Z.ai key only when asked for, and nothing that's still empty. */
export function sharedSettings(s: Settings, withZaiKey: boolean): SharedSettings {
  const out: SharedSettings = {
    codingAgent: s.codingAgent,
    reviewBeforeSend: s.reviewBeforeSend,
    pageTask: s.pageTask,
    commentMode: s.commentMode,
    seoCheck: s.seoCheck,
  };
  if (s.spaceId) Object.assign(out, { spaceId: s.spaceId, spaceName: s.spaceName });
  if (s.assigneeId) Object.assign(out, { assigneeId: s.assigneeId, assigneeName: s.assigneeName });
  if (s.sites.length) out.sites = s.sites;
  if (s.footerCredit) out.footerCredit = s.footerCredit;
  if (withZaiKey && s.zaiKey.trim()) out.zaiKey = s.zaiKey.trim();
  return out;
}

const text = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim().length <= max ? v.trim() : undefined);
const id = (v: unknown): string | undefined => {
  const t = text(v, 32);
  return t !== undefined && /^\d*$/.test(t) ? t : undefined;
};

/** Only the known fields, each of the right kind and tidied as the options page would; the rest is dropped. */
export function sanitizeShared(raw: Record<string, unknown>): SharedSettings {
  const out: SharedSettings = {};
  const spaceId = id(raw.spaceId);
  if (spaceId !== undefined) out.spaceId = spaceId;
  const spaceName = text(raw.spaceName);
  if (spaceName !== undefined) out.spaceName = spaceName;
  const assigneeId = id(raw.assigneeId);
  if (assigneeId !== undefined) out.assigneeId = assigneeId;
  const assigneeName = text(raw.assigneeName);
  if (assigneeName !== undefined) out.assigneeName = assigneeName;
  if (Array.isArray(raw.sites)) {
    out.sites = [...new Set(raw.sites.filter((x): x is string => typeof x === 'string').map(sitePattern).filter(Boolean))].slice(0, 50);
  }
  if (typeof raw.footerCredit === 'string') out.footerCredit = creditDomains(raw.footerCredit).join(', ');
  const zaiKey = text(raw.zaiKey);
  if (zaiKey && /^[\w.-]+$/.test(zaiKey)) out.zaiKey = zaiKey;
  for (const flag of ['codingAgent', 'reviewBeforeSend', 'pageTask', 'commentMode', 'seoCheck'] as const) {
    if (typeof raw[flag] === 'boolean') out[flag] = raw[flag];
  }
  return out;
}

async function deflate(json: string): Promise<Uint8Array> {
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function encodeSetup(shared: SharedSettings): Promise<string> {
  const short: Record<string, unknown> = { v: VERSION };
  for (const [field, key] of Object.entries(FIELDS)) {
    const value = shared[field as Field];
    if (value !== undefined) short[key] = value;
  }
  return PREFIX + toBase64Url(await deflate(JSON.stringify(short)));
}

/** The settings in a code. Throws with a sentence for the options page when it isn't one. */
export async function decodeSetup(code: string): Promise<SharedSettings> {
  const compact = code.replace(/\s+/g, '');
  if (!compact.startsWith(PREFIX)) throw new Error("That isn't a Pointer setup code. Codes start with PTR1.");
  let short: Record<string, unknown>;
  try {
    short = JSON.parse(await inflate(fromBase64Url(compact.slice(PREFIX.length)))) as Record<string, unknown>;
  } catch {
    throw new Error('This code is cut off or mistyped. Copy the whole code again.');
  }
  if (typeof short !== 'object' || short === null) throw new Error('This code is cut off or mistyped. Copy the whole code again.');
  if (typeof short.v === 'number' && short.v > VERSION) throw new Error('This code comes from a newer Pointer. Update Pointer, then paste it again.');
  const raw: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(FIELDS)) if (key in short) raw[field] = short[key];
  return sanitizeShared(raw);
}

const onOff = (on: boolean) => (on ? 'on' : 'off');

/** What a code sets, one line each, for the person to check before it's used. */
export function describeSetup(s: SharedSettings): string[] {
  const lines: string[] = [];
  if (s.spaceId !== undefined) lines.push(`ClickUp space: ${s.spaceName || `space ${s.spaceId}`}`);
  if (s.assigneeId !== undefined) {
    const who = s.assigneeId ? s.assigneeName || `user ${s.assigneeId}` : 'no one';
    lines.push(`Default assignee: ${who}${s.assigneeId && s.codingAgent ? ', a coding agent' : ''}`);
  } else if (s.codingAgent !== undefined) lines.push(`Coding agent: ${onOff(s.codingAgent)}`);
  if (s.sites) lines.push(`Your sites: ${s.sites.length ? s.sites.join(', ') : 'none'}`);
  if (s.footerCredit !== undefined) lines.push(`Agency domains: ${s.footerCredit || 'none'}`);
  if (s.zaiKey) lines.push('Z.ai key: included');
  if (s.reviewBeforeSend !== undefined) lines.push(`Review the rewrite before creating the task: ${onOff(s.reviewBeforeSend)}`);
  if (s.pageTask !== undefined) lines.push(`Page Specific Task: ${onOff(s.pageTask)}`);
  if (s.commentMode !== undefined) lines.push(`Comment Mode: ${onOff(s.commentMode)}`);
  if (s.seoCheck !== undefined) lines.push(`SEO checker: ${onOff(s.seoCheck)}`);
  return lines;
}
