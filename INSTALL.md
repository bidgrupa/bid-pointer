# Installing bid Pointer

Pointer works in Chrome, Edge, Firefox, Zen and Safari. Installing takes a minute, and setting it
up another two: you agree to what it sends, connect your own ClickUp account, and paste your team's
setup code.

## Step 1: Install it

### From the stores (once Pointer is published)

- **Chrome or Edge:** open Pointer's page on the Chrome Web Store (⬜ link once it's published) and click
  **Add to Chrome**. Edge asks once to "Allow extensions from other stores": allow it.
- **Firefox or Zen:** open Pointer's page on addons.mozilla.org (⬜ link once it's published) and click
  **Add to Firefox**. Firefox lists what Pointer sends where and asks for your OK. You can leave
  "technical and interaction data" unticked; it only adds your browser and window size to tasks.

The stores update Pointer by themselves.

### From a GitHub release (before the stores, or to try a version)

Download the file for your browser from the release:
- **Chrome or Edge:** `bid-pointer-chrome-<version>.zip`. Unzip it into a folder you'll keep (the
  browser runs Pointer from there). Open `chrome://extensions` (or `edge://extensions`), turn on
  **Developer mode**, click **Load unpacked** and choose the folder.
- **Firefox:** `bid-pointer-firefox-<version>-unsigned.xpi`. Open `about:debugging` → **This Firefox** →
  **Load Temporary Add-on…** and pick the file. Firefox removes it when it restarts.
- **Safari 26 or later:** `bid-pointer-safari-<version>.zip`. Safari › Settings › Advanced: tick
  "Show features for web developers". Then the Developer tab → **Add Temporary Extension…** → the
  zip. Safari removes it after 24 hours or when it quits. In the Extensions tab, select bid Pointer →
  **Edit Websites…** → set "When visiting other websites" to **Allow**.

## Step 2: Set it up

A setup page opens by itself after installing. (Later: click the bid Pointer button in the toolbar
on a page where Pointer isn't running, or open the extension's options.)

1. **What Pointer sends, and where.** Read it and click **I agree**. Firefox asked when you installed it,
   so it skips this.
2. **Connect ClickUp** with your own personal API token. The page walks you through it: open ClickUp's
   Apps settings, copy the token, come back and paste it. When it says "Connected as" and your name,
   you're connected.
   If you already have a token, click **Copy** in ClickUp, not Regenerate. Regenerating replaces the
   old token, and anything else that uses it stops working.
3. **Setup code.** Paste the code your team gave you (a line starting with `PTR1.`), check what it
   sets, and press **Use these settings**. That sets the ClickUp space, the default assignee, your
   sites and, if it's in the code, the Z.ai key. A code never holds a ClickUp token: everyone
   connects their own.

