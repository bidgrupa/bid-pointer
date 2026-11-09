# Components for extension pages

Markup for each piece in `assets/page.css`, when to use it, and its states. `assets/page-template.html`
shows them together. Class names are suggestions: if the extension already has its own markup,
port the rules onto it instead of renaming everything.

## Contents

1. Page layout: masthead, groups, popup
2. Buttons
3. Text fields and secret fields
4. Selects
5. Switch
6. Help, status, callout, tip, folded answers
7. Steps (first run)
8. Done panel
9. Lists and tags
10. Keys and code
11. "Saved" toast
12. Advanced (closed by default)
13. Icons

## 1. Page layout

```html
<header class="masthead">
  <div class="wrap masthead-inner">
    <svg class="mark" viewBox="0 0 20 20" …>…</svg>
    <div><h1>Product name</h1><p>One sentence on what it does.</p></div>
  </div>
</header>
<main class="wrap">
  <section class="group" aria-labelledby="x-title">
    <div class="group-head"><h2 id="x-title">Section</h2><p>What it's for.</p></div>
    <div class="group-body">…controls…</div>
  </section>
</main>
```

- The masthead is an ink band: the mark in orange, the name in the gold gradient as text fill,
  one sentence in paper at 0.74 opacity. Only the product name gets gold text.
- `.wrap` is 840px wide with 24px gutters. Each `.group` puts a title and one or two sentences of
  purpose on the left (210px) and the controls on the right; under 760px they stack.
- Groups are separated by 1px `--line` rules, never by cards or shadows.
- First-run pages can hide everything except setup: put `class="after-setup"` on the other
  groups and hide them while `body.is-first-run` is set, so a new person sees one thing to do.
