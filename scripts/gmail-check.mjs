// Send to ClickUp in Gmail, for the smoke tests: a stand-in conversation at mail.google.com
// (tests/fixture/gmail.html), the files it shows, GLM's answer for it, and a look at the page.
// Served through request interception, so nothing reaches Google.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

export const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKmzVvzRJLhmnZvdPxbMx';

/** A solid-colour PNG of the given size. */
export function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The inline screenshot as Gmail shows it (resized) and as it was sent (the original). */
export const SHOWN = png(64, 36, [200, 120, 80]);
export const ORIGINAL = png(320, 180, [255, 161, 115]);
const HERO = png(240, 160, [40, 90, 140]);
const DOT = png(1, 1, [255, 255, 255]);

const fixture = () => readFileSync(resolve('tests/fixture/gmail.html'), 'utf8');

/** What the stand-in Gmail answers, or null for anything it doesn't serve. Logs what was asked for. */
export function gmailRoute(url, log = []) {
  const u = new URL(url);
  if (u.origin === 'https://mail.google.com' && u.pathname === '/mail/u/0/' && !u.search) return { contentType: 'text/html; charset=utf-8', body: fixture() };
  if (u.origin === 'https://mail.google.com' && u.pathname.startsWith('/mail/u/0')) {
    log.push(url);
    const attid = u.searchParams.get('attid');
    const view = u.searchParams.get('view');
    if (attid === '0.1') return { contentType: 'image/png', body: view === 'att' ? ORIGINAL : SHOWN };
    if (attid === '0.2') return { contentType: 'image/jpeg', body: HERO };
    return { contentType: 'image/png', body: DOT };
  }
  if (u.host === 'ci3.googleusercontent.com' || u.host === 'ssl.gstatic.com') return { contentType: 'image/png', body: DOT };
  return null;
}

const ROOMS = 'https://www.hotel-example.hr/en/rooms';

/** GLM's answer for the stand-in email: file 1 is the inline screenshot, file 2 the attached photo. */
export const EMAIL_SPLIT = {
  client: 'Hotel Example',
  points: [
    {
      message: 1,
      quote: 'On the Rooms page the Deluxe Suite still says 45 m², it should be 52 m².',
      title: 'Change the Deluxe Suite size to 52 m²',
      instruction: "On the Rooms page, change the Deluxe Suite's size from 45 m² to 52 m².",
      kind: 'content',
      pages: ['Rooms page'],
      urls: [ROOMS],
      component: 'Deluxe Suite',
      files: [1],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Also "balcony" is misspelled in the Superior Room text.',
      title: 'Fix the "balcony" typo in the Superior Room text',
      instruction: 'Correct the spelling of "balcony" in the Superior Room text on the Rooms page.',
      kind: 'content',
      pages: ['Rooms page'],
      urls: [ROOMS],
      component: 'Superior Room text',
      files: [],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'The Book Now button is hard to see on mobile, on the homepage and on Offers. Can it be bigger?',
      title: 'Make Book Now more visible on mobile',
      instruction: 'Make the Book Now button easier to see on mobile, on the homepage and the Offers page, for example by making it bigger.',
      kind: 'design',
      pages: ['homepage', 'Offers'],
      urls: [],
      component: 'Book Now button',
      files: [],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Please replace the Wellness hero photo with the attached one.',
      title: 'Replace the Wellness hero photo',
      instruction: 'Replace the hero photo on the Wellness page with the photo attached to the email.',
      kind: 'media',
      pages: ['Wellness'],
      urls: [],
      component: 'hero photo',
      files: [2],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Yesterday the booking engine showed €0 for one night. Guests noticed!',
      title: '€0 price shown in the booking engine',
      instruction: 'Find out why the booking engine showed a price of €0 for a one-night stay and fix it.',
      kind: 'bug',
      pages: [],
      urls: [],
      component: 'booking engine',
      files: [],
      sensitive: 'prices',
      vague: null,
      size: 'larger',
      urgent: 'Guests noticed!',
      due: null,
    },
  ],
  questions: [{ message: 1, quote: 'When will the new spa page be live?' }],
};

export const EMAIL_TASKS = ['Content fixes on Rooms page', 'Make Book Now more visible on mobile', 'Replace the Wellness hero photo', '€0 price shown in the booking engine'];

