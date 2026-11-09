/**
 * "Setup code": paste a colleague's code to take on the team's setup, or copy your own to share.
 * What a code holds, and how, is shared/setupcode.ts; this is the page's half.
 */
import { getSettings, patchSettings } from '../background/settings';
import { decodeSetup, describeSetup, encodeSetup, sharedSettings, type SharedSettings } from '../shared/setupcode';
import { $, errMsg, esc, setStatus } from './dom';

/** Set just before the page reloads with a code's settings, so the reloaded page can say so. */
const APPLIED = 'pointer:setup-code-applied';
const COPY_KEYS = navigator.userAgent.includes('Mac') ? 'Cmd+C' : 'Ctrl+C';

let pending: SharedSettings | null = null;
let readSeq = 0;

function showPreview(shared: SharedSettings | null) {
  pending = shared;
  const box = $('setupCodePreview');
  box.hidden = !shared;
  $('setupCodeActions').hidden = !shared;
  if (shared) {
    box.innerHTML = `<b>This code sets</b><ul>${describeSetup(shared).map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <p class="help">Your ClickUp connection stays as it is: a code never holds a token.</p>`;
  }
}

/** Reads the pasted code as soon as it's there; nothing changes until "Use these settings". */
async function read(code: string) {
  const seq = ++readSeq;
  if (!code.trim()) {
    setStatus('setupCodeStatus', '');
    return showPreview(null);
  }
  try {
    const shared = await decodeSetup(code);
    if (seq !== readSeq) return;
    if (!Object.keys(shared).length) throw new Error('This code has no settings in it.');
    setStatus('setupCodeStatus', '');
    showPreview(shared);
  } catch (e) {
    if (seq !== readSeq) return;
    showPreview(null);
    setStatus('setupCodeStatus', errMsg(e), 'bad');
  }
}

/** Saves the code's settings and reloads, so every section shows them. */
async function apply() {
  if (!pending) return;
  await patchSettings(pending);
  try {
    sessionStorage.setItem(APPLIED, '1');
  } catch {
    // only the confirmation line is lost
  }
  location.hash = 'teamGroup';
  location.reload();
}

async function copyCode() {
  const withKey = $<HTMLInputElement>('setupCodeWithKey').checked;
  const code = await encodeSetup(sharedSettings(await getSettings(), withKey));
  const out = $<HTMLTextAreaElement>('setupCodeOut');
  out.value = code;
  out.hidden = false;
  try {
    await navigator.clipboard.writeText(code);
    setStatus('setupCodeCopied', "Copied. Paste it into a colleague's Pointer settings, under Setup code.", 'ok');
  } catch {
    out.focus();
    out.select();
    setStatus('setupCodeCopied', `Couldn't copy it by itself. The code is selected below: press ${COPY_KEYS}.`, 'bad');
  }
}

export function wireTeam() {
  const input = $<HTMLTextAreaElement>('setupCodeIn');
  let timer = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void read(input.value), 250);
  });
  $('setupCodeApply').addEventListener('click', () => void apply());
  $('setupCodeCancel').addEventListener('click', () => {
    input.value = '';
    void read('');
  });

  $('setupCodeCopy').addEventListener('click', () => void copyCode());
  // a code shown for the other choice would be the wrong one
  $('setupCodeWithKey').addEventListener('change', () => {
    $('setupCodeOut').hidden = true;
    setStatus('setupCodeCopied', '');
  });
  $<HTMLTextAreaElement>('setupCodeOut').addEventListener('focus', (e) => (e.target as HTMLTextAreaElement).select());

  let applied = false;
  try {
    applied = sessionStorage.getItem(APPLIED) === '1';
    sessionStorage.removeItem(APPLIED);
  } catch {
    // nothing to confirm
  }
  if (applied) setStatus('setupCodeStatus', "Your team's setup is in. Check the settings below.", 'ok');
}
