# Chrome Web Store listing: bid Pointer

> Last updated: 2026-11-09
>
> Everything the Chrome Developer Dashboard asks for, ready to paste, tab by tab. The steps
> around it are in [docs/public-release.md](docs/public-release.md#chrome-web-store). Edge Add-ons
> takes the same text.

## Store listing

**Extension name** and **summary** come from the package's manifest and can't be edited in the dashboard:
- bid Pointer
- Click anything on a website, say what's wrong, and get a ClickUp task with a marked-up screenshot. (98 characters; the limit is 132)

**Detailed description**
(The dashboard strips markdown. Paste as plain text with blank lines between paragraphs.)

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

Privacy: Pointer has no server. It sends only what you choose to send, only to your own ClickUp workspace, and to Z.ai if you add a key. No analytics, no tracking, nothing for bid.

Source code and support: https://github.com/bidgrupa/bid-pointer
```

**Category**
Productivity › Developer Tools

**Single purpose** (Privacy tab)

```
Pointer turns website and client feedback into tasks in the user's own ClickUp workspace. On a web page, the user clicks the thing that's wrong and writes a note; Pointer creates a ClickUp task with the note, a marked-up screenshot and the page's address. Every other part serves this purpose: several notes can become one task, a note can become a comment on an existing task, the SEO check turns what's wrong with a page's SEO into a task, and in Gmail and HubSpot a client's email becomes tasks. Optional AI rewriting (the user's own Z.ai key) tidies the notes, and the settings page connects ClickUp and says where Pointer shows up.
```

**Primary language**
English

## Graphics and assets

| Asset | Dimensions | Status | File |
|---|---|---|---|
| Store icon (required) | 128×128 PNG, 96×96 artwork | ✅ Ready (built by `pnpm build`) | `icons/store-128.png` |
| Screenshot 1 (at least one required) | 1280×800 | ✅ Ready | `store/chrome/screenshot-1-note.png` |
| Screenshot 2 | 1280×800 | ✅ Ready | `store/chrome/screenshot-2-page-task.png` |
| Screenshot 3 | 1280×800 | ✅ Ready | `store/chrome/screenshot-3-review.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store/chrome/screenshot-4-seo.png` |
| Screenshot 5 | 1280×800 | ✅ Ready | `store/chrome/screenshot-5-settings.png` |
| Small promo tile (required) | 440×280 | ✅ Ready | `store/chrome/promo-small.png` |
| Marquee promo tile | 1400×560 | ⬜ Optional, only needed to be featured | |

Upload the screenshots in that order. `pnpm screenshots` renders them again after a UI change (run `pnpm build` first). They show Pointer's real interface, loaded into Chrome, at work on a made-up hotel's staging site with a made-up agency's ClickUp (`store/chrome/src/`); ClickUp and Z.ai are answered inside the browser. Gmail and HubSpot are left out on purpose: the only Gmail page to hand is a stand-in, and a look-alike of Google's product doesn't belong in a store listing.

## Permissions justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Keeps the user's ClickUp token, their optional Z.ai key, their settings, and notes waiting to be published together as one task, on the device. |
| `unlimitedStorage` | permissions | Notes collected for a page task keep their full-resolution screenshots until the user publishes the task. A few of them go past the default 10 MB quota. |
| `activeTab` | permissions | When the user starts Pointer from its toolbar button or shortcut on a site they haven't given it access to, Pointer can still run there and take the screenshot. |
| `scripting` | permissions | Injects Pointer's page interface into a tab only when it's needed: on the sites in the user's list, on pages that credit the user's agency, or when the user starts it from the toolbar. |
| `<all_urls>` | host_permissions | The user's staging and client sites can be on any domain. On them Pointer must take a screenshot (tabs.captureVisibleTab), read the element the user clicked, and, for the SEO check, read the page's robots.txt, sitemap and links. On other sites only a small script runs: it compares the address with the user's list of sites and stops. It also reaches api.clickup.com and api.z.ai. |

**Are you using remote code?** No, I am not using remote code. All code ships in the package, bundled from the TypeScript sources by esbuild, not minified.

## Privacy and data use

**What user data do you plan to collect?** Tick these. Pointer sends them to ClickUp, and to Z.ai if the user adds a key, when the user asks it to:
- [x] Personally identifiable information: the names and email addresses in an email sent to ClickUp, a HubSpot ticket's owner and contact.
- [x] Authentication information: the user's own ClickUp token and Z.ai key, sent to those services.
- [x] Personal communications: the emails sent with Send to ClickUp.
- [x] Website content: screenshots, the clicked element's text, the page's tags and texts for the SEO check.
- [x] Web history: the address and title of the page a note is about (not the browsing history, but safer to tick).

Leave unticked: health, financial and payment, location, user activity. The spot marked on a screenshot is part of the screenshot.

Data use certification:
- [x] Data is not sold to third parties.
- [x] Data is not used for purposes unrelated to the extension's core functionality.
- [x] Data is not used for creditworthiness or lending purposes.

**Privacy policy URL:** `https://github.com/bidgrupa/bid-pointer/blob/main/PRIVACY.md`, as webpify does. It opens once the repository is public ([docs/public-release.md](docs/public-release.md#making-the-repository-public)); check that the link opens before submitting.

## Distribution

- **Payments:** Free of charge.
- **Visibility:** Unlisted, like webpify. Anyone with the link can install it (BID's people and clients), it doesn't appear in search, and updates install automatically. Public would also list it in search. Unlisted items get the same review and the same policies. Changing visibility later needs one manual publish from the dashboard before the release workflow can publish again.
- **Regions:** All regions.

## Additional fields (Store listing tab)

- **Official URL:** none. It needs a domain verified in Google Search Console.
- **Homepage URL:** `https://github.com/bidgrupa/bid-pointer`
- **Support URL:** `https://github.com/bidgrupa/bid-pointer/issues`
- **Mature content:** not ticked.

## Test instructions

**Username / password:** the review test account's ClickUp login ([docs/public-release.md](docs/public-release.md#before-the-first-store-submission)). Don't commit it.

**Additional instructions** (paste as plain text, with the token filled in):

```
Pointer works with a ClickUp workspace; the account above is a test one made for review. Its API token, to paste into Pointer: TODO pk_…

1. After installing, Pointer's settings page opens. Read what Pointer sends and click "I agree".
2. Paste the API token into step 3. Pointer connects and picks the workspace's only space, "Review", by itself.
3. Open any website, for example https://example.com, and click the bid Pointer toolbar button. A "Pointer" button appears in the bottom-right corner.
4. Click the page's heading, type a note such as "This heading should be bigger", choose the project "Website", and press Enter. A task with a screenshot appears in ClickUp (log in with the account above), in the Review space.
5. Optional: the SEO button next to Pointer checks the page; tick a finding and press Send.

Z.ai rewriting is optional and off without a key. Pointer works fully without it.
```

## Developer info

- **Publisher:** a BID-owned publisher account rather than a personal one, with colleagues added as members. An account can only ever have one publisher. Use the same one as webpify.
- **Publisher name:** BID Grupa, as bid.agency writes it (webpify's docs have "BID grupa"; use one spelling for both). Shown on the listing.
- **Contact email:** `info@bid.agency`, the address bid.agency gives. It's shown publicly, and Google sends policy notices to it.
- **Trader declaration:** "Trader", verified by Google and shown to EU users. The details as bid.agency publishes them (footer and privacy policy):
  - BID Grupa d.o.o., OIB 40985193097
  - Trinajstići 74E, 51215 Kastav, Croatia (the address bid's privacy policy gives; the office is Cvetkov trg 6–8, Rijeka)
  - +385 51 860 177, `info@bid.agency`

## Version history

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.0.0 | 2026-11-09 | First store version. Nothing secret built in; the user's OK before anything is sent; ClickUp space, sites, agency domains, coding agent and Z.ai key are settings; setup codes. | ⬜ Not submitted |
| 0.1.0–0.10.0 | 2026-09-17 – 2026-10-26 | bid's internal builds, loaded unpacked. | Internal |

## Review notes

### Known limitations
- Tasks need a ClickUp account and a personal API token; there's no ClickUp sign-in (OAuth) yet.
- Pointer starts by itself only on localhost and the sites in its settings; anywhere else, from the toolbar.
- Screen recordings attach as MP4 in Chrome and Edge.

### Rejection history
None yet.