/** Everything the tests look at on the page, in one go. Runs in the page. */
export function mailState() {
  const host = document.querySelector('.amn [data-bid-pointer]');
  const button = host?.shadowRoot?.querySelector('.send');
  const forward = document.querySelector('.ams.bkG');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), radius: cs.borderTopLeftRadius, font: cs.fontFamily, size: cs.fontSize };
  };
  const overlay = document.querySelector('#bid-pointer-mail')?.shadowRoot;
  const frame = overlay?.querySelector('.mail-sheet');
  const loading = frame?.querySelector('.mail-progress');
  // the sheet counts once the tasks are in it; before that it shows the progress
  const sheet = loading ? null : frame;
  const toast = overlay?.querySelector('.toast');
  return {
    hasButton: Boolean(button),
    visible: Boolean(host && !host.hidden && button && button.getClientRects().length),
    label: button?.textContent?.trim() ?? null,
    state: button?.dataset.state ?? null,
    gold: button ? getComputedStyle(button).backgroundImage.includes('gradient') : false,
    lastInRow: host ? host.parentElement?.lastElementChild === host && host.previousElementSibling?.getAttribute('aria-label') === 'Add reaction' : false,
    button: box(button),
    forward: box(forward),
    gap: host && host.previousElementSibling ? Math.round(button.getBoundingClientRect().left - host.previousElementSibling.getBoundingClientRect().right) : null,
    sheet: sheet
      ? {
          compact: sheet.classList.contains('is-compact'),
          names: [...sheet.querySelectorAll('.mail-task .mail-name')].map((el) => el.value),
          list: [...sheet.querySelectorAll('.mail-list .mail-list-name')].map((el) => el.textContent),
          previews: [...sheet.querySelectorAll('.mail-task .mail-preview')].map((el) => [...el.children].map((li) => li.textContent)),
          descriptionsShown: [...sheet.querySelectorAll('.mail-task .mail-description')].filter((el) => !el.hidden).length,
          project: sheet.querySelector('.note-project')?.value ?? null,
          projectWhy: sheet.querySelector('.mail-project-why')?.textContent ?? null,
          create: sheet.querySelector('.mail-actions .btn--primary')?.textContent ?? null,
          createDisabled: Boolean(sheet.querySelector('.mail-actions .btn--primary')?.disabled),
          files: [...sheet.querySelectorAll('.mail-file')].map((el) => `${el.querySelector('.mail-file-name')?.textContent}${el.classList.contains('is-off') ? ' (off)' : ''}`),
          questions: [...sheet.querySelectorAll('.mail-questions li')].map((el) => el.textContent),
          why: [...sheet.querySelectorAll('.mail-why')].map((el) => el.textContent),
          people: [...sheet.querySelectorAll('.mail-task .mail-person')].map((el) => el.value),
          dues: [...sheet.querySelectorAll('.mail-task .mail-due')].map((el) => el.textContent),
          out: [...sheet.querySelectorAll('.mail-task')].map((el) => el.classList.contains('is-out')),
          // the tallest task row, to keep the review compact
          rowHeight: Math.max(0, ...[...sheet.querySelectorAll('.mail-task')].map((el) => Math.round(el.getBoundingClientRect().height))),
          width: Math.round(sheet.getBoundingClientRect().width),
        }
      : null,
    progress: loading
      ? {
          steps: [...loading.querySelectorAll('.mail-step')].map(
            (el) =>
              `${[...el.children]
                .map((c) => c.textContent.trim())
                .filter(Boolean)
                .join(' ')}${el.classList.contains('is-done') ? ' ✓' : el.classList.contains('is-active') ? ' …' : ''}`,
          ),
          bar: parseFloat(loading.querySelector('.mail-bar > span')?.style.width ?? '0'),
        }
      : null,
    toastBar: toast?.classList.contains('is-visible') && toast.querySelector('.toast-bar > span') ? parseFloat(toast.querySelector('.toast-bar > span').style.width || '0') : null,
    toast: toast?.classList.contains('is-visible') ? toast.textContent.replace(/\s+/g, ' ').trim() : '',
    toastLinks: toast ? [...toast.querySelectorAll('.toast-link')].map((a) => a.textContent) : [],
    rowClicks: window.__rowClicks,
    gmailKeys: window.__gmailKeys.slice(),
  };
}

/** Presses Send to ClickUp. Runs in the page. */
export function pressSend() {
  document.querySelector('.amn [data-bid-pointer]').shadowRoot.querySelector('.send').click();
}

/** Picks a project in the review and presses Create (or just Create). Runs in the page. */
export function reviewCreate(listId) {
  const sheet = document.querySelector('#bid-pointer-mail').shadowRoot.querySelector('.mail-sheet');
  if (listId) {
    const select = sheet.querySelector('.note-project');
    select.value = listId;
    select.dispatchEvent(new Event('change'));
  }
  sheet.querySelector('.mail-actions .btn--primary').click();
}

/** Picks a person for task `index` (0-based) in the review. Runs in the page. */
export function pickPerson(index, id) {
  const select = document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll('.mail-task .mail-person')[index];
  if (!select || ![...select.options].some((o) => o.value === id)) return false;
  select.value = id;
  select.dispatchEvent(new Event('change'));
  return true;
}

/** Presses one of a task's own buttons ('edit' or 'out') in the review. Runs in the page. */
export function taskAction(index, action) {
  document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll(`.mail-task [data-action="${action}"]`)[index]?.click();
}

/** Picks a task's due date in its calendar, as a person would: open it, go to the month, click the day. Runs in the page. */
export function setDue(index, date) {
  const root = document.querySelector('#bid-pointer-mail').shadowRoot;
  root.querySelectorAll('.mail-task .mail-due')[index].click();
  for (let i = 0; i < 36 && !root.querySelector(`.mail-cal-day[data-date="${date}"]:not(.is-other)`); i++) {
    const shown = root.querySelector('.mail-cal-day:not(.is-other)').dataset.date;
    root.querySelector(`.mail-cal [data-cal="${date < shown ? 'prev' : 'next'}"]`).click();
  }
  root.querySelector(`.mail-cal-day[data-date="${date}"]:not(.is-other)`).click();
}

/** Clears a task's due date with its calendar's "No due date". Runs in the page. */
export function clearDue(index) {
  const root = document.querySelector('#bid-pointer-mail').shadowRoot;
  root.querySelectorAll('.mail-task .mail-due')[index].click();
  [...root.querySelectorAll('.mail-cal-quick button')].find((b) => b.textContent === 'No due date').click();
}

/** Clicks a toast button by its label. Runs in the page. */
export function toastButton(label) {
  const button = [...document.querySelector('#bid-pointer-mail').shadowRoot.querySelectorAll('.toast button')].find((b) => b.textContent.trim() === label);
  button?.click();
  return Boolean(button);
}
