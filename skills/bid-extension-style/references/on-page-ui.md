# On-page UI: drawing on other people's websites

Content-script UI sits on top of sites that have their own CSS, fonts, z-indexes, keyboard
shortcuts, Content Security Policy and frameworks re-rendering the DOM. Pointer's on-page UI
survives all of that with the techniques below; `assets/overlay.css` holds the styles. Everything
here works in Chrome, Edge and Firefox.

## Contents

1. Mount in a shadow root
2. Get the CSS in as text (bundler, or none)
3. Fonts through the FontFace API
4. Markup for each component
5. Layering and placement
6. Events and keys
7. Screenshots
8. Firefox notes
9. Only where it's wanted
10. Previewing outside the extension
11. Component map

## 1. Mount in a shadow root

```js
const host = document.createElement('div');
host.id = 'linkr-ui';                        // the extension's own id
host.style.setProperty('all', 'initial');    // through the CSSOM: a site's CSP can't block it
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = SHELL;                      // the extension's fixed skeleton (section 4)
adoptStyles(root, css);
document.documentElement.appendChild(host);  // <html>, not <body>: some sites replace <body>
```

- The site's selectors can't reach inside the shadow root, and the shadow root's styles can't
  leak out, so the overlay neither breaks the site nor gets broken by it. `overlay.css` also sets
  `:host { all: initial }`.
- `tokens.css` declares its variables on `:host` as well as `:root` for exactly this.
- Escape every value interpolated into `innerHTML` (page titles, names from APIs). A five-entity
  `esc()` for `& < > " '` is enough.

## 2. Get the CSS in as text

```js
/** Constructed stylesheets are immune to a site's style-src CSP. A <style> element is the fallback. */
function adoptStyles(root, text) {
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
```

`replaceSync` **ignores `@import`**, so the four files must reach it as one text with the imports
resolved.

**With a bundler**, let it inline them: esbuild (`bundle: true` on the CSS, then load the output
with the `text` loader; Pointer does this), Vite (`import css from './overlay.css?inline'`),
webpack (`css-loader` with `exportType: 'string'`).

**Without a bundler**, fetch the files from the extension at runtime and join them, so there's no
hand-made bundle to fall out of date. List them as web-accessible, and mount only once the text
has arrived (the fetch is asynchronous):

```js
const CSS_FILES = ['tokens.css', 'base.css', 'controls.css', 'overlay.css'];

async function loadCss() {
  const texts = await Promise.all(CSS_FILES.map((f) => fetch(chrome.runtime.getURL(`ui/${f}`)).then((r) => r.text())));
  return texts.map((t) => t.replace(/@import[^;]+;/g, '')).join('\n');
}

loadCss().then((css) => mount(css)); // mount() is section 1
```

```json
"web_accessible_resources": [{ "resources": ["ui/*.css", "fonts/*.otf"], "matches": ["<all_urls>"] }]
```

Don't add a `<link>` to the page: it lands in the site's document, the site's CSP can block it,
and its rules apply to the site.

## 3. Fonts through the FontFace API

```js
const FONT_FILES = [['Regular', '400'], ['Medium', '500'], ['Semibold', '600'], ['Bold', '700']];

function installFonts() {
  for (const [file, weight] of FONT_FILES) {
    try {
      const url = chrome.runtime.getURL(`fonts/Gilroy-${file}.otf`);
      const face = new FontFace('Linkr Gilroy', `url("${url}") format("opentype")`, { weight, display: 'swap' });
      document.fonts.add(face);
      face.load().catch(() => {}); // a site whose font-src blocks it gets the fallback
    } catch {
      // a browser that won't take fonts from an extension script still gets the fallback
    }
  }
}
```

- Chromium ignores `@font-face` inside a shadow root, and a `<style>` in the page can be blocked by
  its CSP, so fonts are registered on the page's `document.fonts` from script. They become visible
  to the site too, which is why the family name is the extension's own (`'Linkr Gilroy'`) and must
  match `--font` in `tokens.css`.
- Firefox Manifest V2 takes a flat list: `"web_accessible_resources": ["ui/*.css", "fonts/*.otf"]`.

## 4. Markup for each component

These are the structures `overlay.css` expects, with the attributes that make them accessible.
Icons are inline SVG with `aria-hidden="true"`; their labels come from the button.

**Dock and launcher** (bottom right; `aria-pressed` follows the mode):

```html
<div class="dock">
  <button class="dock-action" type="button" disabled>        <!-- optional second action -->
    <span class="dock-count">0</span><span class="caps">Publish</span>
  </button>
  <button class="launcher" type="button" aria-pressed="false" title="What it does (shortcut)">
    <span class="launcher-icon">…svg…<span class="launcher-badge"></span></span>
    <span class="launcher-label caps">Save link</span>
    <kbd class="launcher-kbd">Esc</kbd>
  </button>
</div>
```

