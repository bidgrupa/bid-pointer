/**
 * Send to ClickUp in HubSpot's Help Desk: the gold button left of a ticket's Actions button, shown
 * while the ticket has emails on the page (read.ts reads them and the ticket; mail/pointer.ts does
 * the rest, as in Gmail).
 */
import { bootMail, checkFile, pageFetch, viaBackground, type MailApp } from '../mail/pointer';
import type { PendingFile } from '../mail/read';
import { isHubSpotFileHost } from '../shared/hubspot';
import { findTicket, readTicket } from './read';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A file as HubSpot's page loads it, with the person's session. HubSpot's file links redirect to
 * its file server, which may not let the page read the file; then the extension's background
 * fetches it with the same session (for HubSpot's servers only). Other sites' images go through
 * the background without cookies.
 */
async function download(f: PendingFile): Promise<Blob> {
  const url = new URL(f.url, location.href).href;
  if (!isHubSpotFileHost(url)) return viaBackground(url);
  try {
    const res = await pageFetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HubSpot answered ${res.status}`);
    return checkFile(await res.blob());
  } catch (first) {
    try {
      return await viaBackground(url, true);
    } catch (e) {
      throw new Error(`${errMsg(first)}; ${errMsg(e)}`);
    }
  }
}

const hubspot: MailApp = {
  name: 'HubSpot',
  what: "the ticket's emails",
  find() {
    const t = findTicket();
    if (!t?.messages.length) return null;
    // the client's messages count; the agency's replies are context
    const theirs = t.messages.filter((m) => !m.ours);
    return { anchor: t.actions, place: 'before', reference: t.actions, ids: (theirs.length ? theirs : t.messages).map((m) => m.id) };
  },
  read(o) {
    const t = findTicket();
    return t?.messages.length ? readTicket(t, o) : null;
  },
  download,
};

bootMail(hubspot);
