/**
 * Reading an email off Gmail's page. Gmail's markup is obfuscated and changes; the selectors here
 * are the long-lived ones the open-source Gmail libraries (InboxSDK, gmail.js) build on, and
 * whether something is open is judged by whether it's visible, not by class names:
 *   .amn                     the row under a conversation: Reply, Forward, the emoji button
 *   [data-message-id]        a message; data-legacy-message-id is its id in hex
 *   .a3s (in .ii.gt)         a message's body: a message is expanded when its body is visible
 *   span.gD[email]           the sender, with `email` and `name`
 *   .g3[title]               the sent date, in full in its title
 *   span.aZo                 an attachment card: its first link, or `download_url` (Chrome only)
 *   h2.hP                    the subject
 * Only what's shown is read: collapsed messages and trimmed quotes ("…") stay out.
 */
import { MIN_IMAGE_PX, bodyText, imageNameFrom, imageSize, mimeFromName, safeName, shown, type PendingFile, type Reading } from '../mail/read';
import { hexIdFromSync, messageTime, type EmailMessage } from '../shared/email';

export type Thread = {
  /** The visible Reply / Forward row, which the button goes into. */
  row: HTMLElement;
  /** The conversation the row belongs to. */
  root: HTMLElement;
  /** Its expanded messages, oldest first. */
  messages: HTMLElement[];
};

const bodyOf = (message: Element) => message.querySelector<HTMLElement>('.ii.gt .a3s') ?? message.querySelector<HTMLElement>('.a3s');

/** Expanded and loaded: its body is on screen and has something in it. */
function expanded(message: Element): boolean {
  const body = bodyOf(message);
  return Boolean(body && shown(body) && ((body.textContent ?? '').trim() || body.querySelector('img')));
}

/** Messages in the conversation, outermost [data-message-id] elements only. */
function messagesIn(root: Element): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]'));
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

/**
 * The conversation on screen and its expanded messages, or null when none is open. Gmail can keep
 * other conversations in the page, hidden; only the visible Reply row counts.
 */
export function findThread(doc: Document = document): Thread | null {
  for (const row of Array.from(doc.querySelectorAll<HTMLElement>('.amn'))) {
    if (row.closest('table') || !shown(row)) continue;
    let root = row.parentElement;
    while (root && !root.querySelector('[data-message-id]')) root = root.parentElement;
    if (!root) continue;
    return { row, root, messages: messagesIn(root).filter(expanded) };
  }
  return null;
}

/** A message's id in hex, from either of the attributes Gmail puts on it. */
export const messageIdOf = (message: Element): string =>
  message.getAttribute('data-legacy-message-id') || hexIdFromSync(message.getAttribute('data-message-id') ?? '');

/** The mailbox's own address, from the window title ("Inbox (3) - name@bid.hr - BID Mail"). */
export function accountEmail(title: string = document.title): string {
  return title.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]?.toLowerCase() ?? '';
}

const attid = (url: string): string => {
  try {
    const u = new URL(url, location.href);
    return `${u.searchParams.get('permmsgid') ?? u.searchParams.get('th') ?? ''}|${u.searchParams.get('attid') ?? ''}`;
  } catch {
    return '';
  }
};

/** Gmail's notice that it cut a long message short. */
const isClipped = (message: Element) =>
  Array.from(message.querySelectorAll<HTMLAnchorElement>('.iX a[href], a[href*="view=lg"]')).some((a) => /[?&]view=lg\b/.test(a.href));

type Options = {
  /** Gmail ids of messages already sent to ClickUp. */
  sent: Set<string>;
  /** Send them again anyway (the person asked to). */
  again: boolean;
  /** The mailbox's own address, whose domain counts as ours. */
  account: string;
  /** The team's own domains (see teamDomains). */
  ours: readonly string[];
};

/**
 * Everything the tasks are made from: each expanded message's sender, date and visible text, and
 * every image and attached file, numbered once for the whole email. The agency's own messages,
 * and ones sent before, are kept as context while there's anything else to read.
 */