Without a setup code, set those by hand further down the page: **Projects** (the ClickUp space),
**Default assignee**, **Where Pointer shows up** (your sites, your agency's domains) and, if you have
a Z.ai key, **Rewrite with AI**.

**At bid:** ask whoever maintains Pointer for bid's setup code. It holds the company Z.ai key, so keep
it to yourself. (By hand: the space DEVELOPMENT; Mate as the default assignee with "This is a coding
agent" on; the sites `*-staging.vercel.app` and `*-bid.vercel.app`; the agency domains
`bid.agency, bid.hr`; the company Z.ai key.)

## Using it

Pointer sits in the bottom-right corner of your sites, and of live sites whose footer credits your
agency. Click it, click the thing that's wrong, describe it, and press Enter. Alt+Shift+P
(Option+Shift+P on a Mac) does the same as clicking Pointer.

If Pointer doesn't show up on a page, click the bid Pointer button in the browser's toolbar and it
starts there. (Pin it first: the puzzle piece next to the address bar, then the pin next to bid
Pointer. In Firefox, the gear next to it › Pin to Toolbar. In Safari: View › Customize Toolbar.)

### Several notes, one task

Turn on **Enable Page Specific Task** in Pointer's settings. Pointer then reads "Page task" and each
note you send stays on the page as a numbered pin instead of becoming a task. Click a pin to change
or remove its note. When you're done, press **Publish task** next to it: one ClickUp task, named after
the page, with all the notes and their screenshots.

### Moving Pointer

If the Pointer button covers something on the page, drag it to any corner of the window. It stays
in that corner on every site until you move it again.

### Recording the screen

For things a screenshot can't show (a glitch, a flicker), press **Record screen** under the note's
text. The browser asks what to share (in Safari, pick the Safari window with the page); then do what
shows the problem and press Stop (or Esc). You can watch the recording in the note before sending;
it's attached to the task. Recordings stop by themselves after 30 seconds.

### Adding to open tasks

Turn on **Comment Mode** in Pointer's settings. When something you point at already has an open
Pointer task (the same block on that page, or with page tasks, the page's task), your note goes on
that task as a comment. The note tells you which task before you send it, and **New task instead**
makes a separate task.

### Checking a page's SEO

Next to Pointer there's an **SEO** button. Press it and Pointer checks the page the way Google reads
it: whether Google may index it, its title and description (with a preview of the Google result),
its languages, headings, image alt texts, and how a shared link looks. It knows staging should be
hidden from Google and a live site shouldn't. **Show** points at the image or link a finding is
about, and **Check links** looks for broken links. Tick what needs fixing and press the gold **Send**
button: one ClickUp task, named after the page, that says for each finding whether it's fixed in the
CMS or in the code. Findings that are already in an open task start unticked. Don't need it? Turn
off **SEO checker** in Pointer's settings.

### Emails from clients (Gmail and HubSpot)

Open a client's email in Gmail. Under it, next to Reply and Forward, there's a gold **Send to
ClickUp** button. Press it and Pointer turns the email into tasks, with every image and file from
the email attached. With a Z.ai key, it splits the email into tasks: points that belong together go
into one task, each with the client's own words, and questions the client asks are listed for you to
answer. Without one, the email becomes one task. Only the emails that are open are read: expand older
ones in the conversation to include them too.

The first time someone writes, Pointer asks which ClickUp project their tasks go to, then remembers
it. With **Review the rewrite** on, you see every task first and can change it, leave it out, or
untick a file. When the default assignee is a coding agent (at bid, Mate), the tasks it can't take
(design decisions, unclear requests, CMS content, anything about booking, prices or legal text) go to
you instead.

In HubSpot's Help Desk, the same button sits left of a ticket's Actions button and works the same
way, with what HubSpot knows: the ticket's name tells Pointer the project, each task links back to
the ticket, the ticket's owner gets the tasks a coding agent can't take (if ClickUp has someone with
the same name), and a High or Urgent ticket makes the tasks high priority.

## Switching from an unpacked copy (Chrome and Edge)

The store copy has its own extension ID, so it doesn't replace a copy loaded with "Load unpacked":
both would run, and the store copy starts with no settings.
1. Publish any notes still waiting on a page task (Pointer's settings list them).
2. Remove the unpacked bid Pointer on the extensions page, then install from the store.
3. Set it up (Step 2): agree, connect ClickUp, paste the setup code.

Firefox and Zen copies installed from a signed file update from addons.mozilla.org by themselves
and keep their settings. They only need the Z.ai key, if they used the one that used to be built in.

## Updating

Store copies update by themselves. For a copy from a GitHub release: unzip the new version into a
new folder, click **Load unpacked** again and pick it. It replaces the old version and keeps your
settings. Don't remove Pointer to update it: removing it forgets your ClickUp token and settings.

## Something isn't working

- **"Reload Pointer" on the page:** Pointer's files changed but the browser is still running the old
  version. On the extensions page, click the reload arrow on bid Pointer, then reload the page.
- **The shortcut does nothing:** Pointer's settings show the shortcut the browser actually gave it,
  and **Change shortcut** opens the browser's shortcut settings (Safari has none). Edge uses
  Ctrl+Shift+. for Copilot.
- **Pointer doesn't show up by itself:** check **Where Pointer shows up** in its settings. Changes
  there take effect on the next page you open.
