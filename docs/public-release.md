# Public release: Chrome Web Store and addons.mozilla.org

Releases are GitHub releases ([RELEASING.md](../RELEASING.md)). This page covers putting Pointer in the
browser stores the first time, so anyone can install it with one click and get updates
automatically. It follows what webpify did (`github.com/bidgrupa/webpify`, docs/public-release.md),
including a public repository, so the GitHub link to PRIVACY.md is the privacy policy.

## Plan

| Browser | Channel | Why |
|---|---|---|
| Chrome, Edge | Chrome Web Store, **Unlisted** | Anyone with the link can install it (BID's people and clients), it doesn't show up in search, and updates install automatically. Edge users install from the same link. As for webpify. |
| Firefox, Zen | addons.mozilla.org, **listed** | AMO has no link-only option: an add-on is either listed (public, searchable) or self-distributed, which needs an update feed of bid's own for updates. Listed, as for webpify, gives one-click installs and automatic updates from AMO. The add-on ID `pointer@bid.hr` already exists with unlisted versions, so the copies colleagues have update from the listing and keep their settings. |
| Safari (Mac) | not yet | The Mac App Store needs an Apple Developer membership as an organisation, an Xcode project and App Review. webpify's docs/public-release.md, "Mac App Store", is the way when it's time; `bid-pointer-safari-<v>.zip` is already in every release. |

## Before the first store submission

- **Public repository.** The privacy policy is [PRIVACY.md](../PRIVACY.md) at `https://github.com/bidgrupa/bid-pointer/blob/main/PRIVACY.md`, which opens for reviewers only once the repository is public: see [Making the repository public](#making-the-repository-public). Every build also renders it into `privacy.html`, which Pointer links from its settings. The release workflow refuses to submit while PRIVACY.md has a TODO.
- **Review test account.** Reviewers can only get past Pointer's setup with a ClickUp token, so they get one of their own:
  1. Sign up at clickup.com with a BID address that isn't a person's (an alias such as `pointer-review@bid.agency`), on the free plan. Its API is enough: 100 requests a minute.
  2. Name the workspace "Pointer Review". Give it one space, "Review", holding one folderless list, "Hotel Pointer" (the demo site's hotel). Delete anything ClickUp adds on its own, so the space has just that list.
  3. Settings › Apps › API Token › Generate. Keep the login and the token in BID's password manager.
  4. The login and token go in the Chrome dashboard's Test instructions and in the `AMO_TEST_ACCOUNT` secret, never in the repository.

  Not a guest in BID's own workspace: the token goes to Google's and Mozilla's reviewers (and to Mozilla again with every version), Pointer's person picker would show them BID's members, and their test tasks would land among real ones. A separate workspace has nothing to leak.
- **Demo page.** Reviewers try Pointer on [demo/index.html](../demo/index.html), a made-up hotel's staging site with four CMS blocks, published at <https://bidgrupa.github.io/bid-pointer/> by the **Demo page** workflow. Turn it on once: **Settings → Pages → Build and deployment → Source: GitHub Actions**, then run **Demo page** from the Actions tab (later it redeploys whenever `demo/` changes) and check that the address opens. The reviewers' instructions give them a setup code that adds that site to Pointer's sites, so Pointer starts there by itself; the code holds no token or key.
- **Listing text.** [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) has the description, single purpose, permission justifications and data-use answers, ready to paste; [FIREFOXADDONS.md](../FIREFOXADDONS.md) the same for AMO.
- **Graphics.** The store icon is built (`icons/store-128.png`). Five 1280×800 screenshots and the 440×280 promo tile are in `store/chrome/`; `pnpm screenshots` renders them again after a UI change.
- **Licence.** Pointer is All Rights Reserved (`"license": "UNLICENSED"` in package.json, and [LICENSE](../LICENSE)) unless bid decides otherwise: the code is public to read, not to reuse. Nothing in it requires an open licence.
- **Accounts.** All owned by BID, not a person, and the same as webpify's where they exist:
  - the Chrome Web Store publisher (one-time fee) with colleagues as members and a monitored contact email
  - BID's addons.mozilla.org account, the one that owns webpify. The earlier, unlisted versions of `pointer@bid.hr` were signed from another account, which first makes BID's account an owner: see [Move the add-on to BID's account](#0-move-the-add-on-to-bids-account-once).

## Making the repository public

The privacy policy, homepage and support links all point at the repository, so it goes public before
the first submission. Two things first:

1. **No personal data in it.** The test data used to hold a real HubSpot ticket (a client contact's
   name, phone and email, her request, a Google Sheet link) and colleagues' names. They're now made up
   (Lea Novak at Seaside Marketing, Tea and Leo Babić, the hotel "Lumen", ticket `#100200300400`).
   Keep it that way: fixtures copied from real pages get their names, addresses and links replaced
   before they're committed.
2. **No history.** The commits before the clean-up still contain that ticket, so the public repository
   starts from one fresh commit, and the old history stays private:
   1. On GitHub, rename this repository, e.g. to `bid-pointer-private` (**Settings → General**). It keeps
      its history and stays private.
   2. Create a new, empty, **public** repository `bidgrupa/bid-pointer` (no README or licence).
   3. From an up-to-date checkout of `main`, with everything committed:
      ```bash
      git checkout --orphan public
      git commit -m "bid Pointer 1.0.0"
      git remote add public https://github.com/bidgrupa/bid-pointer.git
      git push public public:main
      ```
   4. Clone the new repository and work there from now on. Set its Actions secrets and variables
      again (RELEASING.md, docs above), and check that `https://github.com/bidgrupa/bid-pointer/blob/main/PRIVACY.md` opens in a
      private window.

   Rewriting the history in place (force-pushing `main`) isn't enough: GitHub keeps old commits
   reachable by their IDs and in pull requests until its support purges them.

The internal details that stay in the code are fine to publish: bid's ClickUp space and list IDs,
Mate's account ID (src/background/migrate.ts) and bid's client names as examples. No keys or tokens
were ever committed.

## Chrome Web Store

The first version goes in by hand. After that, the release workflow's `chrome-web-store` job submits every tagged release ([scripts/chrome-web-store.mjs](../scripts/chrome-web-store.mjs)), and Chrome updates installed copies within hours of Google approving it. Everything to paste is in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md).

### 1. Prepare (once)

1. **Publisher.** Use BID's existing publisher, webpify's. An account can only ever have one publisher, and its name shows on the listing. If there's none yet: a BID-owned Google account with 2-Step Verification, the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), the developer agreement and the one-time fee.
2. **Publisher settings:** name (BID grupa), a verified contact email someone reads, the trader declaration (EU rules, see "Developer info" in CHROMEWEBSTORE.md), and colleagues as members.
3. **Package.** Make a release (RELEASING.md) and download its `bid-pointer-chrome-<v>.zip`. It has no `key`: the store gives the item its own ID.

### 2. First submission (by hand)

1. Dashboard → **Add new item** → upload the zip. Write down the item's 32-letter **item ID**.
2. **Store listing** tab: the description, category and language from CHROMEWEBSTORE.md, the store icon, the screenshots, the small promo tile, and the homepage and support URLs.
3. **Privacy** tab: the single purpose, a justification for each permission and for the host permission, remote code "No", the data-use boxes and certifications from CHROMEWEBSTORE.md, and the privacy policy URL.
4. **Distribution** tab: free, visibility **Unlisted**, all regions.
5. **Test instructions** tab: the test account's login, and the instructions from CHROMEWEBSTORE.md with its token filled in.
6. **Submit for review.** Leave automatic publishing after review on, or turn it off to publish by hand. Reviews take a few days, longer for a new item with access to all sites. Google emails the contact address.
7. **Once it's published**, the listing is at `https://chromewebstore.google.com/detail/<item ID>`:
   - Put the link in INSTALL.md and in the release notes in `.github/workflows/release.yml`.
   - Optionally put the item's public key (Package › View public key) in `manifest.json` as `key`, so unpacked development builds share the store's ID.
   - Colleagues with an unpacked copy switch over (INSTALL.md, "Switching from an unpacked copy"). The store copy has another extension ID, so its settings start empty; a setup code fills them in.

### 3. Updates on every release (once)

1. **Google Cloud project.** In the [Google Cloud console](https://console.cloud.google.com/), use webpify's publishing project or create one, then **APIs & Services → Library → Chrome Web Store API → Enable**.
2. **Service account.** **IAM & Admin → Service accounts → Create service account** (no roles). **Keys → Add key → Create new key → JSON**. The file downloads once. (A publisher can have one service account, so if webpify already has one, use its key.)
3. **Let it publish.** In the Developer Dashboard's **Account** section, add the service account's email.
4. **GitHub.** Repository **Settings → Secrets and variables → Actions**:
   - Secret `CWS_SERVICE_ACCOUNT`: the whole JSON key file. Delete the downloaded file afterwards.
   - Variables `CWS_PUBLISHER_ID` (Dashboard › Settings) and `CWS_ITEM_ID` (step 2.1).
   - Optional variable `CWS_PUBLISH_TYPE` = `STAGED_PUBLISH`: approved versions then wait until someone publishes them in the dashboard.

From the next tag on, the job uploads the release's Chrome zip and submits it for review. It's skipped while `CWS_ITEM_ID` isn't set. Things to know:
- **Versions only go up.** The store refuses a package whose version isn't higher than the last one uploaded.
- **A newer release replaces one still in review.** The job cancels the older submission and submits the new version.
- **A staged version blocks the job.** Publish or cancel it in the dashboard, then re-run the job.
- **New permissions.** A permission that shows a warning disables Pointer for existing users until they accept it.

## addons.mozilla.org

Like the Chrome Web Store: the first listed version goes in by hand, then the release workflow submits every tagged release, and Firefox updates installed copies from AMO within a day of approval. Everything to paste is in [FIREFOXADDONS.md](../FIREFOXADDONS.md).

### 0. Move the add-on to BID's account (once)

`pointer@bid.hr` was created, and 0.2.0–0.10.0 signed, from the account of the colleague who built Pointer. Pointer moves to BID's AMO account, the one that owns webpify, so its listing, reviews and API keys sit with bid's other add-on. Only an owner can add authors, so the colleague starts:

1. **The current owner** signs in to the [Developer Hub](https://addons.mozilla.org/developers/addons), opens bid Pointer → **Edit Listing** → **Manage Authors & License**, enters the email address of BID's account under "Enter a new author's email address", leaves the role at **Owner** with **Listed** ticked, and clicks **Save Changes**.
2. **BID's account** gets an email invitation. Sign in as that account and accept it; until then it's a pending author and can't upload anything.
3. **Check** that bid Pointer, with its unlisted versions, is under **My Add-ons** for BID's account.
4. **The colleague** can stay on as an author or remove themselves (the ✕ next to their address, then **Save Changes**). The release workflow uses BID's keys either way.

### 1. First submission (by hand)

1. Sign in to <https://addons.mozilla.org/developers/> with BID's account (step 0; two-step authentication on). Open bid Pointer → **Upload New Version** → **On this site** → upload `bid-pointer-firefox-<v>-unsigned.xpi`. Compatibility: Firefox only.
2. **Source code:** Yes → upload `bid-pointer-source-<v>.zip` from the same release.
3. **Describe add-on:** name, summary, description, category, support email and website, licence, privacy policy, and the notes to reviewer with the test account, all from FIREFOXADDONS.md.
4. **Submit.** Listed versions usually pass the automatic review within hours; some get a human review first, which can take days. Mozilla's reviewers rebuild from the source zip; the build is reproducible (below).
5. **Edit Product Page:** the screenshots with their captions, and the homepage.
6. **Once it's public** (`https://addons.mozilla.org/firefox/addon/bid-pointer/`): point INSTALL.md's Firefox section at the listing, and the release notes in `.github/workflows/release.yml`.

### 2. Updates on every release (once)

The API keys and secrets in [RELEASING.md](../RELEASING.md#addonsmozillaorg).

## Reproducible build

Mozilla's reviewers must get byte-identical output from the source zip. This is set up:
- `pnpm-lock.yaml` is committed, `package.json` pins pnpm (`packageManager`), and installs use `--frozen-lockfile`.
- `.gitattributes` keeps every text file LF in checkouts, whatever `core.autocrlf` says, so a Windows build and the workflow's Linux build agree.
- The build id baked into the scripts is the version plus a hash of the sources (`scripts/source-hash.mjs`), not a time.
- Nothing in the output depends on the folder it's built in (`build.mjs` writes project-relative paths).
- The source zip is `git archive` of the tagged commit.

Checked for 1.0.0: rebuilding from the source zip in a fresh folder, with a fresh `pnpm install --frozen-lockfile`, gave a `dist-firefox/` identical to the package.
