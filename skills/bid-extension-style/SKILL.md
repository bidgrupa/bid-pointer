---
name: bid-extension-style
description: Style a browser extension (Chrome, Edge, Firefox) in the bid Pointer look - BID grupa's palette (bid-black ink, paper, creme, orange and the gold gradient), Gilroy type, pill-shaped controls, tracked-caps buttons, the orange focus ring and Pointer's comment-pin mark. Ships Pointer's real token, reset and control CSS plus ready stylesheets for extension pages (options, popup, side panel) and for on-page UI injected through a shadow root. Use this whenever someone wants their extension, popup, options or settings page, side panel or injected on-page widget to look like Pointer or like bid, asks to restyle, theme or brand an extension for BID grupa, or mentions bid tokens, Gilroy or the gold gradient in an extension, even if they only say "make it look like our other extension" or "use the Pointer style".
---

# bid extension style (the Pointer look)

This is the visual system of **bid Pointer**, BID grupa's QA extension. It takes the brand of
bid-web (palette, gold gradient, Gilroy, pill buttons, bold tracked capitals) and adapts it for
small extension UI, where text is small, surfaces float over other people's websites, and every
control must stay legible and keyboard-friendly.

Use it to restyle an existing extension or to build a new one. Copy the system, not Pointer's
features: the coworker's extension keeps its own structure, wording and purpose and gains the look.

## What's in this skill

| File | Use it for |
|---|---|
| `assets/tokens.css` | Colours, gradient, type stack, radii, shadow, focus ring, easing. The single source of every value. Copied unchanged from Pointer, which is why its font is still called `'Pointer Gilroy'` until you rename it (workflow step 3). |
| `assets/base.css` | The tiny reset both surfaces share. Unchanged from Pointer. |
| `assets/controls.css` | Buttons (`.btn`, `.btn--primary`, `.btn--small`), `.caps` and `kbd`. Unchanged from Pointer. |
| `assets/page.css` | Everything for extension pages: masthead, settings groups, fields, pill inputs and selects, switch, status lines, callouts, lists, tags, steps, the "Saved" toast, plus a `body.popup` variant. |
| `assets/page-template.html` | A skeleton options page with the right class names. Start here for a settings page. |
| `assets/popup-template.html` | A skeleton popup: short masthead, one gold action, a searchable list, a creme foot. |
| `assets/overlay.css` | On-page UI inside a shadow root: launcher pill, floating panel, chips, pill selects, toast with Undo, outlines, the comment pin, progress. |
| `references/components.md` | Markup and the reasoning for each component, with the state classes. Read it when building or restyling a page or popup. |
| `references/on-page-ui.md` | How to inject UI into websites without the site breaking it (shadow root, constructed stylesheets, FontFace, z-index, Firefox gaps). Read it before any content-script UI. |

## Workflow

1. **Find the surfaces.** List what the extension shows: popup, options page, side panel, new-tab
   page, and anything a content script draws on websites. Pages use `page.css`. On-page UI uses
   `overlay.css` inside a shadow root (`references/on-page-ui.md`).
2. **Bring in the files.** Copy `tokens.css`, `base.css` and `controls.css` next to the page or
   overlay stylesheet. Both `page.css` and `overlay.css` `@import` them by those names. With a
   bundler, import them the same way; without one, `@import` works in extension pages.
3. **Fonts.** Gilroy is bid's licensed typeface. Copy `Gilroy-Regular.otf`, `-Medium`, `-Semibold`
   and `-Bold` from bid-web (`public/fonts/`) or from Pointer (`fonts/`) into the extension's
   `fonts/` folder. Keep them in private repos; never publish them. Then rename the family
   `'Pointer Gilroy'` to the extension's own, e.g. `'Linkr Gilroy'`: in `--font` in `tokens.css`,
   and in the four `@font-face` rules in `page.css` or the overlay's FontFace calls. The name is
   namespaced because on-page fonts join the website's own font list, and a site that also loads
   "Gilroy" (perhaps a different cut or subset) must not be able to swap yours. The bare `'Gilroy'`
   after it in the stack is a deliberate fallback: if your files can't load, a site's own Gilroy is
   still the right typeface. After that comes system-ui, which is acceptable but not the look.
