import { fetchMembers, whoAmI } from '../background/clickup';
import { listPageTasks } from '../background/pagetasks';
import { getSettings, patchSettings } from '../background/settings';
import { assigneeOptionsHtml } from '../content/view';
import { formatDate } from '../shared/format';
import { browserLabel } from '../shared/page';
import type { ClickUpUser, Member, MembersResponse, Msg, RecentTask, Settings } from '../shared/types';
import { wireConsent } from './consent';
import { $, bindField, errMsg, esc, flashSaved, setStatus } from './dom';
import { wireRewrite } from './rewrite';
import { wireSites } from './sites';
import { loadSpaces, renderSpace, wireSpace } from './space';
import { wireTeam } from './team';


// ---------- Connect ClickUp ----------

/** Shows the setup walkthrough, or the "Connected" panel once ClickUp has accepted the token. */
function showConnected(user: ClickUpUser | null) {
  $('setupSteps').hidden = Boolean(user);
  $('tokenFaq').hidden = Boolean(user);
  $('setupDone').hidden = !user;
  if (user) {
    $('setupWho').textContent = `${user.username} (${user.email})`;
    savedShown = false;
    renderSavedToken();
    document.body.classList.remove('is-first-run'); // the rest of the settings can appear now
  }
}

// ---------- Showing and hiding the token ----------

const ICON = {
  eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.75 10S5 4.25 10 4.25 18.25 10 18.25 10 15 15.75 10 15.75 1.75 10 1.75 10z"/><circle cx="10" cy="10" r="2.75"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.2 4.45A8 8 0 0 1 10 4.25C15 4.25 18.25 10 18.25 10a14 14 0 0 1-2.3 3M5.6 5.6C3.1 7.2 1.75 10 1.75 10S5 15.75 10 15.75a8.2 8.2 0 0 0 4.4-1.35M8.05 8.05a2.75 2.75 0 0 0 3.9 3.9M2.5 2.5l15 15"/></svg>',
  copy: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.75" y="6.75" width="10" height="10" rx="2"/><path d="M13.25 6.75V5a1.75 1.75 0 0 0-1.75-1.75H5A1.75 1.75 0 0 0 3.25 5v6.5A1.75 1.75 0 0 0 5 13.25h1.75"/></svg>',
  check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8.5"/></svg>',
};

/** The token ClickUp accepted, for the "Connected" panel. */
let savedToken = '';
let savedShown = false;

/** Hidden form: keeps the pk_ prefix and the last four characters so you can tell tokens apart. */
const maskToken = (token: string) => {
  if (token.length <= 8) return '•'.repeat(token.length);
  const prefix = token.startsWith('pk_') ? 'pk_' : '';
  return `${prefix}${'•'.repeat(12)}${token.slice(-4)}`;
};

function setRevealButton(btn: HTMLElement, shown: boolean) {
  const label = shown ? 'Hide token' : 'Show token';
  btn.innerHTML = shown ? ICON.eyeOff : ICON.eye;
  btn.setAttribute('aria-pressed', String(shown));
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function renderSavedToken() {
  $('tokenValue').textContent = savedShown ? savedToken : maskToken(savedToken);
  setRevealButton($('revealSaved'), savedShown);
}

function wireReveal() {
  const input = $<HTMLInputElement>('clickupToken');
  const revealInput = $('revealInput');
  const setInputShown = (shown: boolean) => {
    input.type = shown ? 'text' : 'password';
    setRevealButton(revealInput, shown);
  };
  setInputShown(false);
  revealInput.addEventListener('click', () => {
    setInputShown(input.type === 'password');
    input.focus();
  });

  $('revealSaved').addEventListener('click', () => {
    savedShown = !savedShown;
    renderSavedToken();
  });

  const copy = $('copyToken');
  copy.innerHTML = ICON.copy;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(savedToken);
      copy.innerHTML = ICON.check;
      copy.classList.add('is-done');
      copy.title = 'Copied';
    } catch {
      copy.title = "Couldn't copy. Show the token and copy it by hand.";
    }
    window.setTimeout(() => {
      copy.innerHTML = ICON.copy;
      copy.classList.remove('is-done');
      copy.title = 'Copy token';
    }, 1500);
  });

  // Never leave the token on screen in a tab that's in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    setInputShown(false);
    savedShown = false;
    renderSavedToken();
  });
}

type Step = 'open' | 'copy' | 'paste';
const STEP_ORDER: Step[] = ['open', 'copy', 'paste'];

