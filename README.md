# bid Pointer

Click anything on a staging or live site, write what's wrong, press Enter.
A ClickUp task with your note (rewritten short, if you add a Z.ai key), a screenshot with the spot
highlighted, the CMS block name, a link to the page and whether it's staging or production is
created and assigned to the default assignee (Mate, at bid). Runs in Chrome, Edge, Firefox, Zen and Safari. With **Enable Page Specific Task** on,
a page's notes collect as pins and go out together as one task. In Gmail, and on a ticket in
HubSpot's Help Desk, a gold **Send to ClickUp** button turns a client's email into tasks, images
and all. An **SEO** button beside Pointer checks the page the way Google reads it.

## Install

[INSTALL.md](INSTALL.md): from the Chrome Web Store or addons.mozilla.org once Pointer is published,
or from a GitHub release; then agree to what Pointer sends, connect ClickUp with your own token, and
paste your team's setup code.

## Release and publish (whoever maintains it)

Releases follow webpify's setup (`github.com/bidgrupa/webpify`):

| Document | What's in it |
|---|---|
| [RELEASING.md](RELEASING.md) | Making a release: bump, commit, tag. The [Release workflow](.github/workflows/release.yml) builds, tests, packages and publishes it, and submits it to the stores once they're set up. |
| [docs/public-release.md](docs/public-release.md) | Putting Pointer in the Chrome Web Store and on addons.mozilla.org the first time, and the reproducible build. |
| [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md), [FIREFOXADDONS.md](FIREFOXADDONS.md) | Every store field, ready to paste, with the version history and review notes. |
| [PRIVACY.md](PRIVACY.md) | The privacy policy; its GitHub link is the one the stores give. Every build also renders it into `privacy.html`, which Pointer links from its settings. |
| [store/firefox/approval-notes.txt](store/firefox/approval-notes.txt) | What Mozilla's reviewers get with every version. |
| [demo/index.html](demo/index.html) | A made-up hotel's staging site with four CMS blocks: the page reviewers try Pointer on, at https://bidgrupa.github.io/bid-pointer/ (the [Demo page workflow](.github/workflows/demo-page.yml)), and the one in the store screenshots. |

```
pnpm release    # typecheck, unit tests, build, then release/: the Chrome zip (no `key`), the Firefox
                # .xpi, the Safari zip and the source zip (git archive of the last commit)
pnpm screenshots  # after a build: the five store screenshots and the promo tile in store/chrome/,
                  # rendered from the real extension on a made-up hotel's site (store/chrome/src/)
```

The Chrome Web Store listing is **Unlisted**, as webpify's is: anyone with the link can install it,
it doesn't show up in search, and it updates by itself. addons.mozilla.org has no link-only option,
so Pointer is listed there, also as webpify is.

Nothing secret is built in: each person pastes their own ClickUp token, and optionally a Z.ai key, on
the options page.

### Building from source (for add-on reviewers)

The build is reproducible: the same commit gives byte-identical files on any system. The build id in
every script is the version plus a hash of the sources (`scripts/source-hash.mjs`), not a time;
nothing depends on the folder it's built in; and `.gitattributes` keeps checkouts LF.

1. Node.js 22 or later (the workflow uses 24), on any OS.
2. pnpm at the version `package.json` pins: `corepack enable`, or `npm install -g pnpm@10.34.5`.
3. From the source root: `pnpm install --frozen-lockfile`, then `pnpm build`.