4. **Restyle.** Map each existing element to a component in `references/components.md` and give it
   those classes, or port the rules into the extension's existing CSS. Replace every hard-coded
   colour, radius and shadow with a token. If a value is truly missing, derive it the way
   `tokens.css` does (from the palette, with a comment saying why) instead of inventing a new hue.
5. **Check** against the checklist at the end, in the browser, at the real size.

If the project uses Tailwind or a component library, keep its layout utilities but feed the visual
values from the tokens: in Tailwind, `theme.extend.colors.ink = 'var(--ink)'` and so on, and
`backgroundImage.gold = 'var(--gold)'`. The rules below matter more than the class names.

## Restyling an extension that already works

Usually the person wants the look without breaking anything, and the script may not be theirs to
change. Then the markup is a contract:

- Keep every id, every class the script reads, the element types and the form structure. Style
  what's there with selectors (`#links li`, `#links a`, `.del`) instead of wrapping it in new markup:
  rows the script adds later won't have your wrappers.
- Some states need a hook from script: status colours (`.is-ok`, `.is-bad`), `.is-empty` on a
  select, `.is-visible` on the "Saved" toast. If the script can't change, leave those neutral and
  tell the person the one line that would switch each on.
- Keep an existing Save button if the script listens for it. Saving as you go with a "Saved" toast
  is for new pages, not a reason to rewrite working ones.
- Keep the extension's wording unless it breaks the voice rules (shouting caps, "Submit"), and list
  every piece of text you changed so they can check it against what the script expects.
- Keep the popup's existing width if it has one.

## The rules, and why

**Palette roles.** Each colour has one job, so the UI reads the same everywhere.

| Token | Job |
|---|---|
| `--ink` #1d1c2c | Text, borders you're meant to notice, dark bands (masthead, toast, launcher). |
| `--paper` #fdfcfc | Page and card background. Never pure white. |
| `--creme` #f4eada | Quiet fills: footers of cards, tips, `code`, callouts. |
| `--line` #e8e5e0 | Hairlines, input borders, dividers between sections and rows. |
| `--orange` #ffa173 | Marks and highlights: icons on ink, the current step, pins, counts, the focus ring. Not for text on light backgrounds (about 2:1). |
| `--orange-ink` #8f5537 | Accent **text** on paper or creme: success status, links in prose, "OK" tags. |
| `--orange-wash` #fff3ec | Fill for "needs an answer" fields and success panels. |
| `--gold` gradient | The one primary action on a screen, and the product name in the masthead. |
| `--ink-2`, `--ink-3` | Secondary text (6.2:1) and placeholders or idle switch tracks (3.6:1). |
| `--danger`, `--danger-wash`, `--danger-light` | Errors on paper, error panels, error marks on ink. |

**Gold carries ink text, not white.** bid-web puts white on the gold gradient, which is about 2:1
at the light end. Pointer uses ink, and the extension should too. Keep that text centred: ink is
about 6:1 on the middle of the gradient but only about 4.2:1 on its dark left end. Gold is rare:
one primary button per view, so it always means "the thing to do next". The launcher's gold is a
state ("a mode is on"), not an action; when an open panel has its own gold button, show the
launcher's active state with the orange ring (`.is-mode`) instead, so only one gold thing is on
screen.

**Type.** Gilroy at 400, 500, 600 and 700 only. Pages: body 15px/1.55; section titles 17px bold;
help text 13-14px in `--ink-2`. Compact on-page UI: 14-16px. Headings and everything you *read*
are sentence case. Bold tracked capitals (`.caps`: 12px, 700, 0.14em, uppercase) are bid's button
voice and are used only on things you *press*: buttons, the launcher label, Undo. That split lets
people tell actions from information at a glance; all-caps headings would blur it.

**Shape.** Everything you press or type into is a pill (`--radius-pill`): buttons, inputs,
selects, tags, the launcher, toasts' buttons. Cards and panels are rounded rectangles
(`--radius-lg` 18px for floating cards, `--radius-md` 12px for callouts and inline panels).
`--radius-sm` 6px is for small things: `kbd`, `code`, focus outlines on text links.

