/**
 * Languages: the page's own (<html lang>) and its versions in other languages (hreflang links).
 * Both come from the site's list of languages, so a wrong code is wrong on every page.
 */
import { checkLangCode, type LangVerdict } from '../lang';
import { absolute, sameDoc } from '../url';
import type { Check, SeoFinding } from '../types';

type Wrong = Extract<LangVerdict, { ok: false }>;

export const langCheck: Check = ({ page }) => {
  const base = { check: 'lang', category: 'languages', scope: 'site', fixIn: 'code' } as const;
  const lang = page.htmlLang?.trim() ?? '';
  if (!lang)
    return [{ ...base, id: 'lang-missing', severity: 'improve', title: "The page doesn't say what language it's in", detail: '<html> has no lang attribute', why: 'Google, browsers and screen readers use it to know the language, and to offer a translation.', fix: "Set lang on <html>; Next.js does it from the page's locale." }];
  const v = checkLangCode(lang, 'lang');
  if (!v.ok)
    return [
      {
        ...base,
        id: 'lang-invalid',
        severity: 'improve',
        title: v.kind === 'unlikely' ? `lang="${lang}" is probably the wrong language` : `lang="${lang}" isn't a language code`,
        detail: v.problem,
        why: 'Browsers and Google take the page for another language, or none.',
        fix: v.use ? `Use ${v.use} in the site's list of languages.` : "Use a two-letter code in the site's list of languages (hr, en, de).",
      },
    ];
  return [{ ...base, id: 'lang-ok', severity: 'pass', title: `The page is marked as ${v.name}`, detail: `lang="${lang}"` }];
};

/** Language codes Google can't read, or that mean other languages: one finding for all of them. */
function wrongCodes(codes: string[]): SeoFinding | null {
  const bad = codes.flatMap((code) => {
    const v = checkLangCode(code, 'hreflang');
    return v.ok ? [] : [{ code, v: v as Wrong }];
  });
  if (!bad.length) return null;
  const invalid = bad.filter((b) => b.v.kind === 'invalid').map((b) => b.code);
  const unlikely = bad.filter((b) => b.v.kind === 'unlikely').map((b) => b.code);
  const detail = [
    invalid.length ? `${invalid.join(', ')} ${invalid.length === 1 ? "isn't a code" : "aren't codes"} Google knows` : '',
    unlikely.length ? `${unlikely.join(', ')} ${unlikely.length === 1 ? 'means another language' : 'mean other languages'}` : '',
  ].filter(Boolean);
  const uses = bad.flatMap((b) => (b.v.use ? [b.v.use] : []));
  return {
    check: 'hreflang',
    category: 'languages',
    scope: 'site',
    fixIn: 'code',
    id: 'hreflang-codes',
    severity: 'fix',
    title: `${bad.length} language ${bad.length === 1 ? 'code' : 'codes'} Google gets wrong`,
    detail: detail.join(' · '),
    items: bad.map((b) => ({ label: b.code, code: true, note: b.v.problem })),
    why: "Google ignores a version whose code it doesn't know, and shows a version marked with the wrong language to the wrong people.",
    fix: uses.length
      ? `Use ${uses.join(', ')} in the site's list of languages; the same codes go in <html lang>.`
      : "Use codes Google knows (hr, en, de, en-GB) in the site's list of languages.",
  };
}

export const hreflangCheck: Check = ({ page }) => {
  const base = { check: 'hreflang', category: 'languages', scope: 'site', fixIn: 'code' } as const;
  const list = page.alternates.map((a) => ({ ...a, url: a.href?.trim() ? absolute(a.href, page.url) : null }));
  if (!list.length) return [{ ...base, id: 'hreflang-none', severity: 'pass', title: 'No other language versions listed', detail: 'Fine for a site in one language' }];
  const codes = [...new Set(list.map((a) => a.lang))];
  const out: SeoFinding[] = [];
  const codesFinding = wrongCodes(codes);
  if (codesFinding) out.push(codesFinding);

  const missing = list.filter((a) => !a.url);
  if (missing.length)
    out.push({ ...base, id: 'hreflang-no-address', severity: 'improve', title: `${missing.length} language ${missing.length === 1 ? 'version has' : 'versions have'} no address`, items: missing.map((a) => ({ label: a.lang, code: true })), why: 'Google skips a version it has no address for.', fix: "Give every hreflang link its version's full address." });
  const relative = list.filter((a) => a.url && !/^https?:\/\//i.test(a.href?.trim() ?? ''));
  if (relative.length)
    out.push({ ...base, id: 'hreflang-relative', severity: 'improve', title: `${relative.length} language ${relative.length === 1 ? 'version has' : 'versions have'} a relative address`, items: relative.map((a) => ({ label: a.lang, code: true, note: a.href ?? '' })), why: 'Google asks for full addresses in hreflang.', fix: 'Use full addresses, with https:// and the domain.' });

  const byLang = new Map<string, Set<string>>();
  for (const a of list) if (a.url) byLang.set(a.lang.toLowerCase(), (byLang.get(a.lang.toLowerCase()) ?? new Set()).add(a.url.href));
  const twice = [...byLang].filter(([, urls]) => urls.size > 1);
  if (twice.length)
    out.push({ ...base, id: 'hreflang-duplicate', severity: 'improve', title: `${twice.length} ${twice.length === 1 ? 'language is' : 'languages are'} listed twice, with different addresses`, items: twice.map(([lang, urls]) => ({ label: lang, code: true, note: [...urls].join(' and ') })), why: "Google can't tell which address is that language's version.", fix: 'List each language once.' });

  const here = new URL(page.url);
  const self = list.find((a) => a.url && a.lang.toLowerCase() !== 'x-default' && sameDoc(a.url, here, page.environment));
  if (!self)
    out.push({ ...base, scope: 'page', id: 'hreflang-self', severity: 'improve', title: "This page isn't in its own list of languages", detail: `${list.length} versions listed, none at this address`, why: 'Each version has to list itself as well as the others, or Google may not trust the list.', fix: "Include the page's own address, with its language, in the hreflang list." });
  else if (page.htmlLang && self.lang.split('-')[0]?.toLowerCase() !== page.htmlLang.split('-')[0]?.toLowerCase())
    out.push({ ...base, scope: 'page', id: 'hreflang-lang', severity: 'notice', title: `Listed as ${self.lang}, but <html lang> says ${page.htmlLang}`, why: 'The two should agree on what language the page is in.', fix: 'Use the same code in both.' });
  if (list.length > 1 && !list.some((a) => a.lang.toLowerCase() === 'x-default'))
    out.push({ ...base, id: 'hreflang-default', severity: 'notice', title: 'No x-default version', why: "x-default is the version Google shows people whose language isn't listed.", fix: 'Add hreflang="x-default" pointing at the main version.' });

  if (out.length) return out;
  const real = codes.filter((c) => c.toLowerCase() !== 'x-default');
  return [{ ...base, id: 'hreflang-ok', severity: 'pass', title: `${real.length} language ${real.length === 1 ? 'version' : 'versions'}, all listed right`, detail: real.join(', ') }];
};