`dist-firefox/` is then identical to the Firefox package (`dist/` is Chrome's, `dist-safari/`
Safari's). esbuild bundles the TypeScript in `src/` into one script per entry point, not minified;
the page UI's CSS is minified and inlined into `content.js` for its shadow root.
`scripts/make-icons.mjs` draws the icons and `scripts/privacy-page.mjs` renders `privacy.html` from
PRIVACY.md. Everything else is copied as is.

### Without a store

Firefox and Zen only install add-ons Mozilla has signed. Signing an unlisted copy by hand is free and
private:

```
# once: create API credentials at https://addons.mozilla.org/developers/addon/api/key/
WEB_EXT_API_KEY=user:… WEB_EXT_API_SECRET=… pnpm sign:firefox
```

That writes a signed `.xpi` to `web-ext-artifacts/`. The same version can only be signed once, in
either channel, so bump the version before signing again.

Safari only installs extensions that come inside a Mac app. Apple builds that app from
`bid-pointer-safari-<version>.zip`, no Mac or Xcode needed, but it takes an Apple Developer Program
account: in [App Store Connect](https://appstoreconnect.apple.com/), Apps → **+** → **New App**
(platform macOS, a bundle ID such as `hr.bid.pointer`), then Users and Access → **Xcode Cloud** →
**Safari Web Extension Packager** → **Upload**, and invite the team in TestFlight. On a Mac with
Xcode, `xcrun safari-web-extension-packager dist-safari --app-name "bid Pointer"
--bundle-identifier hr.bid.pointer --macos-only --copy-resources` makes the same app as an Xcode
project instead. webpify's docs/public-release.md, "Mac App Store", has the whole route.

## Setup

The setup page opens by itself after installing. First it says what Pointer sends where, and asks for
an OK (Firefox asks at install instead). Then a three-step walkthrough for the ClickUp API token:
**Open ClickUp settings** goes straight to the token, a sketch shows where Copy is, and coming back to
the tab puts the cursor in the paste field. Pasting connects immediately, the token's only space is
picked by itself (or you pick one), and the rest of the settings appear.

### After installing

Until setup is done (the OK on what Pointer sends, a ClickUp token and a space), the launcher reads
**Set up Pointer** and opens the setup page. It turns into **Pointer** the moment setup is done,
without reloading the page.

Tasks are created from the token owner's ClickUp account and the description footer says who reported
it. They're assigned to the default assignee, picked from the team on the options page, unless someone
else is picked in the note. Nobody is built in: a fresh install assigns no one until someone is picked.
The options page's *Recent tasks* list shows whether each screenshot was attached and, if not, why.

**Rewrite with AI** is optional. With a Z.ai key, notes are rewritten into a title and a few bullets
and Send to ClickUp splits emails into tasks. Without one, notes go as written, without the
`needs-rewrite` tag (that tag marks a rewrite that failed), and an email becomes one task.

**Setup codes** carry a team's setup from one Pointer to another (`src/shared/setupcode.ts`, the
options page's **Setup code**). A code is the shareable settings as JSON, deflated with a checksum,
in URL-safe base64 after `PTR1.`: about 220 characters, or 265 with the Z.ai key. It's encoded, not
encrypted, so a code is as secret as what's in it: the Z.ai key goes in only when "Include my Z.ai
key" is on. It never holds the ClickUp token, the OK on what Pointer sends, or remembered projects
and recent tasks. Pasting shows what the code sets, and nothing changes until **Use these settings**.

**bid's setup.** Before 1.0 it was built in; now it's settings (a setup code sets them all): the space DEVELOPMENT, the default
assignee Mate with **This is a coding agent** on, the sites `*-staging.vercel.app` and
`*-bid.vercel.app`, the agency domains `bid.agency, bid.hr`, and the company Z.ai key. An install
that updates from before 1.0 gets all but the key by itself (`src/background/migrate.ts`).

The install warning says the extension can read data on all sites. Two reasons: the screenshot
(`tabs.captureVisibleTab`) refuses to run without the `<all_urls>` host permission unless point mode
was started from the toolbar icon, and the person's sites can be on any domain. All that runs on other
pages is `detector.js`, which compares the address with the site list (and reads the footer, when an
agency is named) and stops.

## Where Pointer shows up

The options page's **Where Pointer shows up** holds two settings: **Your sites** (host patterns, `*`
for any part) and **Your agency's domains**. `src/shared/site.ts` decides, and the detector
(`src/content/detector.ts`) asks the background to inject the full Pointer (`content.js`) where it applies:

| Page | Pointer | Environment on the task |
|---|---|---|
| on your sites (bid: `*-staging.vercel.app`, `*-bid.vercel.app`) | straight away | Staging |
| `localhost`, `127.0.0.1` | straight away | Local |
| any other `*.vercel.app` | only with the agency's footer credit | Staging |
| any other domain | only with the agency's footer credit | Production (live site) |

A footer credit is a `footer` (or `[role=contentinfo]`, or an element with "footer" in its id or
class) that links to one of the agency's domains, says "powered by <name>" (the first domain's first
part: "bid"), or has an element whose whole text is the name or a domain ("bid", "bid.", "bid.hr").
"Place a bid" doesn't count. The detector keeps looking for 15 seconds, for footers that render
late. With no agency domains set, it doesn't look at footers at all.

