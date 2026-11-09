/**
 * Runs on every page, and it's all that runs on sites Pointer isn't for. On localhost and the
 * sites on the person's list it activates Pointer straight away; anywhere else only when the
 * footer credits the agency named in the settings, if one is. Activating asks the background to
 * inject the full Pointer (content.js) into this tab.
 */
import { creditDomains, creditsFooter, startsByItself, type FooterSample } from '../shared/site';
import type { Msg, Settings } from '../shared/types';

const FOOTERS = 'footer, [role="contentinfo"], [id*="footer" i], [class*="footer" i]';
const SMALL = 'a, span, b, strong, em, small, p, li';
/** How long to keep looking for a footer that renders late (client-side apps, lazy sections). */
const WATCH_MS = 15_000;

function sampleFooters(): FooterSample | null {
  const roots = Array.from(document.querySelectorAll(FOOTERS)).slice(0, 30);
  if (!roots.length) return null;
  const text: string[] = [];
  const links: string[] = [];
  const shortTexts: string[] = [];
  for (const root of roots) {
    text.push(root.textContent ?? '');
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => links.push(a.href));
    for (const el of Array.from(root.querySelectorAll(SMALL)).slice(0, 400)) {
      const t = el.textContent?.trim() ?? '';
      if (t && t.length <= 12) shortTexts.push(t);
    }
  }
  return { text: text.join(' ').replace(/\s+/g, ' '), links, shortTexts };
}

let requested = false;
function activate() {
  if (requested) return;
  requested = true;
  chrome.runtime.sendMessage({ type: 'pointer:activate' } satisfies Msg).catch(() => {});
}

function watchForCredit(credit: string) {
  const found = () => {
    const sample = sampleFooters();
    return sample !== null && creditsFooter(sample, credit);
  };
  if (found()) return activate();
  let timer = 0;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!found()) return;
      observer.disconnect();
      activate();
    }, 500);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), WATCH_MS);
}

/** Just the two settings the detector needs; before setup there are none, and Pointer waits for the toolbar. */
async function siteRules(): Promise<{ sites: string[]; footerCredit: string }> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  return {
    sites: Array.isArray(settings?.sites) ? settings.sites : [],
    footerCredit: typeof settings?.footerCredit === 'string' ? settings.footerCredit : '',
  };
}

if (window.top === window) {
  void siteRules().then(({ sites, footerCredit }) => {
    if (startsByItself(location.hostname, sites)) activate();
    else if (creditDomains(footerCredit).length) watchForCredit(footerCredit);
  });
}
