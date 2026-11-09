/**
 * Fetches as the page: with the site's own cookies (a staging site's Vercel login included), and
 * with the headers of a same-origin answer readable. Chrome's content scripts fetch that way
 * already; Firefox's need content.fetch.
 */
export const pageFetch: typeof fetch = (() => {
  const page = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  return typeof page?.fetch === 'function' ? page.fetch.bind(page) : fetch.bind(globalThis);
})();
