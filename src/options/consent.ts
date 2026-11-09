/**
 * "What Pointer sends, and where": the disclosure, and the person's OK before anything is sent.
 * Chrome's store asks for that in the extension itself; Firefox asks at install instead
 * (data_collection_permissions), so there the list is shown for reference only.
 */
import { NEEDS_CONSENT, patchSettings } from '../background/settings';
import { formatDate } from '../shared/format';
import type { Settings } from '../shared/types';
import { $, flashSaved } from './dom';

export const consented = (s: Pick<Settings, 'consentAt'>): boolean => !NEEDS_CONSENT || Boolean(s.consentAt);

let changed: () => void = () => {};

function render(consentAt: string) {
  const ok = consented({ consentAt });
  $<HTMLDetailsElement>('consentList').open = !ok;
  $('consentAgree').hidden = ok || !NEEDS_CONSENT;
  $('consentDone').hidden = !NEEDS_CONSENT || !ok;
  $('consentWhen').textContent = consentAt ? formatDate(new Date(consentAt)) : '';
  $('consentFirefox').hidden = NEEDS_CONSENT;
  // nothing to connect until the person agrees
  $('setupGroup').hidden = !ok;
  document.body.classList.toggle('is-consenting', !ok);
}

async function set(consentAt: string) {
  await patchSettings({ consentAt });
  flashSaved();
  render(consentAt);
  changed();
  // this section sits last on the page; what comes next, connecting ClickUp, appears at the top
  if (consentAt) $('setupGroup').scrollIntoView({ block: 'start' });
}

export function wireConsent(s: Settings, onChange: () => void) {
  changed = onChange;
  const details = $<HTMLDetailsElement>('consentList');
  const label = () => {
    (details.querySelector('summary') as HTMLElement).textContent = details.open ? 'Hide the details' : 'Show what Pointer sends';
  };
  details.addEventListener('toggle', label);
  render(s.consentAt);
  label();
  $('consentAgree').addEventListener('click', () => void set(new Date().toISOString()));
  $('consentWithdraw').addEventListener('click', () => {
    if (window.confirm("Withdraw your OK? Pointer stops sending anything until you agree again. Your settings stay.")) void set('');
  });
}
