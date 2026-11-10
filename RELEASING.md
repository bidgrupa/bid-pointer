# Releasing bid Pointer

Releases are made by the [Release workflow](.github/workflows/release.yml), as for webpify. A tag
builds, tests and packages everything and attaches the packages to a GitHub release. Once the stores
are set up, the same tag also submits the version to addons.mozilla.org and the Chrome Web Store.
Colleagues install by following [INSTALL.md](INSTALL.md).

Putting Pointer in the stores the first time is described in [docs/public-release.md](docs/public-release.md).

## What a release contains

| File | For |
|---|---|
| `bid-pointer-chrome-<v>.zip` | The Chrome Web Store and Edge Add-ons. Also Chrome and Edge without a store: unzip and "Load unpacked". |
| `bid-pointer-firefox-<v>-unsigned.xpi` | addons.mozilla.org, which signs it. Without a store, Firefox and Zen only take it as a temporary add-on. |
| `bid-pointer-safari-<v>.zip` | App Store Connect's packager, or Safari's "Add Temporary Extension…" for a day. |
| `bid-pointer-source-<v>.zip` | The source at the tag. Mozilla's reviewers rebuild the Firefox add-on from it. |

## Making a release

1. **Bump the version.** Use the same number in `manifest.json` and `package.json`, e.g. `1.0.1`. The stores take each version number once, and only higher ones.
2. **Commit, tag and push.** Give the commit a short message body saying what changed, written for users: addons.mozilla.org shows it as the version's release notes.
   ```bash
   git commit -a -m "Release 1.0.1" -m "Setup codes keep the Z.ai key out unless you ask for it."
   git tag v1.0.1
   git push origin main v1.0.1
   ```
   The tag must be `v` plus the manifest version, or the workflow stops.
3. **Wait for the workflow.** The **Release** run on the repository's **Actions** tab takes a few minutes. It:
   - checks that the tag, `manifest.json` and `package.json` agree
   - typechecks and runs the unit tests
   - builds every browser and packages the four files above
   - submits the Firefox package to addons.mozilla.org, once that is set up (below)
   - creates the GitHub release with notes saying which file is for what
   - submits the Chrome package to the Chrome Web Store, once that is set up (docs/public-release.md)
4. **Tell the team.** People who installed Pointer from a store get the update by themselves once the store approves it; everyone else follows "Updating" in INSTALL.md.

**Trying a build without releasing:** on the **Actions** tab, open **Release**, click **Run workflow**, and download the packages from the run's **Artifacts**. Nothing is published, submitted or signed.

**Building the packages locally:** `pnpm release` typechecks, tests, builds and packages everything into `release/`. The source zip is built from the last commit, so commit first.

**Before a release, also run the browser tests** (they need a desktop browser, so they don't run in the workflow): `pnpm smoke` (Chrome), `pnpm smoke:edge`, `pnpm smoke:firefox`. Every change goes into every build.

## addons.mozilla.org

Pointer is listed on addons.mozilla.org (AMO) from 1.0.0. The first listed version goes in by hand ([docs/public-release.md](docs/public-release.md#addonsmozillaorg)); after that, every tagged release is submitted by the workflow:

1. The keys are those of BID's AMO account, the one that owns webpify and, after the handover in [docs/public-release.md](docs/public-release.md#0-move-the-add-on-to-bids-account-once), `pointer@bid.hr`. An account has one pair, so if webpify's repository already has them, use the same values: generating new ones (**Tools → Manage API Keys**, <https://addons.mozilla.org/developers/addon/api/key/>) revokes the old pair, and webpify's secrets would need the new ones too.
2. Add them only after 1.0.0 has gone in by hand: set before the v1.0.0 tag, the workflow would try to submit 1.0.0 itself, without the listing text. In the GitHub repository, **Settings → Secrets and variables → Actions → New repository secret**:
   - `AMO_JWT_ISSUER`: the "JWT issuer" value
   - `AMO_JWT_SECRET`: the "JWT secret" value
   - `AMO_TEST_ACCOUNT`: the review test account, as reviewers should read it (ClickUp login, password and API token). It's appended to the approval notes, so it never sits in the repository.
3. From the next tagged release on, the workflow submits the Firefox package as a listed version, with the source zip, the release commit's message body as release notes, and [store/firefox/approval-notes.txt](store/firefox/approval-notes.txt) for the reviewers. It doesn't wait: Mozilla reviews and signs the version, then Firefox updates installed copies within a day.

Things to know:
- **Each version number can be submitted only once**, in either channel (0.2.0–0.10.0 were signed unlisted). If a release needs fixing, bump the version and tag again. That's also why manual workflow runs never submit.
- **Mozilla may review a version by hand.** Reviewers rebuild from the source zip, following the approval notes and "Building from source" in the README.
- **No `update_url`.** AMO refuses it on listed add-ons and handles updates itself, so the Firefox build has none.
- **The workflow refuses to submit while [PRIVACY.md](PRIVACY.md) has TODOs.**
- `pnpm sign:firefox` still signs an unlisted copy by hand, for private distribution.