Anywhere else, the toolbar button (or `Alt+Shift+P`) starts Pointer by hand.

Gmail (`mail.google.com`) and HubSpot (`app.hubspot.com`, `app-eu1.hubspot.com`) get their own
small scripts, `gmail.js` and `hubspot.js`, which only add Send to ClickUp (see below).

The environment is on its own line in the task description and is also a tag (`staging`,
`production`, `local`), so live-site bugs can be filtered. Staging hosts share one project name
(`cresanka-staging` and `cresanka-git-fix-bid` are both `cresanka`); live sites are matched and
remembered by domain (`www.cresanka.hr` → `cresanka`). Live sites have no debug block labels, so
their notes say "No block found here" and rely on the screenshot and element.

## Use

- Click the pill or press `Alt+Shift+P` to enter point mode. Hover shows the CMS block and the exact element.
- Click to open a note. The project is already chosen: the one you last used on that site, otherwise the one matching the site's URL. Only when nothing matches clearly does it ask. Type what's wrong and press **Enter**.
- Next to the project, the person picker starts on the default assignee from the options page. Pick anyone else in the workspace, or no one, and that choice stays for the next notes on the page.
- Toast shows **Open in ClickUp** and a 10-second **Undo**.
- The **×** in the note's corner or **Esc** closes the note and keeps what you typed. **Esc** again leaves point mode.
- Pointer in the way of something on the page? Drag the pill to any corner. While you drag, a line runs to the
  nearest corner and a ring marks where it will land; let go and it settles there (Esc puts it back). The
  corner holds on every site and in every open tab, and Publish task, the recording bar and the review
  sheet go with it. A press that doesn't move is still a click (`src/content/dockdrag.ts`).

An easter egg, left out of the install guides on purpose: spin the pill round in quick circles while
dragging it (about a turn and a half a second, any size of circle) and after a couple of seconds it
starts throwing confetti, more of it and further the longer it spins, until it can't keep still. It
keeps throwing while it's dragged about, and held still for 3 seconds it throws one last handful and
stops. Let go, it stops throwing at once and every piece starts fading as it falls, gone a second later.
The physics is `src/shared/spin.ts` (unit-tested), the confetti `src/content/confetti.ts`: canvas
pieces that tumble and flutter down, drawn only while there are any. Off with reduced motion.

Turn on **Review the rewrite before creating the task** in the options to see the task's name and its whole description, exactly what goes to ClickUp (Markdown, page link, block, original note and footer included), and change either before it's created. Enter in the name or Ctrl+Enter anywhere creates it; Esc goes back to the note. Page tasks get the same review when you press **Publish task** (see below).

### Page task (several notes, one task)

Turn on **Enable Page Specific Task** in the options to collect a page's notes before anything goes to ClickUp:

- The launcher reads **Page task** with an orange ring, and a **Publish task** button with a count sits next to it, so the mode is plain on every page.
- Click, write, Enter: the note is kept with its screenshot, and a numbered pin stays on the spot. Point mode stays on for the next one.
- Click a pin to change its note or **Remove note**. Hovering a pin shows its text.
- **Publish task** creates one task titled after the page ("Superior room Changes", from the first part of the page title), with every note numbered in order: rewritten text, block, element, original wording, and its screenshot attached as `pointer-<n>-<block>.png`. The toast has **Undo**, which deletes the task and puts the notes back.
- Notes are saved per page (host and path, ignoring query and hash), so they survive reloads and client-side navigation. Branch previews count as separate pages. The options page lists pages with notes waiting, with **Discard**.
- Each note is rewritten in the background as soon as it's added, so publishing is quick; any that failed are rewritten again when publishing. With *Review the rewrite* on, **Publish task** first opens the page task's name and description in a sheet above the dock for a last edit; Esc goes back and keeps the notes.
- Turning the mode off doesn't lose anything: a page with notes waiting still shows its pins and Publish task, while new notes become tasks straight away.

The manifest asks for `unlimitedStorage` for this, because full-resolution PNGs pass Chrome's 10 MB storage quota after a few notes. Firefox lists it at install as "Store unlimited amount of client-side data".

### Screen recording (for what a screenshot can't show)

**Record screen**, under a note's text, records the page: a glitch, a flicker, an animation that
goes wrong.

