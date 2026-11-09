// Send to ClickUp in HubSpot, for the smoke tests: a stand-in Help Desk ticket at app-eu1.hubspot.com
// (tests/fixture/hubspot.html), the files it shows, GLM's answer for it, and a look at the page.
// Served through request interception, so nothing reaches HubSpot.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { png } from './gmail-check.mjs';

export const HUBSPOT_URL = 'https://app-eu1.hubspot.com/help-desk/147607823/view/964663538/ticket/100200300400/thread/22568001763';
export const LUMEN = { listId: '901400000555', label: 'Lumen' };
export const SHEET = 'https://docs.google.com/spreadsheets/d/1ExampleSheetForPointerTests00000000000000000/edit?usp=sharing';

/** The client's screenshot as the thread shows it (a preview) and as it was sent. */
export const HS_SHOWN = png(48, 27, [90, 160, 200]);
export const HS_ORIGINAL = png(400, 225, [30, 120, 190]);
/** The attached screenshot; HubSpot's file server won't let the page read it (see hubspotRoute). */
export const HS_ATTACHED = png(300, 170, [220, 80, 60]);
const LOGO = png(160, 114, [0, 73, 75]);
const LEAF = png(27, 24, [80, 160, 80]);

const fixture = () => readFileSync(resolve('tests/fixture/hubspot.html'), 'utf8');

/**
 * What the stand-in HubSpot answers, or null for anything it doesn't serve. File downloads are
 * logged. The attachment's download link answers 403, as when HubSpot's file server doesn't allow
 * the page's origin: Pointer then asks its background, which the smoke test's mock answers.
 */
export function hubspotRoute(url, log = []) {
  const u = new URL(url);
  if (u.origin !== 'https://app-eu1.hubspot.com') return null;
  if (u.pathname === new URL(HUBSPOT_URL).pathname) return { contentType: 'text/html; charset=utf-8', body: fixture() };
  const file = u.pathname.match(/^\/api\/filemanager\/api\/v2\/files\/(\d+)\/signed-url-redirect$/)?.[1];
  if (!file) return null;
  const size = u.searchParams.get('size');
  if (!size) log.push(url); // a download, not a picture on the page
  if (file === '201') return { contentType: 'image/png', body: LOGO };
  if (file === '202') return { contentType: 'image/png', body: LEAF };
  if (file === '301') return { contentType: 'image/png', body: size ? HS_SHOWN : HS_ORIGINAL };
  if (file === '302') return size ? { contentType: 'image/png', body: HS_ATTACHED } : { status: 403, contentType: 'text/plain', body: 'Forbidden' };
  return null;
}

/** GLM's answer for the stand-in ticket: file 1 is the signature's logo, 2 the inline screenshot, 3 the attached one. */
export const HUBSPOT_SPLIT = {
  client: 'Lumen',
  points: [
    {
      message: 1,
      quote: 'Ljubazno vas molim da provjerite što uzrokuje navedene redirect loopove i možete li ih ispraviti.',
      title: 'Fix the redirect loops on 5 Lumen pages',
      instruction: 'Find out what causes the redirect loops on the five Lumen pages listed in the spreadsheet and fix them.',
      kind: 'bug',
      pages: [],
      urls: [],
      links: [SHEET],
      component: 'redirects',
      files: [3],
      sensitive: null,
      vague: null,
      size: 'larger',
      urgent: null,
      due: null,
    },
    {
      message: 3,
      quote: 'na mobitelu cookie banner prekriva gumb Book now na naslovnici',
      title: 'Keep the cookie banner off Book now on mobile',
      instruction: 'On mobile, move the cookie banner on the homepage so it no longer covers the Book now button.',
      kind: 'style',
      pages: ['naslovnica'],
      urls: [],
      links: [],
      component: 'cookie banner',
      files: [2],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
  ],
  questions: [],
  decorative: [1],
};

export const HUBSPOT_TASKS = ['Fix the redirect loops on 5 Lumen pages', 'Keep the cookie banner off Book now on mobile'];

/** Everything the tests look at on the page, in one go. Runs in the page. */
export function hubspotState() {
  const actions = document.querySelector('[data-test-id="helpdesk-more-actions-dropdown"]');
  const host = document.querySelector('[data-bid-pointer="send-to-clickup"]');
  const button = host?.shadowRoot?.querySelector('.send');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), radius: cs.borderTopLeftRadius, font: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight };
  };
  const overlay = document.querySelector('#bid-pointer-mail')?.shadowRoot;
  const frame = overlay?.querySelector('.mail-sheet');
  const sheet = frame?.querySelector('.mail-progress') ? null : frame;
  const toast = overlay?.querySelector('.toast');
  return {
    hasButton: Boolean(button),
    visible: Boolean(host && !host.hidden && button && button.getClientRects().length),
    label: button?.textContent?.trim() ?? null,
    title: button?.title ?? null,
    gold: button ? getComputedStyle(button).backgroundImage.includes('gradient') : false,
    beforeActions: Boolean(host && host.nextElementSibling === actions),
    button: box(button),
    actions: box(actions),
    gap: button && actions ? Math.round(actions.getBoundingClientRect().left - button.getBoundingClientRect().right) : null,
    sheet: sheet
      ? {
          compact: sheet.classList.contains('is-compact'),
          from: sheet.querySelector('.mail-from')?.textContent ?? '',
          names: [...sheet.querySelectorAll('.mail-task .mail-name')].map((el) => el.value),
          list: [...sheet.querySelectorAll('.mail-list .mail-list-name')].map((el) => el.textContent),
          project: sheet.querySelector('.note-project')?.value ?? null,
          projectWhy: sheet.querySelector('.mail-project-why')?.textContent ?? null,
          files: [...sheet.querySelectorAll('.mail-file')].map((el) => el.querySelector('.mail-file-name')?.textContent),
          why: [...sheet.querySelectorAll('.mail-why')].map((el) => el.textContent),
          people: [...sheet.querySelectorAll('.mail-task .mail-person')].map((el) => el.value),
          priorities: [...sheet.querySelectorAll('.mail-task .mail-priority')].map((el) => el.value),
        }
      : null,
    toast: toast?.classList.contains('is-visible') ? toast.textContent.replace(/\s+/g, ' ').trim() : '',
    toastLinks: toast ? [...toast.querySelectorAll('.toast-link')].map((a) => a.textContent) : [],
    headerClicks: window.__headerClicks,
    hubspotKeys: window.__hubspotKeys.slice(),
  };
}

/** Presses Send to ClickUp. Runs in the page. */
export function pressHubSpotSend() {
  document.querySelector('[data-bid-pointer="send-to-clickup"]').shadowRoot.querySelector('.send').click();
}
