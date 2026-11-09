/**
 * Whether an address answers, and where it ends up: a HEAD request, or a GET for servers that
 * refuse HEAD (its body isn't read). Takes the fetch to use: the page's own for links on its site,
 * the background's for others.
 */
import type { Failed, SeoAccess } from './types';

/** A file fetched as text: its status, type, and text (empty unless it answered 2xx). */
export type SeoFetched = { status: number; type: string; text: string } | Failed;

export const failure = (e: unknown): Failed => ({
  error: e instanceof Error && e.name === 'AbortError' ? 'timed out' : e instanceof TypeError ? 'no answer' : e instanceof Error ? e.message : String(e),
});

export async function probeLink(doFetch: typeof fetch, url: string, timeoutMs = 10_000): Promise<SeoAccess | Failed> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const ask = (method: 'HEAD' | 'GET') => doFetch(url, { method, signal: ac.signal, redirect: 'follow', cache: 'no-store' });
  try {
    let res = await ask('HEAD');
    if (res.status === 405 || res.status === 501) {
      res = await ask('GET');
      res.body?.cancel().catch(() => {});
    }
    return { status: res.status, finalUrl: res.url || url };
  } catch (e) {
    return failure(e);
  } finally {
    clearTimeout(timer);
  }
}