/** Marks the steps before `current` as done and `current` as the one to do next. */
function setStep(current: Step) {
  const at = STEP_ORDER.indexOf(current);
  document.querySelectorAll<HTMLElement>('#setupSteps .step').forEach((li) => {
    const i = STEP_ORDER.indexOf(li.dataset.step as Step);
    li.classList.toggle('is-done', i < at);
    li.classList.toggle('is-current', i === at);
  });
}

const PASTE_KEYS = navigator.userAgent.includes('Mac') ? 'Cmd+V' : 'Ctrl+V';

let checkSeq = 0;

/** Saves the pasted token and checks it with ClickUp straight away; there is no button to press. */
async function connect(raw: string) {
  const token = raw.trim();
  const seq = ++checkSeq;
  savedToken = token;
  await patchSettings({ clickupToken: token, clickupUser: null });
  members = null;
  void renderAssignee();
  if (!token) return setStatus('tokenStatus', '');
  setStatus('tokenStatus', 'Checking with ClickUp…');
  try {
    const user = await whoAmI(token);
    if (seq !== checkSeq) return;
    await patchSettings({ clickupUser: user });
    setStatus('tokenStatus', '');
    showConnected(user);
    flashSaved();
    void loadMembers();
    void loadSpaces();
    void renderNext();
  } catch (e) {
    if (seq !== checkSeq) return;
    let message: string;
    if (!token.startsWith('pk_')) message = "That isn't a ClickUp token. Personal tokens start with pk_.";
    else if (e instanceof TypeError) message = "Couldn't reach ClickUp to check the token. It's saved, so reopen this page to check again.";
    else if (/^ClickUp 401/.test(errMsg(e))) message = "ClickUp didn't accept this token. Copy it again and paste the whole thing.";
    else message = `ClickUp couldn't check this token (${errMsg(e)}). Try again in a moment.`;
    setStatus('tokenStatus', message, 'bad');
  }
}

function wireToken(s: Settings) {
  const input = $<HTMLInputElement>('clickupToken');
  input.value = s.clickupToken;
  savedToken = s.clickupToken;
  wireReveal();
  let timer = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void connect(input.value), 400);
  });
  input.addEventListener('focus', () => setStep('paste'));

  // Step 1 opens ClickUp in a new tab. Coming back to this tab means the token is probably
  // copied, so jump to step 3 with the field ready for pasting.
  let awayInClickUp = false;
  $('openClickUp').addEventListener('click', () => {
    awayInClickUp = true;
    setStep('copy');
  });
  const welcomeBack = () => {
    if (!awayInClickUp || document.visibilityState !== 'visible' || !$('setupDone').hidden) return;
    awayInClickUp = false;
    setStep('paste');
    input.focus();
    if (!input.value) setStatus('tokenStatus', `Press ${PASTE_KEYS} to paste your token.`);
  };
  window.addEventListener('focus', welcomeBack);
  document.addEventListener('visibilitychange', welcomeBack);

  $('changeToken').addEventListener('click', () => {
    showConnected(null);
    setStep('paste');
    input.focus();
    input.select();
  });

  if (s.clickupToken && s.clickupUser) showConnected(s.clickupUser);
  else {
    document.body.classList.add('is-first-run');
    showConnected(null);
    if (s.clickupToken) {
      setStep('paste');
      void connect(s.clickupToken); // saved earlier but never confirmed
    }
  }
}

// ---------- Default assignee ----------

let members: MembersResponse | null = null;

/** The default-assignee dropdown: the current default, "No one", then the rest of the workspace. */
async function renderAssignee() {
  const s = await getSettings();
  const select = $<HTMLSelectElement>('defaultAssignee');
  const current: Member | null = Number(s.assigneeId) > 0 ? { id: Number(s.assigneeId), name: s.assigneeName || `User ${s.assigneeId}` } : null;
  select.innerHTML = assigneeOptionsHtml({ selectedId: current ? String(current.id) : '', defaultAssignee: current, members });
  select.disabled = !s.clickupToken;
  $('assigneeHelp').textContent = s.clickupToken ? '' : 'Connect ClickUp first to choose from your team.';
}

async function loadMembers() {
  const { clickupToken } = await getSettings();
  if (clickupToken) {
    try {
      members = { members: await fetchMembers(clickupToken) };
    } catch (e) {
      members = { members: [], error: errMsg(e) };
    }
  }
  await renderAssignee();
}

function wireAssignee() {
  const select = $<HTMLSelectElement>('defaultAssignee');
  select.addEventListener('change', async () => {
    const id = select.value;
    const name = members?.members.find((m) => String(m.id) === id)?.name ?? select.selectedOptions[0]?.textContent ?? '';
    await patchSettings({ assigneeId: id, assigneeName: id ? name : '' });
    flashSaved();
    await renderAssignee(); // the "Default" group moves to the new choice
  });
}

