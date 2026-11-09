/**
 * "Where Pointer shows up": the sites it starts on by itself (as staging), and the agency's
 * footer credit, which brings it onto the live sites that name the agency. Everywhere else it
 * waits for the toolbar button or the shortcut.
 */
import { getSettings, patchSettings } from '../background/settings';
import { creditDomains, sitePattern } from '../shared/site';
import { $, flashSaved } from './dom';

/** One entry per line (commas work too), tidied to host patterns, without repeats. */
const parseSites = (text: string): string[] => [...new Set(text.split(/[\n,]+/).map(sitePattern).filter(Boolean))];

export async function wireSites() {
  const s = await getSettings();
  const sites = $<HTMLTextAreaElement>('sites');
  const credit = $<HTMLInputElement>('footerCredit');
  sites.value = s.sites.join('\n');
  credit.value = s.footerCredit;

  sites.addEventListener('change', async () => {
    const next = parseSites(sites.value);
    sites.value = next.join('\n');
    await patchSettings({ sites: next });
    flashSaved();
  });
  credit.addEventListener('change', async () => {
    const domains = creditDomains(credit.value);
    credit.value = domains.join(', ');
    await patchSettings({ footerCredit: credit.value });
    flashSaved();
  });
}
