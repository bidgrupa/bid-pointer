// The SEO check, for both smoke suites: a staging page with planted problems
// (tests/fixture/seo.html), the files around it (robots.txt, the sitemap, images, a broken link
// and a redirect), a look at the panel, and the walk through it, by real clicks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { png } from './gmail-check.mjs';

export const SEO_HOST = 'seo-staging.vercel.app';
export const SEO_PATH = '/seo/rooms/superior';
/** What staging hosts are remembered under: the project the page's tasks go to. */
export const SEO_PROJECT = { seo: { listId: '901417200456', label: 'Cresanka › Development' } };

const IMAGES = { hero: png(640, 300, [90, 140, 200]), terrace: png(300, 200, [255, 161, 115]), pool: png(300, 200, [40, 160, 170]), icon: png(24, 24, [29, 28, 44]) };

/** What the stand-in staging site answers (status, type, headers, body), or null for another site. */
export function seoRoute(url) {
  const u = new URL(url);
  if (u.hostname !== SEO_HOST) return null;
  const html = (body, headers = {}) => ({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'X-Robots-Tag': 'noindex', ...headers }, body });
  const text = (body, type) => ({ status: 200, contentType: type, headers: {}, body });
  if (u.pathname === SEO_PATH) return html(readFileSync(resolve('tests/fixture/seo.html'), 'utf8'));
  if (u.pathname === '/seo/rooms/standard') return html('<!doctype html><title>Standard room</title><h1>Standard room</h1>');
  if (u.pathname === '/seo/moved') return { status: 301, contentType: 'text/html', headers: { Location: '/seo/rooms/standard' }, body: '' };
  if (u.pathname === '/robots.txt') return text(`User-agent: *\nDisallow: /private/\nSitemap: ${u.origin}/sitemap.xml\n`, 'text/plain');
  if (u.pathname === '/sitemap.xml')
    return text(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.cresanka.hr/seo/rooms/standard</loc></url><url><loc>https://www.cresanka.hr${SEO_PATH}</loc></url></urlset>`,
      'application/xml',
    );
  const image = u.pathname.match(/^\/seo\/img\/(\w+)\.png$/)?.[1];
  if (image && IMAGES[image]) return { status: 200, contentType: 'image/png', headers: {}, body: IMAGES[image] };
  return { status: 404, contentType: 'text/html', headers: {}, body: '<!doctype html><h1>Not found</h1>' };
}

/** The SEO button and panel as they stand (runs in the page). */
export function seoState() {
  const root = document.querySelector('#bid-pointer')?.shadowRoot;
  const panel = root?.querySelector('.note.seo');
  const button = root?.querySelector('.seo-btn');
  const count = button?.querySelector('.seo-btn-count');
  const ids = (sel) => Array.from(panel?.querySelectorAll(sel) ?? [], (r) => r.dataset.id);
  const rows = {};
  for (const r of panel?.querySelectorAll('.seo-row') ?? [])
    rows[r.dataset.id] = { ticked: r.querySelector('input')?.checked ?? null, sent: r.classList.contains('is-sent'), items: r.querySelectorAll('.seo-item:not(.is-more)').length };
  const box = (el) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : null;
  };
  const mark = root?.querySelector('.seo-mark');
  return {
    button: { shown: Boolean(button && !button.hidden && button.getClientRects().length), label: button?.querySelector('.caps')?.textContent ?? '', count: count && !count.hidden ? count.textContent : null, fix: Boolean(count?.classList.contains('is-fix')) },
    open: Boolean(panel?.classList.contains('is-open')),
    rect: box(panel),
    waiting: panel?.querySelector('.seo-waiting')?.textContent ?? null,
    groups: { fix: ids('.seo-group--fix .seo-row'), improve: ids('.seo-group--improve .seo-row'), notice: ids('.seo-group--notice .seo-row') },
    passed: ids('.seo-list--passed .seo-row'),
    rows,
    serpTitle: panel?.querySelector('.seo-serp-title')?.textContent ?? '',
    sendLabel: panel?.querySelector('.seo-send')?.textContent?.trim() ?? '',
    links: panel?.querySelector('.seo-extra')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    justSent: panel?.querySelector('.seo-sent')?.textContent?.trim() ?? null,
    sentUrl: panel?.querySelector('.seo-sent a')?.href ?? null,
    review: Boolean(panel?.querySelector('.review-description')),
    mark: { visible: Boolean(mark?.classList.contains('is-visible')), rect: box(mark), label: mark?.querySelector('.seo-mark-tab')?.textContent ?? '' },
    toast: root?.querySelector('.toast.is-visible .toast-title')?.textContent ?? null,
  };
}

