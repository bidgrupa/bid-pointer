/**
 * Addresses and answers as the SEO checks compare them. A staging page and its live address are
 * the same page when their paths match; on a live site the domain has to match too (with or
 * without www).
 */
import { normalizePath } from '../match';
import type { Environment } from '../site';

export const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** An address resolved against the page; null when it isn't one. */
export function absolute(href: string, base: string): URL | null {
  try {
    return new URL(href.trim(), base);
  } catch {
    return null;
  }
}

/** A path as pages are compared: decoded, lower case, no trailing slash. */
export const pathKey = (u: URL): string => normalizePath(safeDecode(u.pathname));

/** A domain without "www.", so www.cresanka.hr and cresanka.hr count as one site. */
export const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The same page: the same path, and on a live site the same domain. */
export const sameDoc = (a: URL, b: URL, environment: Environment): boolean =>
  pathKey(a) === pathKey(b) && (environment !== 'production' || bareHost(a.host) === bareHost(b.host));

/** A home page: "/", or a language's own ("/en", "/de-at"). */
export const isHome = (path: string): boolean => /^\/(?:[a-z]{2}(?:-[a-z]{2})?)?\/?$/i.test(path);

/** "/rooms/superior" on the same domain as `from`, the domain and path elsewhere; for showing. */
export function shortUrl(u: URL, from?: URL): string {
  const path = safeDecode(u.pathname) + safeDecode(u.search);
  if (from && u.host === from.host) return path;
  return `${bareHost(u.host)}${path === '/' ? '' : path}`;
}

/** An image's file name from its address, with Next.js's optimizer (/_next/image?url=…) unwrapped. */
export function fileName(src: string): string {
  const u = absolute(src, 'https://page.invalid/');
  if (!u) return src.slice(0, 60);
  if (u.protocol === 'data:') return 'embedded image';
  const inner = u.pathname.endsWith('/_next/image') ? u.searchParams.get('url') : null;
  const file = (inner && absolute(inner, u.origin)) || u;
  const last = safeDecode(file.pathname.split('/').filter(Boolean).at(-1) ?? '') || file.host;
  return last.length > 60 ? `${last.slice(0, 57)}…` : last;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** "404 Not Found". */
export const statusLine = (status: number): string => `${status}${STATUS_TEXT[status] ? ` ${STATUS_TEXT[status]}` : ''}`;

/** Vercel's login in front of a protected deployment: a 401 or 403, or a redirect to vercel.com. */
export function behindLogin(answer: { status: number; finalUrl: string }): boolean {
  if (answer.status === 401 || answer.status === 403) return true;
  const u = absolute(answer.finalUrl, 'https://page.invalid/');
  return Boolean(u && /(^|\.)vercel\.com$/i.test(u.hostname));
}