- Chrome and Edge ask "Allow … to see this tab?": only this tab is recorded. Firefox and Zen ask which
  window or screen to share. The page has to be https (or localhost) for the browser to allow it.
- While it records, Pointer steps aside: the note, pins and launcher hide, and the page gets its clicks
  and keys back, so you can make the problem happen. A small bar shows the time; **Stop**, Esc, the
  browser's own "Stop sharing", or the 30-second limit end it.
- The note comes back with the recording to play, **Retake** or **Remove**. It stays with the note like
  the text does: closing the note keeps both.
- It goes out with the note *instead of* a screenshot: a note with a recording has no screenshot. On a
  task it's attached as `pointer-<block>-<time>.mp4` (or `.webm`) and named on a **Video** line in the
  description. A page-task note keeps it until Publish task and attaches
  it as `pointer-<n>-<block>.mp4`. In Comment Mode it's attached to the task and named in the comment.
- Light by design: the browser's own capture and encoder at 15 frames a second, at most 1600×1000 and
  1.5 Mbit/s; hardware H.264 (MP4) in Chrome and Edge, VP8 (WebM) in Firefox. Nothing is re-encoded;
  30 seconds is about 5 MB. Uploads wait up to 2 minutes.
- In Chrome and Edge, one picture size from start to end. A shared tab changes size: they add their
  "Sharing this tab" bar just after sharing starts, which makes the page shorter, and resizing the
  window does it again. Recorded straight, the MP4 keeps the first size, and every frame after the
  change has a green or garbled strip along the bottom (0.6.1). So an MP4's frames go through a canvas
  of one size (`src/content/fixedsize.ts`): recording starts once the capture has settled (about half
  a second, for the bar), and a frame of another size after that is scaled to fit, on black. That's
  one canvas draw per frame. Firefox's WebM copes with a size change by itself (the picture just
  changes size), so it records the capture as it comes.

### Comment Mode (add to open tasks)

Turn on **Comment Mode** in the options, and a note about something that already has an open Pointer
task goes on that task as a comment instead of making a new one:

- **Without page tasks:** a task about the same block on the same page (and environment). A block
  label's number (`[Hero - 12]`) is the block's type, so the same block on another page is a different
  thing and gets its own task. A page task with a note on that block counts too; a task about the block
  alone wins.
- **With page tasks:** the page's open page task. The note goes on it straight away; there's nothing to
  publish.
- Only open tasks tagged `pointer` count ("open" = not done or closed). Pointer keeps them in a local list
  (`taskIndex` in the extension's storage): id, title, and the page, environment and blocks each one is
  about, read from the lines every Pointer task already has (the page link, `Environment`,
  `Block Name · #id`, and "· N notes" on page tasks). So tasks made before Comment Mode existed, and by
  other people, are found too.
- The list comes from one ClickUp query for the space's open tasks tagged `pointer` (the tag and status
  are checked again locally), made when there's no list yet or it's over 15 minutes old, and refreshed
  quietly after 2. Notes answer from it instantly. Tasks Pointer makes go in at once; tasks deleted with
  Undo, or found closed, come out. Matching is limited to the lists in the project's folder, because
  tasks move on from Development (to QA, say).
- Before a comment goes on a task, Pointer checks that one task is still open. If it was closed in the
  meantime, the note says so, keeps your text, and Enter makes a new task instead.
- A task whose description was edited so those lines are gone isn't matched; a new task is made instead.
- The note says where it's going before you send it ("Adds a comment to *Task name*"), with **New task
  instead** for when it's a different problem. While commenting, the person picker is off: the task keeps
  its assignee.