export function readThread(thread: Thread, o: Options): Reading {
  const own = new Set([...o.ours, o.account.split('@')[1] ?? ''].filter(Boolean));
  const files: PendingFile[] = [];
  const seen = new Set<string>();
  const add = (f: Omit<PendingFile, 'n'>) => {
    const n = files.length + 1;
    files.push({ ...f, n });
    return n;
  };

  const read = thread.messages.map((el, i) => {
    const message = i + 1;
    const id = messageIdOf(el);
    const sender = el.querySelector<HTMLElement>('span.gD[email]') ?? el.querySelector<HTMLElement>('h3.iw [email]') ?? el.querySelector<HTMLElement>('[email]');
    const from = { name: (sender?.getAttribute('name') || sender?.textContent || '').trim(), email: (sender?.getAttribute('email') ?? '').trim() };
    const dateEl = el.querySelector<HTMLElement>('.g3');
    const dateText = (dateEl?.getAttribute('title') || dateEl?.textContent || '').trim();
    const sentAt = messageTime(id) || Date.parse(dateText) || 0;

    const body = bodyOf(el);
    const onImage = (img: HTMLImageElement) => {
      const src = img.currentSrc || img.src;
      if (!src || /^blob:/i.test(src) || imageSize(img) <= MIN_IMAGE_PX) return null;
      const key = attid(src);
      if (key && !key.endsWith('|')) seen.add(key);
      const named = imageNameFrom(img.getAttribute('alt'));
      const name = named || `image-${files.length + 1}.png`;
      return add({ name, mime: named ? mimeFromName(named) : 'image/png', kind: 'inline', message, url: src, thumb: src });
    };
    // Gmail's "…" that shows trimmed quotes, and its "[Message clipped]" notice, stay out
    const text = body ? bodyText(body, onImage, '.ajR, .ajT, .iX') : '';

    // attachment cards; an inline image Gmail also lists as an attachment counts once
    const extra: string[] = [];
    for (const chip of Array.from(el.querySelectorAll<HTMLElement>('span.aZo'))) {
      const link = (chip.firstElementChild?.tagName === 'A' ? chip.firstElementChild : chip.querySelector('a[href]')) as HTMLAnchorElement | null;
      const parsed = (chip.getAttribute('download_url') ?? '').match(/^([^:]*):([^:]*):(https?:\/\/.+)$/);
      const url = link?.href ? link.href.replace(/([?&])disp=inline(?=&|$)/, '$1disp=safe') : (parsed?.[3] ?? '');
      const name = (chip.querySelector('.aV3')?.textContent ?? parsed?.[2] ?? '').trim();
      if (!url) continue;
      // a Google Drive file is a link, not a file in the email
      if (!/^https:\/\/mail\.google\.com\//i.test(url)) {
        extra.push(`[Linked file: ${name || 'file'} (${url})]`);
        continue;
      }
      const key = attid(url);
      if (key && !key.endsWith('|') && seen.has(key)) continue;
      seen.add(key);
      const thumb = chip.querySelector<HTMLImageElement>('img.aQG')?.src ?? null;
      const fileName = safeName(name || `attachment-${files.length + 1}`);
      add({ name: fileName, mime: parsed?.[1] || mimeFromName(fileName), kind: 'attachment', message, url, thumb });
    }

    const domain = from.email.split('@')[1]?.toLowerCase() ?? '';
    return {
      n: message,
      id,
      from,
      dateText,
      sentAt,
      text: [text, ...extra].filter(Boolean).join('\n\n'),
      clipped: isClipped(el),
      ours: own.has(domain),
      sent: !o.again && Boolean(id) && o.sent.has(id),
    };
  });

  // context only while something else is left to read: a forward from a colleague is the client's email
  const fresh = read.filter((m) => !m.sent);
  const theirs = fresh.filter((m) => !m.ours);
  const messages: EmailMessage[] = read.map(({ ours, sent, ...m }) => ({
    ...m,
    context: sent && fresh.length ? 'sent' : ours && theirs.length ? 'ours' : null,
  }));

  const subject = Array.from(document.querySelectorAll<HTMLElement>('h2.hP, h2[data-legacy-thread-id]')).find(shown)?.textContent?.trim() ?? '';
  return { payload: { app: 'Gmail', subject, threadUrl: threadUrl(thread.root), messages, files: files.map(({ url: _, thumb: __, ...f }) => f) }, files };
}

/** A link back to the conversation for whoever logged it: Gmail's own id for it, under All Mail. */
function threadUrl(root: Element): string {
  const base = `${location.origin}${location.pathname}`;
  const token = location.hash.split('/').pop() ?? '';
  if (/^[A-Za-z0-9_-]{12,}$/.test(token)) return `${base}#all/${token}`;
  const legacy =
    root.querySelector('[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id') ??
    document.querySelector('h2[data-legacy-thread-id]')?.getAttribute('data-legacy-thread-id');
  return legacy ? `${base}#all/${legacy}` : location.href;
}
