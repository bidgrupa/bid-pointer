/** Styles and fonts for Pointer's shadow-root UI, on bid sites and in Gmail alike. */

const FONT_FILES = [
  ['Regular', '400'],
  ['Medium', '500'],
  ['Semibold', '600'],
  ['Bold', '700'],
] as const;

/**
 * Gilroy for the shadow UI. The FontFace API needs no <style> tag, so a strict style-src
 * CSP on the site can't block it. If the site's font-src blocks extension fonts, the
 * stack falls back to system-ui.
 */
export function installFonts() {
  for (const [file, weight] of FONT_FILES) {
    try {
      const url = chrome.runtime.getURL(`fonts/Gilroy-${file}.otf`);
      const face = new FontFace('Pointer Gilroy', `url("${url}") format("opentype")`, { weight, display: 'swap' });
      document.fonts.add(face);
      face.load().catch(() => {});
    } catch {
      // a browser that won't take fonts from an extension script still gets system-ui
    }
  }
}

/** Constructed stylesheets are immune to a site's style-src CSP. A <style> element is the fallback. */
export function adoptStyles(root: ShadowRoot, text: string) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = text;
    root.prepend(style);
  }
}