- The comment is the rewritten note in plain text (ClickUp's comment API takes no Markdown), with the
  page, environment, block, element and original note. The screenshot is attached to the task (comments
  can't hold files through the API) under the name the comment gives.
- **Undo** deletes the comment. The screenshot stays in the task's attachments: ClickUp's API can't
  delete attachments.
- With *Review the rewrite* on, the comment's text is shown for a last edit first.
- The lookup starts when the note opens, so it's usually done by the time you press Enter. If ClickUp
  is still answering, the note says "Checking ClickUp for an open task…"; Esc (or the Pointer button)
  stops the wait and gives the note back, and after 8 seconds it goes ahead without the check (a new
  task, or a page-task note) and the toast says so. Every ClickUp call gives up after 20 seconds
  (60 for screenshots), so nothing waits forever.
- Live sites have no block labels, so without page tasks their notes always make new tasks.

### SEO check (the page as Google reads it)

The **SEO** button beside Pointer opens a panel beside the dock, like the page task's review, and
checks the page. It works wherever Pointer runs, before ClickUp is connected too. **SEO checker** in
the options turns it off.

- **What it reads**: the page as it is (head, headings, images, links), and what Google fetches with
  it: the page again (its status, its `X-Robots-Tag` header, the HTML before scripts run),
  `robots.txt`, the sitemap (on staging its own first, since its `robots.txt` names the live one; an
  index's sitemaps until the page turns up), the share image, and on staging the page without
  cookies, which says whether Vercel's login keeps strangers and Google out. Files on the page's own
  site are fetched as the page, so a staging site's Vercel login lets them through; files on other
  sites go through the background, without cookies. Nothing goes to Z.ai.
- **Judged by where the page is**: hidden from Google (`noindex`, `robots.txt`) is right on staging
  and wrong on a live site. On staging the canonical and hreflang rightly name live addresses, so only
  paths are compared. A staging page that itself asks not to be indexed (meta robots, from the CMS) is
  flagged, because the live page will say the same.
- **The checks** (`src/shared/seo/checks`, unit-tested): the page's answer and redirects; `noindex`
  and `nofollow`; tags only added by scripts; `robots.txt` by Google's rules (its group, the longest
  rule, `*` and `$`); the sitemap; the canonical (missing, empty, several, relative, another domain,
  the home page, another language's version); the title and description, measured in Google's fonts
  and cut in the preview where Google cuts them; a title or description that other pages of the site
  checked before share (that's how a site's default description shows up); `<html lang>` and hreflang
  codes (`cz` and `dk` aren't languages, `se` is Northern Sami and `si` Sinhala; the browser's own
  language data, `Intl`, says which codes exist, so there's no table to keep up); the H1 and heading
  levels; images without alt text (an empty alt only counts on a picture big enough to be content);
  links without text; the share image and tags; JSON-LD; the viewport, https and a favicon.
- **Findings**: *to fix*, *to improve* and *good to know*, then the passed checks folded into one
  line. Each says whether the whole site has it (the template or the site's setup) or only this page,
  and whether it's fixed in the CMS or in the code. Unfolded: what it found (images with their CMS
  block on builds with block labels), why it matters, how to fix it. **Show** scrolls to an image,
  heading or link and rings it on the page. The SEO button counts what's to fix or improve.
- **Check links**, only when pressed: each link to this site (from staging, also to the live site its
  canonical names), once, four at a time, at most 200. Broken ones are to fix, redirects good to know.
- **Send to ClickUp**: the ticked findings (to fix and to improve start ticked) become one task,
  "‹page› SEO", in the page's project, for the person picked (the default assignee unless changed),
  tagged `pointer`, `seo` and the environment. Nothing is rewritten: the findings are written to be
  read. *Review the rewrite* shows the task's text first; Undo deletes it. Comment Mode never puts a
  note on an SEO task (it has no `Block` line and no note count).
- **Remembered** (`seoSites` in the extension's storage): each checked page's title and description,
  and which findings went into which task: the whole site's by kind, a page's by kind and page. A
  later check, on any page of the site, starts those unticked with a link to the task until it's
  closed or deleted, so checking a second page doesn't send the site's hreflang codes again.

### Send to ClickUp (client emails, in Gmail and HubSpot)

Under an open email in Gmail, after Reply, Forward and the emoji button, sits a gold **Send to
ClickUp** button the size and shape of Gmail's own: it copies Forward's height, corners, type and
spacing when it's placed (`src/mail/pointer.ts`). It's there while the conversation has an
expanded email, and only what's expanded is read: the latest email by default, earlier ones once
they're expanded. Trimmed quotes ("…"), collapsed messages, icons and tracking pixels stay out.

On a ticket in HubSpot's Help Desk the same button sits left of the ticket's **Actions** button,
sized like it (`src/hubspot`). It reads the ticket's conversation: the client's emails are split,
bid's agents' replies are context. What HubSpot shows about the ticket goes in too:

- the ticket's **name** stands in for the subject, so a project named in it is recognized
  ("Redirekcijski lanac Lumen" → Lumen), and the contact's **company** counts like a client name;
- each task links the ticket's **record** (`#100200300400`) and names its company, category and
  owner;
- the ticket's **owner**, when ClickUp has someone by that full name, gets the tasks Mate shouldn't
  take (instead of whoever pressed the button);
- a ticket marked **High** or **Urgent** makes every task high priority;
- tasks are also tagged `hubspot`.

HubSpot shows a sender's name but not their address; a message from the ticket's contact gets the
contact's address. HubSpot draws long conversations as a virtual list, so the messages it has on
the page are what's read. Its file links redirect to its file server; when that won't let the page
read a file, the extension's background fetches it with the person's HubSpot session (for HubSpot's
own servers only, `isHubSpotFileHost`). The page hooks are HubSpot's own test ids, listed in
`src/hubspot/read.ts` and taken from a saved ticket page; files attached to a message (not inline)
follow HubSpot's code, not a real page, and are the first thing to check if one goes missing.

- **Splitting** is GLM's, as for note rewrites (`src/shared/email.ts` has the prompt and the
  checks): atomic points, one change each, with the client's words quoted as written and an
  English instruction. Greetings, thanks and sign-offs aren't points. Questions to bid ("when will
  the spa page be live?") are listed to answer, not made into tasks. Every quote is checked against
  the email, and links the email doesn't contain are dropped. A point keeps the other links it needs
  ("the list of links is below": a spreadsheet, a document) as **Links**; GLM also names the images
  that are only decoration (logos, signature pictures), which stay off the tasks.
- **Grouping** is rules, not the model (`planTasks`): the same page and kind of work, or the same
  component on several pages, go together, and never across people. Vague points, and anything
  about booking, prices or legal text, are tasks of their own; a group over 6 points is split; a
  point that names no page or element stays alone.
- **Who gets it**: with **This is a coding agent** off (a fresh install), every task goes to the
  default assignee. With it on (bid: Mate), `src/shared/routing.ts` decides, the one place to change
  as Mate's access grows. Mate only gets a clear, small change in a named place, of a kind it
  can make; everything else goes to whoever pressed the button, with the reason shown in the review.
  Mate can't edit the CMS yet (`mateEditsCms: false`), so content and image changes go to a person
  for now. If the ClickUp token in Pointer is Mate's own, "whoever pressed the button" would be Mate,
  so those tasks go to the default assignee instead, or to no one (`routeAssignees`).
- **Files**: every image in the email (inline ones as the original file, not Gmail's resized
  copy) and every attachment goes on the task its point belongs to; any no point claims goes on
  every task, listed as "Other images from the email", so none is lost. They're downloaded the way
  Gmail does (page requests with Gmail's cookies; `content.fetch` in Firefox) and uploaded one at a
  time once the tasks exist. A file over 25 MB, or one that didn't download, is left off and named
  in the toast.
- **Project**: recognized from the email (`recognizeProject` in `src/background/projects.ts`): a
  project's name in the subject, a link to its site (staging, live, or its GitHub repository), an
  address at its domain in the text (so forwards count), the sender's domain, the client GLM names,
  or its name in the text or tasks. Names match the way people write them: without "hotel",
  run together ("suncanihvar"), with Croatian endings ("Cresanke"). Each kind of evidence counts
  once; the best project has to beat the rest, or the picker asks. The subject or a link beats the
  sender's remembered project; weaker hints only fill in when nothing is remembered. The picker's
  line says why it chose.
- **Remembered**: the chosen project, per sender domain (per address for webmail such as gmail.com),
  but never for bid's own domains (bid.hr, bid.agency: they write about every project), and not when
  the email itself named the project, which may be a one-off. With review off, a sender Pointer
  hasn't met, or an email pointing away from the sender's usual project, is shown first; otherwise it
  goes straight in.
- **Progress**: with *Review the rewrite* on, the review opens the moment the button is pressed and
  shows the steps with a bar (read, copying the images, GLM's split, which takes about 15 seconds);
  Esc closes it and the tasks wait for the next press. Otherwise the toast carries the bar, and it
  fills again while the tasks are made and their files attached.
- **Review**: a sheet over most of the window, Gmail dimmed behind it. Each task is one compact row:
  name, then person, priority and due date as chips (the date chip opens Pointer's own small
  calendar, with Today, Tomorrow, In a week and No due date; the browser's date picker doesn't open
  reliably inside Gmail),
  then two round buttons: the pencil opens the whole Markdown description (so does clicking the
  task's summary), × leaves the task out and the arrow puts it back. Under the line: its
  instructions in a few lines and its files. Esc closes the sheet and keeps the edits; pressing the
  button again reopens it without asking GLM again.
- **People in the review**: the tasks after the first get the first task's person and follow it
  when it changes; picking a person on any other task unlinks that one for good
  (`inheritAssignees`). A task the rules keep from Mate never follows the first one to Mate; it keeps
  its person. Each task's line under the pickers says whether it follows. With review off, every
  task keeps the person its own rules picked.
- **Each task** starts with an email line linking back to the conversation (`#all/<id>`, for whoever
  logged it) and the subject; priority is High when the client's words say it's urgent, and a due
  date is set when one is named. Then come the points, in the page-task shape Mate already works
  through. Tags: `pointer`, `email`, plus `needs-clarification`, or `needs-rewrite` when GLM couldn't
  split the email and it went as one task with the whole text.
- **Sent already**: messages are remembered by Gmail id (`emailSent` in storage: ids and task links,
  no content). The button then reads **Sent to ClickUp** and offers the tasks, or Send again. A
  later reply in the same conversation is new, so only it is split, with the earlier ones read as
  context; bid's own replies are context too.
- Nothing is read or sent before the button is pressed. The email's text goes to Z.ai and ClickUp;
  its images and files only to ClickUp. Undo deletes every task it made.
- Gmail's markup is obfuscated: `src/gmail/read.ts` lists the long-lived hooks it reads (the ones
  InboxSDK and gmail.js rely on). If Gmail changes them, the button doesn't appear; nothing is
  misread. The Gmail UI is built without `innerHTML`, which Gmail's Trusted Types would refuse.

## Develop

```
pnpm dev          # rebuilds dist/ on change; click "Reload" on the extensions page to pick it up
pnpm typecheck
pnpm test         # pure logic: slug parsing, model-output sanitizing, description format, suggestions,
                  # and the SEO check's rules (tests/seo-rules.test.mjs, seo-checks.test.mjs)
pnpm smoke        # real Chrome (or `pnpm smoke:edge`) against tests/fixture: every UI state, the
                  # error paths with fake keys, and the happy path with ClickUp and Z.ai mocked in the
                  # service worker; a screenshot of each state lands in tests/out/ for visual review
                  # add --dir=<folder> to test an unzipped package instead of dist/
                  # also walks Send to ClickUp on a stand-in Gmail conversation and HubSpot ticket
                  # (tests/fixture/gmail.html and hubspot.html, served at mail.google.com and
                  # app-eu1.hubspot.com by request interception)
                  # and the SEO check on a stand-in staging page with planted problems
                  # (tests/fixture/seo.html; the walk through is scripts/seo-check.mjs, shared by
                  # both suites)
pnpm smoke:firefox  # the same main path in real Firefox (dist-firefox/), screenshot upload included
                    # add --dir=<folder> to test another build (its manifest needs the gecko id)
pnpm lint:firefox   # Mozilla's add-on linter; signing needs 0 errors (the innerHTML warnings are
                    # templates whose values all go through esc())
```

Every change goes into every build. Run `pnpm smoke`, `pnpm smoke:edge` and `pnpm smoke:firefox`
before shipping. Nothing here can drive Safari: its scripts are the Chrome build's, and the one thing
only it has, a background page that uses `chrome.*`, is what Firefox's Manifest V3 runs too, so
`pnpm smoke:firefox --dir=` on a copy of `dist-safari/` with the gecko id added covers that much.
Anything WebKit itself does differently needs a Mac.

Reload Pointer on the extensions page after replacing its files, including when it's loaded straight
from `dist/` and you rebuild. The browser picks up a new page script on the next page load but keeps
the old background running until a reload, and an old background silently drops what it doesn't know
(that's how recordings went missing in 0.6.0). Every build stamps both with one id (`BUILD` in
`build.mjs`); when they differ, the launcher reads **Reload Pointer** and nothing is sent.

The screen-recording checks run in Chrome and Edge only, on Chrome's synthetic test screen
(`--use-fake-device-for-media-stream`). Under automation Firefox shares the real monitor, so its run
only checks that Record screen is offered. All three also record a canvas that changes size halfway
through `fixedSize()` (`scripts/recording-check.mjs`), decode the result and check every frame keeps
one size and its bottom edge. Firefox doesn't use it today (WebM), but would the day it records MP4.

### One source, three builds

`build.mjs` builds `src/` three times:

- `dist/`: Chrome and Edge, Manifest V3, from `manifest.json`.
- `dist-firefox/`: Firefox and Zen, **Manifest V2**, generated by `firefoxManifest()`. In Firefox's
  Manifest V3, screenshots only work with `activeTab`, which Firefox grants for the toolbar button and
  the shortcut but not for Pointer's own button on the page. In V2 the all-sites permission covers it.
  Mozilla has no plans to retire V2. The build also swaps `chrome.*` for Firefox's promise-based
  `browser.*`, and declares the data Pointer sends to ClickUp and Z.ai, as Mozilla requires. Firefox
  140 and later ask for the OK on that at install, which is why it's the minimum and why the options
  page doesn't ask again there (Chrome's store wants the extension itself to ask). Browser and window
  size are optional, and tasks leave them out for people who decline.
- `dist-safari/`: Safari 17 and later, Manifest V3, generated by `safariManifest()`. Safari runs
  Chrome's manifest and Chrome's promise-based `chrome.*` as they are; the build swaps the service
  worker for a background page (Safari's own template's form), drops Chrome's `key`, and lists 512
  and 1024 px icons, which Apple's packager needs for the Mac app's icon. Safari has no page for
  changing extension shortcuts, so the options page hides **Change shortcut** there.

Every build is told its browser (`__POINTER_BROWSER__`) and its build id (`__POINTER_BUILD__`, the
version plus a hash of the sources, `scripts/source-hash.mjs`). Nothing in the output depends on the
folder it was built in, so the same sources always give the same files.

Layout: `src/content` (page UI: `view.ts` markup, `ui.css` styles, `index.ts` behaviour), `src/mail`
(Send to ClickUp: `pointer.ts` the button, review and sending, `read.ts` turning a message into text),
`src/gmail` and `src/hubspot` (each app's `read.ts` reads its page, `index.ts` says where the button
goes and how files download), `src/background`
(screenshot, Z.ai, ClickUp, `email.ts`), `src/options`, `src/shared` (pure logic, `email.ts` and
`routing.ts` included), `src/styles` (shared styles). The SEO check has a folder in each layer:
`src/shared/seo` (its rules, one file per area of checks under `checks/`), `src/content/seo`
(reading the page, the panel, its styles) and `src/background/seo` (fetches across sites, what's
remembered, the task). Files stay small: a feature gets its own modules, and the big files only
get the lines that call into them.

## Design

- **Tokens** live once, in `src/styles/tokens.css`: the bid palette and gold gradient from
  `bid-web/src/styles/globals.css`, plus a few derived shades so small text passes contrast.
  `base.css` is the reset and `controls.css` holds buttons and keycaps. Both the shadow-root styles
  (`src/content/ui.css`) and the options page (`src/options/options.css`) import all three.
- **Type** is Gilroy, four weights in `fonts/` copied from `bid-web/public/fonts`. Only things you press
  use bid's bold tracked capitals; everything you read is sentence case.
- **The pin** is the signature: a comment pin whose sharp corner sits on the clicked spot. It marks
  the spot on the page, heads the note, and the same mark is drawn into the attached screenshot
  (`src/background/capture.ts`, which repeats the token values because canvas can't read CSS).
- Primary buttons use the gold gradient with ink text rather than bid-web's white, which is about 2:1.
- Styles reach the page through a constructed stylesheet and fonts through the FontFace API, so a
  site's style-src CSP can't strip them.

The debug block label (`[Name - id]`) rendered by `DebugBlock.tsx` in the pages template is what Pointer reads; it is only present on builds with `NEXT_PUBLIC_DEBUG=true`.

### The style as a skill, for other extensions

[`skills/bid-extension-style/`](skills/bid-extension-style/SKILL.md) is a Claude skill that applies
this look to another extension: the shared token, reset and control CSS (copied unchanged; a unit
test fails if they drift from `src/styles`), ready stylesheets for extension pages and for on-page
UI in a shadow root, popup and options templates, and the rules behind them. To use it, copy the
folder to `~/.claude/skills/bid-extension-style/` (or a project's `.claude/skills/`), then ask Claude
to "make my extension look like Pointer". The Gilroy files aren't in the skill; it points to
bid-web's `public/fonts`.
