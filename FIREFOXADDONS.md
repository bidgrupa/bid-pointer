# addons.mozilla.org listing: bid Pointer

> Last updated: 2026-11-09
>
> Everything the Firefox Add-on Developer Hub asks for, ready to paste, in the order the
> submission asks for it. The steps around it are in
> [docs/public-release.md](docs/public-release.md#addonsmozillaorg).

## Upload

- **How to distribute this version:** On this site. AMO has no link-only option like the Chrome Web Store's Unlisted: an add-on is either listed (public, searchable) or self-distributed. Listed, as webpify is, gives one-click installs and automatic updates from AMO without an update feed of bid's own. The add-on ID `pointer@bid.hr` already has unlisted (self-distributed) versions up to 0.10.0; upload this one as a new version of that add-on, so installed copies update from AMO.
- **File:** `release/bid-pointer-firefox-<v>-unsigned.xpi` from `pnpm package`, or the same file from the GitHub release. Mozilla signs it.
- **Compatibility:** Firefox only. Leave Firefox for Android unticked; Pointer isn't tested there.
- **Validation:** 24 expected warnings, all "Unsafe assignment to innerHTML": UI templates whose values all go through `esc()`. The approval notes say so.

## Source code

- **Do you need to submit source code?** Yes. The scripts are bundled from TypeScript by esbuild.
- **File:** `bid-pointer-source-<v>.zip` from the GitHub release of the same version (or `release/` after `pnpm package`, on a clean checkout of the tag).

## Describe the add-on

**Name**
bid Pointer

**Add-on URL**
`https://addons.mozilla.org/firefox/addon/bid-pointer/` (slug: `bid-pointer`)

**Summary** (98 of 250 characters)
```
Click anything on a website, say what's wrong, and get a ClickUp task with a marked-up screenshot.
```

**Description** (line breaks are kept)
```
Pointer turns website feedback into ClickUp tasks.

Click Pointer on a page, click the thing that's wrong, and type what's wrong. Pointer creates a task in your ClickUp workspace with your note, a screenshot with the spot marked, the page's address, and your browser and window size, assigned to whoever you pick.

Made by bid, a web agency, for reviewing staging and live sites with clients and developers. It also does:

• Several notes, one task: collect notes on a page as numbered pins, then publish them together.
• Screen recordings, for the glitches a screenshot can't show.
• Comment Mode: a note about something that already has an open task goes on that task as a comment.
• SEO check: see the page the way Google reads it (whether it can be indexed, its title and description in a Google preview, languages, headings, image alt texts and share previews) and send what needs fixing as one task.
• Send to ClickUp in Gmail and HubSpot: turn a client's email into tasks, with its images and files attached.
• Optional AI rewriting: add your own Z.ai API key, and notes become a short title with clear bullets, and client emails are split into tasks.
• Setup codes: share your team's setup as one line of text. Everyone still connects ClickUp with their own token.

Pointer shows up by itself on the sites you list and on localhost. Anywhere else, click its toolbar button.

You need a ClickUp account: Pointer works with your personal API token. A Z.ai key is optional.

Privacy: Pointer has no server. It sends only what you choose to send, only to your own ClickUp workspace, and to Z.ai if you add a key. Firefox asks for your OK on that when you install it. No analytics, no tracking, nothing for bid.

Source code and support: https://github.com/bidgrupa/bid-pointer
```

**Experimental:** not ticked. **Requires payment, non-free services or software, or additional hardware:** not ticked. A ClickUp account is free.

**Category**
Web Development

**Support email**
`info@bid.agency`, as on the Chrome Web Store. It's shown publicly.

**Support website**
`https://github.com/bidgrupa/bid-pointer/issues`

**License**
All Rights Reserved, unless bid decides to make Pointer open source. webpify is AGPL because its encoder is; nothing in Pointer requires an open licence.

**Privacy policy**
Tick "This add-on has a privacy policy" and paste the text of [PRIVACY.md](PRIVACY.md), without its first heading.

**Notes to reviewer**
Paste [store/firefox/approval-notes.txt](store/firefox/approval-notes.txt), then the test account (login and API token). The release workflow sends the same notes with every later version, with the test account from the `AMO_TEST_ACCOUNT` secret.

## Product page (after submitting: Edit Product Page)

**Screenshots** (1280×800; the same as on the Chrome Web Store, in the same order, with these captions)

| File | Caption |
|---|---|
| `store/chrome/screenshot-1-note.png` | Click what's wrong and say why. Pointer files it in ClickUp with a marked-up screenshot. |
| `store/chrome/screenshot-2-page-task.png` | Collect notes on a page as numbered pins, then publish them as one task. |
| `store/chrome/screenshot-3-review.png` | Optional AI rewriting tidies a quick note; check it before it goes to ClickUp. |
| `store/chrome/screenshot-4-seo.png` | The SEO check: the page the way Google reads it, with a Google preview. |
| `store/chrome/screenshot-5-settings.png` | Connect ClickUp with your own token and paste your team's setup code. |

`pnpm screenshots` renders them again.

**Icon:** taken from the package (`icons/128.png`); nothing to upload.

**Homepage:** `https://github.com/bidgrupa/bid-pointer`

## Version history

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.0.0 | 2026-11-09 | First listed version: nothing secret built in, Firefox 140+ (data collection asked at install), settings instead of bid's built-in setup, setup codes. Installed unlisted copies update to it. | ⬜ Not submitted |
| 0.2.0–0.10.0 | 2026-10-05 – 2026-10-26 | bid's internal builds, signed unlisted. | Internal |

## Review notes

### Rejection history
None yet.
