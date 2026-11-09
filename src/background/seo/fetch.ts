/**
 * Fetches for the SEO check that the page can't make itself, because they leave its site: the live
 * site's sitemap seen from staging, links to other sites, and the page as a stranger gets it (no
 * cookies), which tells whether staging is behind Vercel's login. Web addresses only, with size
 * and time limits.
 */
import { failure, type Failed, type SeoAccess, type SeoFetched } from '../../shared/seo';

const MAX_TEXT = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const isWeb = (url: string) => /^https?:\/\//i.test(url);

async function timed<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** A text file, up to 10 MB; its text only when it answered 2xx. */
export async function fetchText(url: string): Promise<SeoFetched> {
  if (!isWeb(url)) return { error: 'not a web address' };
  try {
    return await timed(async (signal) => {
      const res = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
      const type = res.headers.get('content-type') ?? '';
      if (Number(res.headers.get('content-length')) > MAX_TEXT) return { error: 'larger than 10 MB' };
      const text = res.ok ? await res.text() : '';
      if (text.length > MAX_TEXT) return { error: 'larger than 10 MB' };
      return { status: res.status, type, text };
    });
  } catch (e) {
    return failure(e);
  }
}

/** The page without cookies: what a stranger, or Google, gets, and where it ends up. */
export async function fetchAccess(url: string): Promise<SeoAccess | Failed> {
  if (!isWeb(url)) return { error: 'not a web address' };
  try {
    return await timed(async (signal) => {
      const res = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
      res.body?.cancel().catch(() => {});
      return { status: res.status, finalUrl: res.url || url };
    });
  } catch (e) {
    return failure(e);
  }
}
