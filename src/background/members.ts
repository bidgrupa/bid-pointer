import { fetchMembers } from './clickup';
import type { Member } from '../shared/types';

const TTL = 10 * 60 * 1000;

let cache: { at: number; token: string; list: Member[] } | null = null;

/** Workspace members for the assignee pickers, cached like the project list. */
export async function getMembers(token: string, force = false): Promise<Member[]> {
  if (!force && cache && cache.token === token && Date.now() - cache.at < TTL) return cache.list;
  const list = await fetchMembers(token);
  cache = { at: Date.now(), token, list };
  return list;
}
