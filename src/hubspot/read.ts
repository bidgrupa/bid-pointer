/**
 * Reading a ticket off HubSpot's Help Desk. HubSpot's class names are generated; what's read here
 * are its data-test-id hooks (HubSpot's own test handles) and data-selenium-test ones, as a real
 * ticket page has them (Help Desk, October 2026):
 *   [data-test-id="helpdesk-more-actions-dropdown"]   the ticket's Actions button: the button goes left of it
 *   [data-test-id="inbox-thread-loaded"]              the conversation, loaded
 *   [data-test-id="primary-message-visitor"]          a message from the client (…-agent: from the agency)
 *   [data-test-id="sender-name"]                      who sent it (a name, no address)
 *   [data-test-id="sender-header-content-timestamp"]  when ("1:25 PM")
 *   [data-test-id="non-transparent-dash-label"]       the day above a run of messages ("October 23")
 *   [data-test-id="email-message-content"]            an email's body
 *   [data-test-id="file-attachment-wrapper"]          a file on a message (in file-attachments-grid)
 *   [data-test-id="ticket-header-name-link"] a        the ticket's name, linking to its record
 *   [data-test-id="ticket-header-ticket-id"]          "#100200300400"
 *   [data-test-id="reassignment-selected-agent"]      the owner, in the header ("No owner")
 *   [data-selenium-test="property-input-hs_ticket_priority"]   sidebar properties ("--" when unset)
 *   [data-test-id="card-wrapper-ASSOCIATION_V3/0-1"]  the contacts card (…/0-2: companies)
 * HubSpot draws a long conversation as a virtual list: the messages it has on the page are read.
 */
import { MIN_IMAGE_PX, bodyText, imageNameFrom, imageSize, mimeFromName, safeName, shown, type PendingFile, type Reading } from '../mail/read';
import { isOurDomain, type EmailMessage, type Ticket } from '../shared/email';
import { hubspotMessageId, hubspotSentAt } from '../shared/hubspot';

const MESSAGE = '[data-test-id="primary-message-visitor"], [data-test-id="primary-message-agent"]';
const DAY = '[data-test-id="non-transparent-dash-label"]';

export type TicketMessage = {
  el: HTMLElement;
  body: HTMLElement;
  /** Written by the agency (an agent's reply). */
  ours: boolean;
  sender: string;
  day: string;
  time: string;
  id: string;
};

export type FoundTicket = { actions: HTMLElement; id: string; messages: TicketMessage[] };

const textOf = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The first piece of text in an element: HubSpot writes truncated names twice (once to measure). */
function firstText(el: Element | null | undefined): string {
  if (!el) return '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}

/** A sidebar property as HubSpot shows it; '' for unset ("--"). */
function property(name: string, doc: Document): string {
  const value = textOf(doc.querySelector(`[data-selenium-test="property-input-${name}"]`));
  return /^-+$/.test(value) ? '' : value;
}

const visible = <T extends Element>(list: NodeListOf<T>): T | null => Array.from(list).find(shown) ?? null;

function bodyOf(message: Element): HTMLElement | null {
  const email = message.querySelector<HTMLElement>('[data-test-id="email-message-content"]');
  if (email) return email;
  const bodies = message.querySelectorAll<HTMLElement>('[data-test-id="primary-message-body-content"]');
  return bodies[bodies.length - 1] ?? null;
}

/** The ticket's number: in its header, else in the address. */
function ticketId(doc: Document): string {
  const shownId = textOf(doc.querySelector('[data-test-id="ticket-header-ticket-id"]')).match(/\d{3,}/)?.[0];
  return shownId ?? location.pathname.match(/\/ticket\/(\d+)/)?.[1] ?? location.pathname.match(/\/record\/0-5\/(\d+)/)?.[1] ?? '';
}

/** The open ticket, its Actions button and the messages it shows, or null when no ticket is open. */
export function findTicket(doc: Document = document): FoundTicket | null {
  const actions = visible(doc.querySelectorAll<HTMLElement>('[data-test-id="helpdesk-more-actions-dropdown"]'));
  const root = visible(doc.querySelectorAll<HTMLElement>('[data-test-id="inbox-thread-loaded"]'));
  if (!actions || !root) return null;
  const id = ticketId(doc);
  const messages: TicketMessage[] = [];
  const alike = new Map<string, number>();
  let day = '';
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`${DAY}, ${MESSAGE}`))) {
    if (el.matches(DAY)) {
      day = textOf(el);
      continue;
    }
    const body = bodyOf(el);
    if (!body || !shown(body) || !(textOf(body) || body.querySelector('img'))) continue;
    const sender = textOf(el.querySelector('[data-test-id="sender-name"]'));
    const time = textOf(el.querySelector('[data-test-id="sender-header-content-timestamp"]'));
    const same = [sender, day, time].join('|');
    const nth = alike.get(same) ?? 0;
    alike.set(same, nth + 1);
    messages.push({ el, body, ours: el.getAttribute('data-test-id') === 'primary-message-agent', sender, day, time, id: hubspotMessageId(id, sender, day, time, nth) });
  }
  return { actions, id, messages };
}