// ---------- Shortcut ----------

const IS_EDGE = navigator.userAgent.includes('Edg/');
const IS_FIREFOX = navigator.userAgent.includes('Firefox/');
const IS_SAFARI = browserLabel(navigator.userAgent).startsWith('Safari');

/** Shows the shortcut the browser actually has bound, which people can change and older installs may still have. */
async function renderShortcut() {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'toggle-point-mode')?.shortcut ?? '';
  $('shortcutKeys').innerHTML = shortcut
    ? shortcut
        .split('+')
        .map((k) => `<kbd>${esc(k)}</kbd>`)
        .join('')
    : '<span class="help">None set. Click Pointer on the page instead, or set one below.</span>';
  // the old default; Edge opens Copilot on it, so Pointer may never see the keypress
  const old = /^Ctrl\+Shift\+(\.|Period)$/i.test(shortcut);
  $('shortcutWarning').textContent = old ? 'Edge also uses this shortcut, for Copilot. Change it to Alt+Shift+P.' : '';
}

function wireShortcut() {
  // Firefox (and Zen) can open their own shortcut page; extensions can't link to about:addons.
  const commands = chrome.commands as typeof chrome.commands & { openShortcutSettings?: () => Promise<void> };
  $('changeShortcut').addEventListener('click', () => {
    if (commands.openShortcutSettings) void commands.openShortcutSettings();
    else void chrome.tabs.create({ url: IS_EDGE ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
  });
  if (IS_FIREFOX && !commands.openShortcutSettings) {
    $('shortcutHelp').textContent = 'In Firefox, open about:addons, click the gear, then Manage Extension Shortcuts.';
  }
  // Safari has no page for changing an extension's shortcut
  if (IS_SAFARI && !commands.openShortcutSettings) {
    $('changeShortcut').hidden = true;
    $('shortcutHelp').textContent = "Safari doesn't let you change it. If it clashes with something, click Pointer on the page instead.";
  }
  // coming back from the shortcut settings: show what was picked
  window.addEventListener('focus', () => void renderShortcut());
}

// ---------- Site access ----------

const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

/** Chrome always grants it at install; Firefox does too, but lets people switch it off later. */
async function renderAccess() {
  const granted = await chrome.permissions.contains(ALL_SITES).catch(() => true);
  $('accessGroup').hidden = granted;
}

function wireAccess() {
  $('grantAccess').addEventListener('click', async () => {
    try {
      const granted = await chrome.permissions.request(ALL_SITES);
      setStatus('accessStatus', granted ? '' : "Access wasn't granted. Pointer stays off until it is.", granted ? '' : 'bad');
    } catch (e) {
      setStatus('accessStatus', errMsg(e), 'bad');
    }
    await renderAccess();
  });
  window.addEventListener('focus', () => void renderAccess());
}

// ---------- Lists ----------

function renderHostProjects(s: Settings) {
  const entries = Object.entries(s.hostProjects);
  const box = $('hostProjects');
  if (!entries.length) {
    box.innerHTML = '<p class="empty">No sites yet. The first task you create on a site remembers its project.</p>';
    return;
  }
  box.innerHTML = `<ul class="rows">${entries
    .map(
      ([key, p]) => `<li>
        <div class="row-main"><code>${esc(key)}</code><span>${esc(p.label)}</span></div>
        <button class="btn btn--small" type="button" data-forget="${esc(key)}">Forget</button>
      </li>`,
    )
    .join('')}</ul>`;
  box.querySelectorAll<HTMLButtonElement>('button[data-forget]').forEach((b) =>
    b.addEventListener('click', async () => {
      const cur = await getSettings();
      const next = { ...cur.hostProjects };
      delete next[b.dataset.forget ?? ''];
      renderHostProjects(await patchSettings({ hostProjects: next }));
      flashSaved();
    }),
  );
}

// ---------- Page tasks waiting ----------

async function renderPageTasks() {
  const tasks = await listPageTasks();
  $('pageTasksGroup').hidden = tasks.length === 0;
  const box = $('pageTasks');
  box.innerHTML = `<ul class="rows">${tasks
    .map(
      (t) => `<li>
        <div class="row-main"><a href="${esc(t.page.url)}" target="_blank" rel="noopener"><code>${esc(t.key)}</code></a><span>${t.items.length} ${t.items.length === 1 ? 'note' : 'notes'}${t.project ? ` · ${esc(t.project.label)}` : ''}</span></div>
        <button class="btn btn--small" type="button" data-discard="${esc(t.key)}">Discard</button>
      </li>`,
    )
    .join('')}</ul>`;
  box.querySelectorAll<HTMLButtonElement>('button[data-discard]').forEach((b) =>
    b.addEventListener('click', async () => {
      const n = tasks.find((t) => t.key === b.dataset.discard)?.items.length ?? 0;
      if (!window.confirm(`Discard ${n} ${n === 1 ? 'note' : 'notes'} for ${b.dataset.discard}? They can't be brought back.`)) return;
      // through the background, which owns page tasks, so it can't race a note being added
      await chrome.runtime.sendMessage({ type: 'pointer:page-discard', key: b.dataset.discard ?? '' } satisfies Msg);
      await renderPageTasks();
      flashSaved();
    }),
  );
}

/** Tasks saved before screenshot tracking existed have no `screenshot` field; show nothing for those. */
function screenshotTag(t: RecentTask): string {
  if (t.seo) return `<span class="tag is-ok">SEO check · ${t.seo.findings} ${t.seo.findings === 1 ? 'finding' : 'findings'}</span>`;
  if (t.email) {
    const files = t.email.files ? `<span class="tag is-ok">${t.email.files} ${t.email.files === 1 ? 'file' : 'files'} attached</span>` : '';
    const missing = t.email.missing ? `<span class="tag is-bad">${t.email.missing} ${t.email.missing === 1 ? 'file' : 'files'} missing</span>` : '';
    return `<span class="tag is-ok">From ${t.email.app === 'HubSpot' ? 'HubSpot' : 'Gmail'}</span>${files}${missing}`;
  }
  const video = t.video === undefined ? '' : t.video ? '<span class="tag is-ok">Recording attached</span>' : '<span class="tag is-bad">Recording missing</span>';
  if (t.commentId) return `<span class="tag is-ok">Comment</span>${t.screenshot ? '' : '<span class="tag is-bad">Screenshot missing</span>'}${video}`;
  if (typeof t.screenshot !== 'boolean') return video;
  // a note with a recording goes without a screenshot, on purpose
  if (!t.screenshot && t.video !== undefined && !t.screenshotError) return video;
  return `${t.screenshot ? '<span class="tag is-ok">Screenshot attached</span>' : '<span class="tag is-bad">Screenshot missing</span>'}${video}`;
}

function renderRecent(s: Settings) {
  const box = $('recent');
  if (!s.recent.length) {
    box.innerHTML = '<p class="empty">No tasks yet. Tasks you create with Pointer show up here.</p>';
    return;
  }
  box.innerHTML = `<ul class="tasks">${s.recent
    .map(
      (t) => `<li>
        <a class="task-title" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>
        <div class="task-meta"><span>${esc(t.projectLabel)}</span><span>${formatDate(new Date(t.createdAt))}</span>${screenshotTag(t)}</div>
        ${t.screenshot === false && t.screenshotError ? `<p class="task-error">${esc(t.screenshotError)}</p>` : ''}
        ${t.video === false && t.videoError ? `<p class="task-error">${esc(t.videoError)}</p>` : ''}
        ${t.email?.error ? `<p class="task-error">${esc(t.email.error)}</p>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}

// ---------- What's left to set up ----------

/** The line under "Connected as": what to do next, or that it's all set. */
async function renderNext() {
  const s = await getSettings();
  $('setupNext').textContent = s.spaceId
    ? "You're all set. Open one of your sites, or click Pointer's toolbar button on any page, then click Pointer in the bottom-right corner."
    : "One more step: paste your team's setup code below, or choose the ClickUp space your projects are in.";
}

async function main() {
  await Promise.all([
    bindField('codingAgent', 'checkbox'),
    bindField('reviewBeforeSend', 'checkbox'),
    bindField('pageTask', 'checkbox'),
    bindField('commentMode', 'checkbox'),
    bindField('seoCheck', 'checkbox'),
    wireRewrite(),
    wireSites(),
  ]);
  const s = await getSettings();
  wireConsent(s, () => void renderNext());
  wireSpace(() => void renderNext());
  wireTeam();
  wireAssignee();
  await renderAssignee();
  wireToken(s);
  if (s.clickupToken && s.clickupUser) {
    void loadMembers();
    void loadSpaces();
  } else void renderSpace();
  void renderNext();
  wireShortcut();
  void renderShortcut();
  wireAccess();
  void renderAccess();
  renderHostProjects(s);
  renderRecent(s);
  void renderPageTasks();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.pageTasks) void renderPageTasks();
    if (changes.settings?.newValue) renderRecent(changes.settings.newValue as Settings);
  });
}

void main();
