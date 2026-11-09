import type { Settings } from '../shared/types';

export const DEFAULT_SETTINGS: Settings = {
  zaiKey: '',
  clickupToken: '',
  clickupUser: null,
  assigneeId: '',
  assigneeName: '',
  spaceId: '',
  spaceName: '',
  codingAgent: false,
  sites: [],
  footerCredit: '',
  consentAt: '',
  reviewBeforeSend: false,
  pageTask: false,
  commentMode: false,
  seoCheck: true,
  hostProjects: {},
  domainProjects: {},
  recent: [],
};

export async function getSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings> | undefined) ?? {}) };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** The person's Z.ai key; '' means notes go out as written. */
export const effectiveZaiKey = (s: Settings): string => s.zaiKey.trim();

/** Firefox asks at install whether the person agrees to what Pointer sends; other browsers have Pointer ask. */
export const NEEDS_CONSENT = __POINTER_BROWSER__ !== 'firefox';

/** What's still missing before Pointer can send anything, in the words the page shows. */
export function missingKeys(s: Settings): string[] {
  const missing: string[] = [];
  if (NEEDS_CONSENT && !s.consentAt) missing.push('your OK on what Pointer sends');
  if (!s.clickupToken.trim()) missing.push('ClickUp token');
  else if (!s.spaceId.trim()) missing.push('ClickUp space');
  return missing;
}