/** What HubSpot shows about the ticket: its name, record, owner, priority, category, contact and company. */
export function readTicketInfo(doc: Document = document): Ticket {
  const header = doc.querySelector('[data-test-id="ticket-header-name-link"]');
  const link = header?.querySelector<HTMLAnchorElement>('a[href]');
  let url = '';
  if (link) {
    const u = new URL(link.href, location.href);
    url = `${u.origin}${u.pathname}`;
  }
  const owner = textOf(doc.querySelector('[data-test-id="ticket-header-hubspot_owner_id-dropdown"] [data-test-id="reassignment-selected-agent"]'));

  const card = doc.querySelector('[data-test-id="card-wrapper-ASSOCIATION_V3/0-1"]');
  const primary = firstText(doc.querySelector('[data-test-id="ticket-header-contact-detail-link"]'));
  const chicklets = Array.from(card?.querySelectorAll('[data-selenium-test="chicklet"], [data-test-id^="chicklet-"]') ?? []);
  const chicklet = chicklets.find((c) => primary && firstText(c.querySelector('[data-test-id="contact-chicklet-title-link"]')) === primary) ?? chicklets[0] ?? card;
  const mail = chicklet?.querySelector<HTMLAnchorElement>('a[data-test-id="contact-chicklet-email"]');
  const email = (mail?.href.match(/^mailto:([^?]+)/i)?.[1] ?? textOf(mail)).trim().toLowerCase();

  const companies = doc.querySelector('[data-test-id="card-wrapper-ASSOCIATION_V3/0-2"]');
  const company = firstText(companies?.querySelector('[data-test-id$="chicklet-title-link"], [data-test-id$="chicklet-title"]'));

  return {
    id: ticketId(doc),
    name: firstText(link ?? header),
    url,
    owner: /^(no owner|unassigned|-+)$/i.test(owner) ? '' : owner,
    priority: property('hs_ticket_priority', doc),
    category: property('hs_ticket_category', doc),
    contact: {
      name: primary || firstText(chicklet?.querySelector('[data-test-id="contact-chicklet-title-link"]')),
      email: /@/.test(email) ? email : '',
      title: textOf(chicklet?.querySelector('[data-test-id="contact-chicklet-job-title"]')),
    },
    company,
  };
}

/** HubSpot's file links: the file's own size, not a thumbnail's, and no download-as. */
function originalOf(src: string): string {
  try {
    const u = new URL(src, location.href);
    if (/\/signed-url-redirect$/.test(u.pathname)) u.searchParams.delete('size');
    return u.href;
  } catch {
    return src;
  }
}