- **Popup:** `<body class="popup">`, see `assets/popup-template.html`. 360px wide (or the
  extension's existing width), a short masthead (28px mark, 22px name), groups stacked with 18px
  padding, the one gold action full width (`.popup-action`), and a creme `.popup-foot` holding the
  way to the settings. Keep a popup to one job; settings belong on the options page.
- **Side panel:** use the page layout as is; `.group` stacks automatically at side-panel widths.

## 2. Buttons

```html
<button class="btn btn--primary" type="button">Create task</button>
<button class="btn" type="button">Test connection</button>
<button class="btn btn--small" type="button">Forget</button>
<a class="btn btn--primary" href="…" target="_blank" rel="noopener">Open settings</a>
```

- All buttons are pills in bid's button voice (12px bold, 0.14em tracking, uppercase), written
  in sentence case in the HTML; `text-transform` does the capitals so screen readers read words.
- `.btn--primary`: the gold gradient with ink text. One per view, for the next step. On hover the
  gradient slides toward its light end.
- `.btn`: paper with a `--line` border that turns ink on hover. Everything else.
- `.btn--small`: 32px high, for actions inside rows and panels.
- `.btn--danger`: danger text on paper with a danger-wash border, filled on hover. For what can't
  be undone ("Clear all links"). Put it in its own last group, away from the primary button, so it
  never reads as confirming something else.
- Disabled: 0.5 opacity, no hover.

## 3. Text fields

```html
<div class="field">
  <label for="url">Webhook URL</label>
  <input id="url" type="url" placeholder="https://…" />
  <p class="help">Where the extension sends events.</p>
</div>
<div class="secret">
  <input id="token" type="password" autocomplete="off" spellcheck="false" />
  <button class="icon-btn" type="button" aria-label="Show token" aria-pressed="false">…eye…</button>
</div>
```

- 44px pill inputs, 1px `--line` border, `--ink-3` on hover, `--orange-dark` border plus the ring
  on focus. Placeholders in `--ink-3`.
- `textarea` keeps the same border and focus but uses the 12px radius (a pill can't hold lines).
- Secrets: the eye `.icon-btn` sits inside the field on the right. Show a masked value elsewhere
  (keep a recognisable prefix and the last four characters) and hide it again when the tab is
  hidden.
- `.field-row` puts short fields side by side and wraps them below 190px each.
- Search: `<input class="input--search" type="search">` puts a magnifier inside the pill.

## 4. Selects

```html
<select class="select">…</select>                 <!-- leading folder icon -->
<select class="select select--person">…</select>  <!-- leading person icon -->
<select class="select select--plain">…</select>   <!-- chevron only -->
```

- Pills like the inputs, with the chevron and an optional leading icon from the tokens
  (`--icon-list`, `--icon-person`). New icons: same 16px box and `#5f5e69` stroke, as data URIs.
- `.is-empty`: an answer is still needed (nothing could be pre-selected). Orange border on
  `--orange-wash` with `--orange-ink` text, so it reads as unfinished rather than as an error.
- Group long option lists with `<optgroup>` ("Last used", "Suggested", "All").

## 5. Switch

```html
<label class="switch">
  <input type="checkbox" role="switch" />
  <span class="switch-label">Review before sending</span>
  <span class="switch-help">Shows what will be sent for a quick edit first.</span>
</label>
```

- For settings that take effect at once. The track is `--ink-3` off and `--orange-dark` on;
  the whole label is clickable. Write the label as the "on" state.

## 6. Help, status, callout, tip, folded answers

```html
<p class="help">One sentence of guidance.</p>
<p class="status" role="status"></p>            <!-- set text + .is-ok / .is-bad -->
<p class="callout">Something worth stopping for.</p>
<p class="callout callout--warn">Something is wrong and needs fixing.</p>
<p class="tip"><b>Tip:</b> a shortcut worth knowing.</p>
<details class="faq"><summary>Is this safe?</summary><p>…</p></details>
```

- `.help` and `.status` collapse when empty, so they can sit in the markup ready. An empty
  `.status` stays in the accessibility tree (visually hidden, not `display: none`), so a
  `role="status"` line is announced the first time text goes into it.
- Status: neutral `--ink-2`; `.is-ok` in `--orange-ink` ("Connected as Ana"); `.is-bad` in
  `--danger` with the reason ("ClickUp didn't accept that token").
- Callouts are creme panels; `--warn` is the danger wash. Tips are smaller creme notes.
- `.faq` hides a short answer behind an orange-ink summary link.

## 7. Steps (first run)

```html
<ol class="steps">
  <li class="step is-done"><span class="step-num">1</span><div class="step-body">…</div></li>
  <li class="step is-current"><span class="step-num">2</span><div class="step-body">…</div></li>
  <li class="step"><span class="step-num">3</span><div class="step-body">…</div></li>
</ol>
```

- Ink number circles; the current one turns orange with an orange-wash halo; finished ones show
  an orange-ink check on the wash. Each step: a bold `.step-title`, then one control.
- Move `.is-current` as the person progresses (e.g. when they come back to the tab).

## 8. Done panel

```html
<div class="done-panel">
  <span class="done-panel-icon">…check…</span>
  <div class="done-panel-body"><p class="done-panel-title">Connected as Ana</p><p class="help">You're all set.</p></div>
  <button class="btn btn--small" type="button">Change</button>
</div>
```

- Replaces a finished walkthrough: orange-wash panel, orange round check, one way to change it.

## 9. Lists and tags

```html
<ul class="rows">
  <li>
    <div class="row-main">
      <a class="row-title" href="…">Item name</a>
      <div class="row-meta"><span>Project</span><span>06.10.2026 12:11</span><span class="tag is-ok">Attached</span></div>
      <p class="row-error">Why it failed</p>
    </div>
    <button class="btn btn--small" type="button">Forget</button>
  </li>
</ul>
<p class="empty">No items yet. Items you create show up here.</p>
```

- Rules only between rows; the first row lines up with the group's heading.
- Tags are small pills with a dot in their own colour: `.is-ok` (orange wash, orange-ink) and
  `.is-bad` (danger wash, danger). Keep tag text to two or three words.
- Dates as `dd.mm.yyyy hh:mm`.

## 10. Keys and code

```html
<span class="keys"><kbd>Alt</kbd><kbd>Shift</kbd><kbd>P</kbd></span>
<code>localhost:8765</code>
```

- `kbd` is a paper keycap with a heavier bottom edge; show shortcuts as keycaps, not text.
- `code` is creme with the 6px radius, for hosts, ids and anything copied literally.

## 11. "Saved" toast

```html
<div class="saved" role="status">Saved</div>
```

```js
let timer = 0;
function flashSaved() {
  const el = document.querySelector('.saved');
  el.classList.add('is-visible');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('is-visible'), 1200);
}
```

- Settings save as they change; this small ink pill confirms it bottom right for 1.2s. No Save
  buttons for settings that can save on change.

## 12. Advanced (closed by default)

```html
<details class="disclosure">
  <summary class="btn">Show advanced settings</summary>
  <div class="disclosure-body">…</div>
</details>
```

- For settings most people should never touch. The summary is an ordinary `.btn`.

## 13. Icons

- Line icons on a 16px or 20px box: 1.6-1.8 stroke, round caps and joins, `currentColor`.
- Orange on ink (the mark, the launcher), `--ink-2` on paper (pickers, icon buttons), ink on
  orange (the check in an orange circle).
- No emoji in the UI chrome, no filled multi-colour icons.