**Depth.** Two levels only. Things that float over content (launcher, floating panels, toasts,
the "Saved" toast) get `--lift`. Everything in the page flow is flat, framed by 1px `--line`.
More shadows make extension UI look heavy next to the website it sits on.

**Focus.** Every focusable element shows `--ring` (a soft orange halo) on `:focus-visible` and
never the browser outline. Inputs and selects also turn their border `--orange-dark`. The one
exception is a borderless text field that fills its panel (`.panel-input`): the open panel and the
caret already show where typing goes, and a ring around the whole card would be noise.

**Motion.** Short and small: 150-220ms with `--ease`, 1px lifts on hover, an entrance scale from
0.96. Under `prefers-reduced-motion: reduce` drop movement but keep the information (a progress
bar stays, half full, instead of animating).

**Timing.** Toasts that only confirm stay 2-3.5s. A toast with Undo stays 10s, with the gold timer
bar draining so people can see how long they have. Errors stay 6-8s and say what's kept; the
"Saved" pill on settings pages shows for 1.2s.

**States.** A required choice that's still empty: orange border on `--orange-wash`, with
`--orange-ink` text. Success: `--orange-ink` text or an `--orange-wash` panel with an orange round
check. Errors: `--danger` text, or a `--danger-wash` panel. Disabled: 0.5 opacity on buttons,
`--ink-3` text on fields. Status lines are empty (and hidden) until there's something to say.

**Signature: the comment pin.** An orange square with a 2px ink border, a paper dot in the middle,
and three round corners: the fourth, square corner sits exactly on the spot it marks, so the spot
itself stays visible. Near the right or top edge it flips toward open space. Use it if the
extension marks places on a page; otherwise leave it out rather than decorating with it. The
product mark is a thin line icon (20px viewBox, 1.6 stroke, round caps) in orange on ink. Pointer's
is a crosshair; draw the extension's own in the same manner.

**Dark surfaces.** The masthead, launcher and toast are ink with paper text; secondary text on ink
is paper at 0.68-0.74 opacity. The masthead's product name uses the gold gradient as text fill.

## Writing in the UI

The look includes the voice. Short, plain English, sentence case, no exclamation marks.

- Buttons are verbs for what happens: "Create task", "Publish task", "Change token", "Undo".
- Help text says what something does or why, in one sentence: "Shows the title and details for a
  quick edit first."
- Errors say what went wrong and what's safe: "The task wasn't created" + the reason + "Your note
  is kept."
- Empty states say how to fill them: "No tasks yet. Tasks you create show up here."
- Keyboard hints are keycaps plus a word: `Enter` Create task, `Esc` Cancel.

## What not to do

- White text on gold, or orange text on paper or creme (both about 2:1).
- New colours. Tints come from the palette via the tokens, with a comment saying why.
- Square buttons or inputs, or an extra border radius scale.
- Gold on something destructive: "Clear all" and "Delete" use `.btn--danger`.
- Shadows on things that don't float.
- Uppercase headings or body text; sentence-case buttons (they stay `.caps`).
- Removing focus styles, or relying on hover alone for something important.
- On websites: styles in the light DOM, `<link>` tags into the page, or z-index below the site's
  own overlays (see `references/on-page-ui.md`).

## Checklist

- [ ] Every colour, radius, shadow and easing comes from a token.
- [ ] Gilroy loads (under the extension's own family name), and the fallback still reads well.
- [ ] At most one gold primary button per view, with ink text.
- [ ] Caps only on pressable things; headings and text in sentence case.
- [ ] Every control is a pill; cards use the 18px or 12px radius.
- [ ] Tab through it: every focusable thing shows the orange ring (a panel's borderless main field aside).
- [ ] Restyling working code: every id, script-read class and element type is still there, and the
      text changes are listed for the person.
- [ ] Empty, success, error and disabled states use the colours above.
- [ ] Reduced motion keeps the information and drops the movement.
- [ ] On-page UI lives in a shadow root and works in Firefox (style fallback, field growth).
- [ ] Narrow widths: settings groups stack under 760px; on-page panels stay 8px inside the viewport.
