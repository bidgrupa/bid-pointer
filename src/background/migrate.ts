/**
 * Before 1.0, Pointer was bid's own tool with bid's setup built in: its ClickUp space, Mate as the
 * default assignee (a coding agent), bid's staging hosts and its footer credit. An install that
 * updates from one of those versions keeps working as it did, with that setup as ordinary
 * settings. A new install starts empty and is set up on the options page.
 */
import type { Settings } from '../shared/types';

const BID = {
  spaceId: '90142472614',
  spaceName: 'bid › DEVELOPMENT',
  mateId: '118313848',
  sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
  footerCredit: 'bid.agency, bid.hr',
};

/** True when version `a` is older than `b`: "0.10.0" is older than "1.0.0". */
export function olderThan(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * What an install from before 1.0 needs added to its stored settings to work as it did. Settings
 * held the old defaults only once something had been saved, so a missing space or assignee was bid's.
 */
export function bidSetup(stored: Partial<Settings>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  const spaceId = stored.spaceId ?? BID.spaceId;
  const assigneeId = stored.assigneeId ?? BID.mateId;
  if (stored.spaceId === undefined) patch.spaceId = spaceId;
  if (spaceId === BID.spaceId && !stored.spaceName) patch.spaceName = BID.spaceName;
  if (stored.assigneeId === undefined) {
    patch.assigneeId = assigneeId;
    patch.assigneeName = 'Mate';
  }
  if (assigneeId === BID.mateId && stored.codingAgent === undefined) patch.codingAgent = true;
  if (!stored.sites?.length) patch.sites = BID.sites;
  if (!stored.footerCredit) patch.footerCredit = BID.footerCredit;
  return patch;
}

/** Run once, when the browser updates Pointer from a version before 1.0. */
export async function keepBidSetup(): Promise<void> {
  const { settings } = (await chrome.storage.local.get('settings')) as { settings?: Partial<Settings> };
  await chrome.storage.local.set({ settings: { ...(settings ?? {}), ...bidSetup(settings ?? {}) } });
}