/** Clicks an element in Pointer's shadow root with the mouse, the way a person does, after scrolling it into view. */
async function press(page, selector) {
  const at = await page.evaluate((sel) => {
    const el = document.querySelector('#bid-pointer')?.shadowRoot?.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!at) throw new Error(`nothing to click at ${selector}`);
  await page.mouse.click(at.x, at.y);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The walk through, on a page already showing SEO_PATH with Pointer ready. `t` brings what differs
 * between the suites: check, delay, a screenshot name, the ClickUp mock's log, and settings.
 */
export async function runSeo(t) {
  const { page, check } = t;
  const state = () => page.evaluate(seoState);
  const until = async (ok, ms = 15000) => {
    const end = Date.now() + ms;
    let s = await state();
    while (!ok(s) && Date.now() < end) {
      await t.delay(150);
      s = await state();
    }
    return s;
  };

  let s = await until((x) => x.button.shown);
  check('SEO button in the dock beside Pointer', s.button.shown && s.button.label === 'SEO', JSON.stringify(s.button));
  await press(page, '.seo-btn');
  s = await until((x) => x.open && !x.waiting && x.passed.length > 0);
  const [vw, vh] = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.clientHeight]);
  check('the panel opens beside the dock, on screen', s.open && s.rect && s.rect.x >= 0 && s.rect.right <= vw && s.rect.y >= 0 && s.rect.bottom <= vh, JSON.stringify(s.rect));
  check('to fix: the empty canonical and the language codes', same(s.groups.fix, ['canonical-empty', 'hreflang-codes']), JSON.stringify(s.groups.fix));
  check(
    'to improve: title, description, alt texts, link text, share image',
    same(s.groups.improve, ['title-long', 'description-missing', 'images-alt', 'links-nameless', 'og-image-missing']),
    JSON.stringify(s.groups.improve),
  );
  check('good to know: heading levels, share tags, structured data', same(s.groups.notice, ['headings-order', 'og-tags-some', 'structured-none']), JSON.stringify(s.groups.notice));
  check(
    'passed: staging hidden by its header, robots.txt, the sitemap, tags in the HTML',
    ['status-ok', 'staging-hidden', 'rendered-ok', 'robots-ok', 'sitemap-listed', 'lang-ok', 'h1-ok'].every((id) => s.passed.includes(id)),
    JSON.stringify(s.passed),
  );
  check('the SEO button counts what to fix or improve', s.button.count === '7' && s.button.fix, JSON.stringify(s.button));
  check('the Google preview cuts the long title', s.serpTitle.endsWith(' ...') && s.serpTitle.startsWith('Superior Room'), s.serpTitle);
  check('everything to fix or improve starts ticked', s.sendLabel === 'Send 7 to ClickUp', s.sendLabel);
  await t.delay(300);
  await page.screenshot({ path: t.shot('seo-1-panel.png') });

  // unfolded: the images it means, each with Show, which rings it on the page
  await press(page, '[data-action="seo-expand"][data-id="images-alt"]');
  s = await state();
  check('unfolding lists the images without alt text', s.rows['images-alt']?.items === 2, JSON.stringify(s.rows['images-alt']));
  await press(page, '.seo-row[data-id="images-alt"] [data-action="seo-show"]');
  s = await until((x) => x.mark.visible);
  await t.delay(700); // the smooth scroll
  s = await state();
  const hero = await page.evaluate(() => {
    const r = document.querySelector('.hero-photo').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const near = (a, b) => Math.abs(a - b) < 2;
  check('Show rings the image on the page, named', s.mark.visible && near(s.mark.rect.x, hero.x) && near(s.mark.rect.y, hero.y) && near(s.mark.rect.w, hero.w) && s.mark.label === 'hero.png', JSON.stringify({ mark: s.mark, hero }));
  await page.screenshot({ path: t.shot('seo-2-show.png') });

  // unticked, a finding stays out of the task
  await press(page, '.seo-row[data-id="og-image-missing"] .seo-tick');
  s = await state();
  check('unticking leaves a finding out', s.rows['og-image-missing']?.ticked === false && s.sendLabel === 'Send 6 to ClickUp', s.sendLabel);

  // Check links: asked for, then the broken one is to fix and the redirect good to know
  check('Check links waits to be asked', /3 links to this site/.test(s.links), s.links);
  await press(page, '[data-action="seo-links"]');
  s = await until((x) => /checked/.test(x.links));
  check('Check links finds the broken link and the redirect', s.groups.fix.includes('links-broken') && s.groups.notice.includes('links-redirect'), JSON.stringify(s.groups));

  // to ClickUp: one task named after the page, the ticked findings numbered in it
  const sent = (await t.created()).length;
  await press(page, '.seo-send');
  s = await until((x) => Boolean(x.justSent));
  const task = (await t.created())[sent];
  // named like a page task: the first part of the page's title
  const named = 'Superior Room with a Sea View and a Private Balcony SEO';
  check('one SEO task, named after the page, tagged seo and staging', task?.name === named && task.tags.includes('seo') && task.tags.includes('staging'), JSON.stringify(task && { name: task.name, tags: task.tags }));
  const taskId = s.sentUrl?.split('/t/')[1];
  const description = task?.markdown_description ?? '';
  check(
    'its description numbers the ticked findings, and leaves out the unticked one',
    /SEO check · 7 findings/.test(description) && /\*\*1\. The canonical tag has no address\*\*/.test(description) && /1 broken link/.test(description) && !/share image/i.test(description),
    description.slice(0, 300),
  );
  check('sent findings say so, and untick', s.rows['canonical-empty']?.sent && s.rows['canonical-empty'].ticked === false && s.sendLabel === 'Nothing ticked', s.sendLabel);
  await page.screenshot({ path: t.shot('seo-3-sent.png') });

  // Undo deletes it, and the findings are ticked again
  const deleted = (await t.deleted()).length;
  await press(page, '.toast [data-action="undo"]');
  s = await until((x) => x.toast === 'Task deleted');
  const gone = (await t.deleted()).slice(deleted);
  check('Undo deletes the SEO task and ticks its findings again', Boolean(taskId) && gone.length === 1 && gone[0].endsWith(`/task/${taskId}`) && s.sendLabel === 'Send 7 to ClickUp', JSON.stringify({ gone, taskId, label: s.sendLabel }));

  // sent again; then closed and opened, it shows the same check; a fresh one knows what's in ClickUp
  await press(page, '.seo-send');
  s = await until((x) => Boolean(x.justSent));
  await page.keyboard.press('Escape');
  s = await until((x) => !x.open);
  check('Esc closes the panel', !s.open);
  await press(page, '.seo-btn');
  s = await until((x) => x.open);
  check('opened again, it shows the same check at once', !s.waiting && s.groups.fix.includes('links-broken'), JSON.stringify(s.groups.fix));
  await press(page, '[data-action="seo-rerun"]');
  s = await until((x) => x.open && !x.waiting && x.passed.length > 0);
  check('a fresh check remembers what went to ClickUp', s.rows['hreflang-codes']?.sent && s.rows['hreflang-codes'].ticked === false && s.sendLabel === 'Send 1 to ClickUp', s.sendLabel);

  // pointing closes it; the SEO checker setting takes the button away
  await press(page, '.launcher');
  s = await until((x) => !x.open);
  check('point mode closes the SEO panel', !s.open);
  await page.keyboard.press('Escape');
  await t.patchSettings({ seoCheck: false });
  s = await until((x) => !x.button.shown);
  check('switching the SEO checker off hides the button', !s.button.shown);
  await t.patchSettings({ seoCheck: true });
  s = await until((x) => x.button.shown);
  check('switching it on brings it back', s.button.shown);
}
