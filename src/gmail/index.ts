/**
 * Send to ClickUp in Gmail: the gold button beside Reply and Forward, shown while a conversation
 * has an expanded email (read.ts reads it; mail/pointer.ts does the rest).
 */
import { bootMail, checkFile, pageFetch, viaBackground, type MailApp } from '../mail/pointer';
import type { PendingFile } from '../mail/read';
import { accountEmail, findThread, messageIdOf, readThread } from './read';

/** Gmail shows inline images resized; the same attachment under view=att is the original file. */
function originalOf(src: string): string | null {
  try {
    const u = new URL(src);
    if (u.origin !== location.origin || u.searchParams.get('view') !== 'fimg') return null;
    u.searchParams.set('view', 'att');
    u.searchParams.set('disp', 'safe');
    u.searchParams.delete('sz');
    return u.href;
  } catch {
    return null;
  }
}

/** As Gmail downloads it: Gmail's own cookies, and Google's attachment server allows Gmail's origin. */
async function fromGmail(url: string): Promise<Blob> {
  const u = new URL(url, location.href);
  // a new address every time: a repeated one can bounce between Gmail and the attachment server
  u.searchParams.set('pointer', Date.now().toString(36));
  const res = await pageFetch(u.href, { credentials: 'include' });
  if (!res.ok) throw new Error(`Gmail answered ${res.status}`);
  return checkFile(await res.blob());
}

async function download(f: PendingFile): Promise<Blob> {
  const url = new URL(f.url, location.href);
  // an image from outside Gmail (its image proxy, a website): the background may read it, the page may not
  if (url.origin !== location.origin) return viaBackground(url.href);
  const original = f.kind === 'inline' ? originalOf(url.href) : null;
  if (original) {
    try {
      const blob = await fromGmail(original);
      if (/^image\//i.test(blob.type) || blob.type === 'application/octet-stream') return blob;
    } catch {
      // the picture Gmail shows will do
    }
  }
  return fromGmail(url.href);
}

const gmail: MailApp = {
  name: 'Gmail',
  what: 'the expanded emails',
  find() {
    const thread = findThread();
    if (!thread?.messages.length) return null;
    return { anchor: thread.row, place: 'append', reference: null, ids: thread.messages.map(messageIdOf).filter(Boolean) };
  },
  read(o) {
    const thread = findThread();
    return thread?.messages.length ? readThread(thread, { ...o, account: accountEmail() }) : null;
  },
  download,
};

bootMail(gmail);
