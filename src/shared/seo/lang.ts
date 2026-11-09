/**
 * Language codes, as hreflang and <html lang> use them. Google reads hreflang as a two-letter
 * ISO 639-1 language, then optionally a script and an ISO 3166-1 country: "en", "en-GB",
 * "zh-Hant". Which codes exist comes from the browser's own language data (Intl), so there is no
 * table of them here; only the usual mix-ups are listed: country codes written as languages
 * (cz, dk), and real codes for languages a site is unlikely to have (se is Northern Sami).
 */

const languages = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const scripts = new Intl.DisplayNames(['en'], { type: 'script', fallback: 'none' });

/** Country codes written as language codes, and the language code meant. */
const COUNTRY_AS_LANGUAGE: Record<string, string> = {
  cz: 'cs',
  dk: 'da',
  gr: 'el',
  jp: 'ja',
  cn: 'zh',
  ua: 'uk',
  rs: 'sr',
  al: 'sq',
  il: 'he',
  vn: 'vi',
  by: 'be',
  at: 'de-AT',
  us: 'en-US',
  gb: 'en-GB',
  mx: 'es-MX',
  me: 'sr-ME',
};

/** Real codes for languages these sites are unlikely to have, and the one probably meant. */
const LIKELY_MEANT: Record<string, string> = { se: 'sv', si: 'sl', ee: 'et', ba: 'bs', br: 'pt-BR', ch: 'de-CH', ie: 'en-IE', kr: 'ko' };

/** Region codes that aren't one country: the EU, the UN, "unknown", and the private-use ranges. */
const NOT_A_COUNTRY = /^(?:EU|EZ|UN|QO|ZZ|AA|Q[M-Z]|X[A-JL-Z])$/;

const name = (names: Intl.DisplayNames, code: string): string | undefined => {
  try {
    return names.of(code);
  } catch {
    return undefined;
  }
};

const canonical = (code: string): string | null => {
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
};

/** "Croatian" for hr; the code itself when the browser doesn't know it. */
export const languageName = (code: string): string => name(languages, code) ?? code;

export type LangVerdict =
  | { ok: true; name: string }
  /** `unlikely`: a real code, for a language the site almost certainly doesn't mean. */
  | { ok: false; kind: 'invalid' | 'unlikely'; problem: string; use?: string };

const invalid = (problem: string, use?: string): LangVerdict => ({ ok: false, kind: 'invalid', problem, ...(use ? { use } : {}) });

/** Whether Google (and browsers) can read a language code, and what's wrong with it if not. */
export function checkLangCode(code: string, use: 'hreflang' | 'lang'): LangVerdict {
  const raw = code.trim();
  if (use === 'hreflang' && raw.toLowerCase() === 'x-default') return { ok: true, name: 'every other language' };
  if (!raw) return invalid('empty');
  if (raw.includes('_')) return invalid(`needs a hyphen: ${raw.replace(/_/g, '-')}`, raw.replace(/_/g, '-'));
  const parts = raw.split('-');
  const primary = (parts[0] ?? '').toLowerCase();
  const country = COUNTRY_AS_LANGUAGE[primary];
  if (country) return invalid(`a country code; ${languageName(country)} is ${country}`, country);
  const canon = canonical(raw);
  if (!canon) return invalid('not a language code');
  const canonPrimary = canon.split('-')[0] ?? '';
  if (primary.length !== 2) {
    if (canonPrimary.length === 2) return invalid(`Google wants two letters: ${canonPrimary}`, canonPrimary);
    if (use === 'hreflang' || !name(languages, primary)) return invalid('not a two-letter language code');
  } else if (canonPrimary !== primary && canonPrimary.length === 2) {
    return invalid(`an old code; ${languageName(canonPrimary)} is ${canonPrimary}`, canonPrimary);
  }
  const language = name(languages, primary);
  if (!language) return invalid('not a language code');

  // then an optional script ("Hant"), and an optional country ("GB")
  let rest = parts.slice(1);
  if (rest[0]?.length === 4) {
    if (!name(scripts, rest[0])) return invalid(`${rest[0]} isn't a script`);
    rest = rest.slice(1);
  }
  const region = rest[0]?.toUpperCase();
  if (region !== undefined) {
    if (/^\d{3}$/.test(region)) {
      if (use === 'hreflang') return invalid(`Google doesn't read ${region}; use a country code, or none`, primary);
    } else if (region.length !== 2 || !/^[A-Z]+$/.test(region)) {
      return invalid(`${rest[0]} isn't a country code`);
    } else if (region === 'UK') {
      return invalid('the UK is GB', `${primary}-GB`);
    } else if (NOT_A_COUNTRY.test(region)) {
      return invalid(`${region} isn't a country`, primary);
    } else {
      const now = canonical(`und-${region}`)?.split('-')[1];
      if (now && now !== region) return invalid(`an old country code; it's ${now} now`, `${primary}-${now}`);
      if (!name(regions, region)) return invalid(`${region} isn't a country code`);
      if (primary === 'es' && region === 'LA') return { ok: false, kind: 'unlikely', problem: 'LA is Laos, not Latin America', use: 'es' };
    }
    rest = rest.slice(1);
  }
  if (rest.length && use === 'hreflang') return invalid('Google reads only a language, a script and a country');

  const meant = LIKELY_MEANT[primary];
  if (meant) return { ok: false, kind: 'unlikely', problem: `${language}; ${languageName(meant)} is ${meant}`, use: meant };
  return { ok: true, name: languageName(raw) };
}
