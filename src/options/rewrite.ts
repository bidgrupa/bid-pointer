/**
 * "Rewrite with AI": the optional Z.ai key. With one, notes are rewritten into a short title and
 * a few bullets, and Send to ClickUp splits emails into tasks; without one, notes go as written.
 */
import { getSettings } from '../background/settings';
import { ZAI_MODEL, rewrite } from '../background/zai';
import type { RewriteContext } from '../shared/types';
import { $, bindField, errMsg, esc, setStatus } from './dom';

/** A typical quick note, typo and all, for "Test rewrite". */
const SAMPLE: RewriteContext = {
  note: 'book btn goes over the heading on phone, shud be under it',
  block: { name: 'Hero', id: '4821', source: 'debug-span' },
  element: { selector: 'section > div > button.btn-primary', text: 'Book now' },
  page: {
    url: 'https://staging.example.com/rooms/superior',
    host: 'staging.example.com',
    path: '/rooms/superior',
    title: 'Superior room',
    environment: 'staging',
    projectKey: 'example.com',
    repoLabel: 'example.com',
    slugCandidates: [],
  },
  projectLabel: 'Example Hotel',
};

function renderState(key: string) {
  $('zaiState').textContent = key
    ? 'On: notes are rewritten before they go to ClickUp.'
    : 'Off: notes go to ClickUp as you wrote them, and Send to ClickUp makes one task per email.';
}

export async function wireRewrite() {
  await bindField('zaiKey', 'text');
  $('zaiModel').textContent = ZAI_MODEL;
  renderState((await getSettings()).zaiKey.trim());
  $('zaiKey').addEventListener('change', () => renderState($<HTMLInputElement>('zaiKey').value.trim()));

  $('testZai').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('testZai');
    const key = $<HTMLInputElement>('zaiKey').value.trim();
    if (!key) return setStatus('zaiStatus', 'Paste a Z.ai key first.', 'bad');
    btn.disabled = true;
    setStatus('zaiStatus', 'Rewriting a sample note…');
    $('zaiSample').hidden = true;
    const t0 = performance.now();
    try {
      const p = await rewrite(key, SAMPLE);
      const ms = Math.round(performance.now() - t0);
      if (!p) return setStatus('zaiStatus', `The reply wasn't usable JSON (${ms} ms).`, 'bad');
      setStatus('zaiStatus', `Rewritten in ${ms} ms.`, 'ok');
      const box = $('zaiSample');
      box.innerHTML = `<p class="help">“${esc(SAMPLE.note)}” became:</p><b>${esc(p.title)}</b><ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
      box.hidden = false;
    } catch (e) {
      setStatus('zaiStatus', errMsg(e), 'bad');
    } finally {
      btn.disabled = false;
    }
  });
}
