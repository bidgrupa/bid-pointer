/**
 * "Projects": the ClickUp space Pointer's projects come from, picked from the workspaces the
 * token can see. A space's folders and folderless lists are the projects.
 */
import { fetchSpaces, type SpaceRef } from '../background/clickup';
import { getProjects } from '../background/projects';
import { getSettings, patchSettings } from '../background/settings';
import { $, errMsg, flashSaved, setStatus } from './dom';

let spaces: SpaceRef[] | null = null;
let changed: () => void = () => {};

const option = (value: string, text: string) => {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
};

export async function renderSpace() {
  const s = await getSettings();
  const select = $<HTMLSelectElement>('spaceId');
  const known = Boolean(spaces?.some((x) => x.spaceId === s.spaceId));
  $('spaceGroup').classList.toggle('is-needed', Boolean(s.clickupToken) && !s.spaceId);
  if (!s.clickupToken || !spaces) {
    const text = !s.clickupToken ? 'Connect ClickUp first' : s.spaceName || (s.spaceId ? `Space ${s.spaceId}` : 'Loading your spaces…');
    select.replaceChildren(option(s.spaceId, text));
    select.disabled = true;
    return;
  }
  const first = known ? [] : [option('', s.spaceId ? `${s.spaceName || `Space ${s.spaceId}`} (no longer there)` : 'Choose a space')];
  select.replaceChildren(...first, ...spaces.map((x) => option(x.spaceId, x.label)));
  select.value = known ? s.spaceId : '';
  select.disabled = false;
}

async function choose(space: SpaceRef) {
  await patchSettings({ spaceId: space.spaceId, spaceName: space.label });
  flashSaved();
  changed();
  void countProjects();
}

/** "12 projects in this space", so a wrong pick shows at once. */
async function countProjects() {
  const { clickupToken, spaceId } = await getSettings();
  if (!clickupToken || !spaceId) return setStatus('spaceStatus', '');
  setStatus('spaceStatus', 'Reading the projects…');
  try {
    const n = (await getProjects(clickupToken, spaceId, true)).length;
    setStatus('spaceStatus', n ? `${n} ${n === 1 ? 'project' : 'projects'} in this space.` : "This space has no folders or lists yet, so there's nowhere to put tasks.", n ? 'ok' : 'bad');
  } catch (e) {
    setStatus('spaceStatus', `ClickUp couldn't read this space: ${errMsg(e)}`, 'bad');
  }
}

/** Asks ClickUp for the token's spaces; with exactly one, there's nothing to choose. */
export async function loadSpaces() {
  const { clickupToken, spaceId } = await getSettings();
  spaces = null;
  if (!clickupToken) {
    setStatus('spaceStatus', '');
    return renderSpace();
  }
  await renderSpace();
  try {
    spaces = await fetchSpaces(clickupToken);
    setStatus('spaceStatus', spaces.length ? '' : 'This token sees no spaces in ClickUp.', spaces.length ? '' : 'bad');
    const only = spaces.length === 1 ? spaces[0] : undefined;
    if (!spaceId && only) await choose(only);
    else if (spaceId) void countProjects();
  } catch (e) {
    spaces = [];
    setStatus('spaceStatus', `Couldn't load your spaces: ${errMsg(e)}`, 'bad');
  }
  await renderSpace();
}

export function wireSpace(onChange: () => void) {
  changed = onChange;
  const select = $<HTMLSelectElement>('spaceId');
  select.addEventListener('change', async () => {
    const space = spaces?.find((x) => x.spaceId === select.value);
    if (space) await choose(space);
    await renderSpace();
  });
}