**Panel** (`.panel--docked` when it opens from the dock; otherwise positioned at a spot, see 5):

```html
<section class="panel panel--docked is-open" role="dialog" aria-label="Save this link">
  <header class="panel-head">
    <div class="panel-top">
      <p class="panel-title"><span class="panel-pin" aria-hidden="true"></span><span>Page title</span></p>
      <span class="chip">Staging</span>
      <button class="panel-close" type="button" aria-label="Close" title="Close (Esc)">…×…</button>
    </div>
    <div class="panel-pickers">
      <select class="pill-select" aria-label="List">…</select>
      <select class="pill-select pill-select--fit" aria-label="Person">…</select>
    </div>
  </header>
  <div class="panel-body">
    <textarea class="panel-input" rows="4" placeholder="Add a note" aria-label="Note"></textarea>
    <!-- a gold primary is optional; Pointer's note sends on Enter and shows it in the foot -->
  </div>
  <footer class="panel-foot">
    <span class="hint"><kbd>Enter</kbd><span>Save link</span></span>
    <span class="hint"><kbd>Shift</kbd><kbd>Enter</kbd><span>New line</span></span>
    <span class="hint"><kbd>Esc</kbd><span>Close</span></span>
  </footer>
</section>
```

- While sending, replace the body with `.progress` (one `.progress-seg` per step, the current one
  `.is-active`, earlier ones `.is-done`) and remove the × until it's done.
- On failure, the body shows the error, and the foot says what's kept:

```html
<div class="alert" role="alert">
  <span class="alert-icon">…</span>
  <p class="alert-title">The link wasn't saved</p>
  <p class="alert-detail">The reason, as the API gave it.</p>
</div>
<div class="actions"><button class="btn btn--primary" type="button">Try again</button></div>
```

**Toast** (one element, its content replaced each time):

```html
<div class="toast is-visible" role="status" aria-live="polite">
  <span class="toast-icon">…check…</span>
  <span class="toast-text"><span class="toast-title">Saved to Engineering</span><span class="toast-meta">Page title</span></span>
  <a class="toast-link" href="…" target="_blank" rel="noopener">Open</a>
  <button class="toast-undo caps" type="button">Undo</button>
  <span class="toast-timer" aria-hidden="true"></span>
</div>
```

Set the timer's `animation-duration` to the Undo window (10s in Pointer). `.toast-icon--alert`
swaps the check for a danger mark on errors.

## 5. Layering and placement

- Floating pieces (`.dock`, `.panel`, `.pin`, `.toast`) use z-index 2147483647 and outlines one
  less, so cookie banners and chat widgets don't cover them.
- Everything is `position: fixed` in viewport coordinates. Widths use `%` of the viewport, not
  `vw`, because `vw` includes the scrollbar.
- **From the dock:** `.panel--docked` sits 76px from the bottom, right-aligned with the dock, and
  grows out of the launcher. Nothing to compute.
- **At a spot on the page:** put the panel beside the spot (16px gap), flip left or up when
  there's no room, then clamp it 8px inside the viewport. Re-place on scroll (capture phase on
  `window`) and resize, batched in `requestAnimationFrame`.
- Follow a page element rather than a fixed point: remember the offset inside the element and
  recompute from its `getBoundingClientRect()` each frame. If the element vanishes (React
  re-rendered it), hold still rather than jumping to 0,0.
- The comment pin's tip is its square corner: set `left/top` to the spot; `margin-top: -24px`
  puts the body above it. Add `.flip-x` when `x + 28 > viewport width`, `.flip-y` when `y - 28 < 0`.
- The toast is centred at the bottom and moves up above the dock below 1000px; with a wider dock,
  raise that breakpoint.

## 6. Events and keys

- Listen on `window` in the capture phase (`addEventListener('click', fn, true)`) so the site's
  handlers can't swallow the event first.
- Events from inside the shadow root arrive retargeted to the host. Ignore them in page handlers:
  `if (target === host || host.contains(target)) return;`
- **Keep typing away from the site's shortcuts.** A key pressed in the panel reaches the page with
  the host `<div>` as its target, so the site can't tell someone is typing, and GitHub's `s` or
  YouTube's `k` fire mid-sentence. Stop key events at the host; your own capture-phase listener on
  `window` (for Esc) still runs first:

```js
for (const type of ['keydown', 'keypress', 'keyup']) host.addEventListener(type, (e) => e.stopPropagation());
```

- When a mode takes over clicks (pointing at things), `preventDefault()` and
  `stopImmediatePropagation()` so the site doesn't navigate, and show a crosshair cursor with
  `document.documentElement.style.setProperty('cursor', 'crosshair', 'important')`, restoring the
  old value afterwards.