/** One file, however it's linked: its id in HubSpot's file manager, else its address. */
function fileKey(url: string): string {
  return url.match(/\/files\/(\d+)\//)?.[1] ?? url.split('?')[0] ?? url;
}

const FILE_NAME = /[^\s\\/:*?"<>|]+\.[a-z0-9]{2,5}\b/i;

/** A file's name: its download name, the name HubSpot shows, or its picture's; '' when none says. */
function fileNameOf(item: Element, link: HTMLAnchorElement | null, img: HTMLImageElement | null): string {
  const download = link?.getAttribute('download')?.trim();
  if (download) return download;
  try {
    const disposition = link ? new URL(link.href).searchParams.get('response-content-disposition') : null;
    const named = disposition?.match(/filename="?([^";]+)"?/)?.[1];
    if (named) return named;
  } catch {
    // no name in the link
  }
  const titled = Array.from(item.querySelectorAll('[title]')).map((el) => el.getAttribute('title') ?? '').find((t) => FILE_NAME.test(t));
  return titled ?? textOf(item).match(FILE_NAME)?.[0] ?? imageNameFrom(img?.getAttribute('alt') ?? null);
}

/** The files on a message (images, videos, documents), outermost element of each. */
function attachmentsOf(message: Element): HTMLElement[] {
  const all = Array.from(
    message.querySelectorAll<HTMLElement>('[data-test-id="file-attachment-wrapper"], [data-test-id="file-attachments-grid"] > *, [data-test-id="file-attachments-footer"] > *'),
  );
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };

/** The ticket's emails, as readThread reads Gmail's: the client's to split, the agency's as context. */
export function readTicket(t: FoundTicket, o: { sent: Set<string>; again: boolean; ours: readonly string[] }, doc: Document = document): Reading {
  const ticket = readTicketInfo(doc);
  const files: PendingFile[] = [];
  const seen = new Set<string>();
  const add = (f: Omit<PendingFile, 'n'>) => {
    const n = files.length + 1;
    files.push({ ...f, n });
    return n;
  };
  const sameName = (a: string, b: string) => Boolean(a) && a.toLowerCase() === b.toLowerCase();

  const read = t.messages.map((m, i) => {
    const message = i + 1;
    const text = bodyText(m.body, (img) => {
      const src = img.currentSrc || img.src;
      // a cid: picture HubSpot couldn't place, icons and tracking pixels stay out
      if (!/^(https?:|data:)/i.test(src) || imageSize(img) <= MIN_IMAGE_PX) return null;
      const url = originalOf(src);
      seen.add(fileKey(url));
      const named = imageNameFrom(img.getAttribute('alt'));
      return add({ name: named || `image-${files.length + 1}.png`, mime: named ? mimeFromName(named) : 'image/png', kind: 'inline', message, url, thumb: src });
    });

    for (const item of attachmentsOf(m.el)) {
      const link = item.querySelector<HTMLAnchorElement>('a[download][href], a[href*="signed-url"], a[href*="/filemanager/"], a[href*="hubspotusercontent"]');
      const img = item.querySelector<HTMLImageElement>('img');
      const media = item.querySelector<HTMLVideoElement | HTMLSourceElement>('video[src], source[src]');
      const url = link?.href || (img ? img.currentSrc || img.src : '') || media?.src || item.querySelector<HTMLAnchorElement>('a[href^="http"]')?.href || '';
      if (!url) continue;
      const original = originalOf(url);
      const key = fileKey(original);
      if (seen.has(key)) continue;
      seen.add(key);
      const name = safeName(fileNameOf(item, link, img) || `attachment-${files.length + 1}`);
      add({ name, mime: mimeFromName(name), kind: 'attachment', message, url: original, thumb: img ? img.currentSrc || img.src : null });
    }

    // HubSpot names the sender without an address; the ticket's contact has one
    const email = !m.ours && sameName(m.sender, ticket.contact.name) ? ticket.contact.email : '';
    const sentAt = hubspotSentAt(m.day, m.time);
    return {
      n: message,
      id: m.id,
      from: { name: m.sender, email },
      dateText: sentAt ? new Date(sentAt).toLocaleString('en-GB', DATE_FORMAT) : [m.day, m.time].filter(Boolean).join(', '),
      sentAt,
      text,
      clipped: false,
      ours: m.ours || (Boolean(email) && isOurDomain(email, o.ours)),
      sent: !o.again && o.sent.has(m.id),
    };
  });

  // context only while something else is left to read, as in Gmail
  const fresh = read.filter((m) => !m.sent);
  const theirs = fresh.filter((m) => !m.ours);
  const messages: EmailMessage[] = read.map(({ ours, sent, ...m }) => ({
    ...m,
    context: sent && fresh.length ? 'sent' : ours && theirs.length ? 'ours' : null,
  }));

  return {
    payload: {
      app: 'HubSpot',
      subject: ticket.name,
      threadUrl: ticket.url || `${location.origin}${location.pathname}`,
      messages,
      files: files.map(({ url: _, thumb: __, ...f }) => f),
      ticket,
    },
    files,
  };
}
