/** Small helpers every part of the options page uses. */
import { getSettings, patchSettings } from '../background/settings';
import type { Settings } from '../shared/types';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let savedTimer = 0;
export function flashSaved() {
  const el = $('saved');
  el.classList.add('is-visible');
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => el.classList.remove('is-visible'), 1200);
}

export function setStatus(id: string, text: string, kind: '' | 'ok' | 'bad' = '') {
  const el = $(id);
  el.textContent = text;
  el.className = kind ? `status is-${kind}` : 'status';
}

/** Fills a field from the settings and saves it on change. */
export async function bindField(id: keyof Settings, kind: 'text' | 'checkbox') {
  const el = $<HTMLInputElement>(id);
  const s = await getSettings();
  if (kind === 'checkbox') el.checked = Boolean(s[id]);
  else el.value = String(s[id] ?? '');
  el.addEventListener('change', async () => {
    const value = kind === 'checkbox' ? el.checked : el.value.trim();
    await patchSettings({ [id]: value } as Partial<Settings>);
    flashSaved();
  });
}