- `Esc` steps back one level: close the panel (keeping what was typed), then leave the mode.
  Clicking outside a docked panel closes it the same way.

## 7. Screenshots

- Before `tabs.captureVisibleTab`, hide the whole overlay with `host.style.visibility = 'hidden'`,
  wait two animation frames, capture, then restore it. `visibility` (unlike `display`) doesn't
  replay entrance animations when it comes back.
- Draw marks into the image on a canvas in the background script using the same token values
  (canvas can't read CSS variables, so repeat the hex values with a comment pointing to
  `tokens.css`).

## 8. Firefox notes

- Manifest V3 content scripts like these work in current Firefox. Pointer ships Firefox as
  Manifest V2 only because Firefox's V3 limits screenshots to toolbar and shortcut clicks; an
  extension that takes no screenshots doesn't need that.
- **Constructed stylesheets** throw in Firefox content scripts; the `<style>` fallback in
  `adoptStyles` covers it.
- **`field-sizing: content`** isn't supported, so text fields don't grow and selects are as wide
  as their longest option. Fall back in script:

```js
const GROWS = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

function autoGrow(field) {
  if (GROWS) return;
  const fit = () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + (field.offsetHeight - field.clientHeight)}px`;
  };
  field.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

let ctx = null;
function fitSelect(select) {
  if (GROWS) return;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return;
  const cs = getComputedStyle(select);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = select.selectedOptions[0]?.textContent ?? '';
  const extra = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  select.style.width = `${Math.ceil(ctx.measureText(text).width + extra + 4)}px`;
}
```

- Call `fitSelect` after filling the options and on every `change`.

## 9. Only where it's wanted

- A small detector content script can run everywhere and ask the background to inject the full
  UI (`scripting.executeScript`) only on the sites the extension is for. Most pages then carry
  almost nothing, and the overlay never appears where it doesn't belong.
- Guard against double injection with a flag on the content script's global.

## 10. Previewing outside the extension

`fetch(chrome.runtime.getURL(…))` and fonts don't load from `file://`. To look at the UI on a test
page, serve the extension folder over a local server (`npx serve` or `python -m http.server`) and
stub the two extension calls on the test page before loading the content script:

```js
window.chrome = { runtime: { getURL: (p) => `/${p}` }, storage: { local: { get: async () => ({}), set: async () => {} } } };
```

Keep stubs on the test page only; the extension's own code stays free of them.

## 11. Component map (`assets/overlay.css`)

| Class | What it is |
|---|---|
| `.dock` | Fixed bottom-right row holding the launcher and any dock actions. |
| `.launcher` | Ink pill with an orange line icon and a `.caps` label. `.is-active`: gold with ink, and an `Esc` keycap appears. `.needs-setup`: red dot on the icon. `.is-mode`: orange ring, for a mode that must be obvious, or as the active state when an open panel has its own gold button. |
| `.dock-action` + `.dock-count` | Paper pill with an ink ring and an orange count bubble, for a secondary action like "Publish task". Disabled: grey ring and grey count. |
| `.outline--block`, `.outline--element`, `.outline-tab` | Hover outlines: the area in orange with a faint fill and a name tab; the exact element dashed ink with a paper halo. |
| `.pin` | The comment pin, with `.flip-x` / `.flip-y`. |
| `.panel` (`.is-open`, `.panel--docked`) | Floating paper card, 400px, 18px radius, `--lift`. `.panel-head` (title, chips, ×, pickers), `.panel-body`, `.panel-foot` (creme with keycap hints). |
| `.panel-title`, `.panel-pin` | Bold title that wraps (never truncates) with a small pin before it. |
| `.chip`, `.chip--strong`, `.chip--accent` | Small header labels: outlined, filled ink (for what must stand out, e.g. "Production"), or orange (e.g. "Note 2"). |
| `.pill-select`, `.pill-select--fit`, `.is-empty` | Header pickers with icons; `--fit` is as wide as its choice. |
| `.panel-input` | The borderless main text field; it grows with its text. |
| `.panel-danger` | An underlined danger text action in the foot ("Remove"). |
| `.field`, `.field-label`, `.field-input` | Labelled fields for an edit or review step. |
| `.progress`, `.progress-seg` | One segment per step, the active one filling with gold. |
| `.panel-thumb` | A preview image in the panel (e.g. the screenshot about to go out). |
| `.alert` | Error inside a panel: danger icon, bold title, detail. |
| `.toast` | Ink, bottom centre: orange round check, title, `.toast-meta` lines, an orange underlined link, a ghost `.toast-undo` pill and a gold `.toast-timer` that drains while Undo is possible. |
