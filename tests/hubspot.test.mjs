// Send to ClickUp in HubSpot: the ticket's dates, ids, owner and the tasks it becomes. Run with `pnpm test`.
// The case is a real Help Desk ticket ("Redirekcijski lanac Lumen", saved 23 October 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pointer-hubspot-test-'));
const entry = join(dir, 'entry.ts');
const src = (p) => join(process.cwd(), p).replace(/\\/g, '/');
writeFileSync(
  entry,
  `export * from '${src('src/shared/email.ts')}';
   export * from '${src('src/shared/hubspot.ts')}';
   export { recognizeProject } from '${src('src/background/projects.ts')}';`,
);
const out = join(dir, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const m = await import(pathToFileURL(out).href);

const NOW = new Date(2026, 9, 23, 14, 30); // Friday 23 October 2026, 14:30
const SHEET = 'https://docs.google.com/spreadsheets/d/1ExampleSheetForPointerTests00000000000000000/edit?usp=sharing';

// the ticket's email as hubspot/read.ts reads it: the signature's logo is image 1
const TEXT = `Pozdrav,

Tijekom SEO analize Lumenove web stranice pronađeno je 5 linkova s problemom redirect loop, zbog čega se navedene stranice ne mogu ispravno otvoriti.

Pokušala sam provjeriti i ispraviti redirekcije, ali problem je i dalje prisutan.

Ljubazno vas molim da provjerite što uzrokuje navedene redirect loopove i možete li ih ispraviti.

U nastavku šaljem popis linkova.

${SHEET}

Hvala unaprijed na pomoći 🙂

Lp,
Lea Novak
Suradnik u marketingu | Marketing associate
M: +385 99 123 4567
E: lea@seaside-marketing.example
[image 1]
Before you print think about the environment.`;

const ticket = (over = {}) => ({
  id: '100200300400',
  name: 'Redirekcijski lanac Lumen',
  url: 'https://app-eu1.hubspot.com/contacts/147607823/record/0-5/100200300400',
  owner: 'Iva Kos',
  priority: 'Urgent',
  category: '',
  contact: { name: 'Lea Novak', email: 'lea@seaside-marketing.example', title: 'Marketing associate' },
  company: 'Seaside Marketing',
  ...over,
});

const email = (over = {}) => ({
  app: 'HubSpot',
  subject: 'Redirekcijski lanac Lumen',
  threadUrl: 'https://app-eu1.hubspot.com/contacts/147607823/record/0-5/100200300400',
  messages: [
    {
      n: 1,
      id: m.hubspotMessageId('100200300400', 'Lea Novak', 'October 23', '1:25 PM'),
      from: { name: 'Lea Novak', email: 'lea@seaside-marketing.example' },
      dateText: 'Fri, 23 Oct 2026, 13:25',
      sentAt: new Date(2026, 9, 23, 13, 25).getTime(),
      context: null,
      text: TEXT,
      clipped: false,
    },
  ],
  files: [{ n: 1, name: 'image-1.png', mime: 'image/png', kind: 'inline', message: 1 }],
  ticket: ticket(),
  ...over,
});

const REPLY = {
  client: 'Lumen',
  points: [
    {
      message: 1,
      quote: 'Ljubazno vas molim da provjerite što uzrokuje navedene redirect loopove i možete li ih ispraviti.',
      title: 'Fix the redirect loops on 5 Lumen pages',
      instruction: 'Find out what causes the redirect loops on the five Lumen pages listed in the spreadsheet and fix them.',
      kind: 'bug',
      pages: [],
      urls: [SHEET], // not a page: it belongs in links
      links: [SHEET, 'https://example.com/invented'],
      component: 'redirects',
      files: [],
      sensitive: null,
      vague: null,
      size: 'larger',
      urgent: null,
      due: null,
    },
  ],
  questions: [],
  decorative: [1, 7],
};

test('a message is dated from the day above it and its time', () => {
  const at = (day, time) => {
    const t = m.hubspotSentAt(day, time, NOW);
    return t ? new Date(t).toString().slice(0, 21) : 0;
  };
  assert.equal(at('October 23', '1:25 PM'), 'Fri Oct 23 2026 13:25');
  assert.equal(at('October 23, 2025', '9:05 AM'), 'Thu Oct 23 2025 09:05');
  assert.equal(at('Yesterday', '13:25'), 'Thu Oct 22 2026 13:25');
  assert.equal(at('Today', '12:00 AM'), 'Fri Oct 23 2026 00:00');
  assert.equal(at('Monday', '8:00 PM'), 'Mon Oct 19 2026 20:00');
  assert.equal(at('December 30', '10:00 AM'), 'Tue Dec 30 2025 10:00', 'a day later in the year than today is last year');
  assert.equal(at('23 Oct', '1:25 pm'), 'Fri Oct 23 2026 13:25');
  assert.equal(at('', '1:25 PM'), 0);
  assert.equal(at('October 23', 'just now'), 0);
});

test('message ids stay the same for the same message and differ between messages', () => {
  const a = m.hubspotMessageId('100200300400', 'Lea Novak', 'October 23', '1:25 PM');
  assert.equal(a, m.hubspotMessageId('100200300400', ' lea novak ', 'October 23', '1:25 PM'));
  assert.match(a, /^hs:100200300400:[0-9a-z]+$/);
  assert.notEqual(a, m.hubspotMessageId('100200300400', 'Lea Novak', 'October 23', '1:25 PM', 1));
  assert.notEqual(a, m.hubspotMessageId('441827476721', 'Lea Novak', 'October 23', '1:25 PM'));
});

test("the ticket's owner is found in ClickUp by full name, never by one name alone", () => {
  const members = [
    { id: 1, name: 'Iva Kos' },
    { id: 2, name: 'Ana Horvat' },
    { id: 3, name: 'Ana' },
    { id: 4, name: 'Leo Babić' },
    { id: 5, name: 'Tea Babić' },
  ];
  assert.equal(m.memberByName('Iva Kos', members)?.id, 1);
  assert.equal(m.memberByName('iva  kos', members)?.id, 1);
  assert.equal(m.memberByName('Ana Marija Horvat', members)?.id, 2, 'a middle name aside');
  assert.equal(m.memberByName('Lea Novakovic', [{ id: 9, name: 'Lea Novaković' }])?.id, 9, 'accents aside');
  assert.equal(m.memberByName('Ana', members), null);
  assert.equal(m.memberByName('Babić', members), null);
  assert.equal(m.memberByName('Marko Marić', members), null);
  assert.equal(m.memberByName('Ana Horvat', [...members, { id: 6, name: 'Ana Horvat' }]), null, 'two alike is a guess');
});

test("only HubSpot's own servers get the person's session", () => {
  assert.equal(m.isHubSpotFileHost('https://app-eu1.hubspot.com/api/filemanager/api/v2/files/1/signed-url-redirect?&portalId=147607823'), true);
  assert.equal(m.isHubSpotFileHost('https://147607823.fs1.hubspotusercontent-eu1.net/hubfs/147607823/a.png'), true);
  assert.equal(m.isHubSpotFileHost('http://app-eu1.hubspot.com/x'), false);
  assert.equal(m.isHubSpotFileHost('https://hubspot.com.example.org/x'), false);
  assert.equal(m.isHubSpotFileHost('https://docs.google.com/x'), false);
});

test('the reply is tidied: a spreadsheet is a link, not a page; the signature logo is decoration', () => {
  const split = m.sanitizeSplit(REPLY, email());
  const p = split.points[0];
  assert.equal(p.quoteFound, true);
  assert.deepEqual(p.urls, [SHEET], 'kept: the link is in the email');
  assert.deepEqual(p.links, [], 'the sheet is already in urls; the invented link is dropped');
  assert.deepEqual(split.decorative, [1], 'file 7 does not exist');

  const fixed = m.sanitizeSplit({ ...REPLY, points: [{ ...REPLY.points[0], urls: [] }] }, email());
  assert.deepEqual(fixed.points[0].links, [SHEET]);
  // a picture a point needs is never decoration
  const claimed = m.sanitizeSplit({ ...REPLY, points: [{ ...REPLY.points[0], files: [1] }] }, email());
  assert.deepEqual(claimed.decorative, []);
});

test('decoration stays off the tasks; other unclaimed files still go on every task', () => {
  const two = email({ files: [...email().files, { n: 2, name: 'loops.png', mime: 'image/png', kind: 'attachment', message: 1 }] });
  const split = m.sanitizeSplit({ ...REPLY, points: [{ ...REPLY.points[0], urls: [] }] }, two);
  assert.deepEqual(m.unclaimedFiles(two, split), [2]);
});

test('a ticket becomes tasks that link the ticket, say what HubSpot says about it, and are urgent when it is', () => {
  const e = email();
  const split = m.sanitizeSplit({ ...REPLY, points: [{ ...REPLY.points[0], urls: [] }] }, e);
  const plans = m.planTasks(split).map((p) => (m.ticketIsUrgent(e) ? { ...p, priority: 'high' } : p));
  const [task] = m.draftTasks({ email: e, split, plans, assignees: { mate: '118313848', person: '1' }, reporter: 'Ana', now: NOW });
  assert.equal(task.name, 'Fix the redirect loops on 5 Lumen pages');
  assert.equal(task.priority, 'high');
  assert.deepEqual(task.files, [], 'the logo stays off');
  assert.deepEqual(task.tags, ['pointer', 'email', 'hubspot']);
  const lines = task.description.split('\n');
  assert.equal(
    lines[0],
    '🎫 HubSpot [#100200300400](https://app-eu1.hubspot.com/contacts/147607823/record/0-5/100200300400) · Email from **Lea Novak** (lea@seaside-marketing.example) · Fri, 23 Oct 2026, 13:25',
  );
  assert.equal(lines[1], '**Ticket** Redirekcijski lanac Lumen');
  assert.equal(lines[2], '**Company** Seaside Marketing · **Owner** Iva Kos');
  assert.equal(lines[3], '**Priority** High (HubSpot ticket priority: Urgent)');
  assert.ok(task.description.includes(`**Element** redirects · **Link** [Google Sheet](${SHEET})`), task.description);
  assert.ok(task.description.includes('> Ljubazno vas molim da provjerite što uzrokuje navedene redirect loopove i možete li ih ispraviti.'));
  assert.match(lines.at(-1), /^Sent from HubSpot with Pointer · .+ · by Ana$/);
});

test('an urgent ticket that could not be split still goes as one high-priority task', () => {
  const [task] = m.draftTasks({ email: email(), split: { client: null, points: [], questions: [], decorative: [] }, plans: [], unsplit: 'Z.ai 500', assignees: { mate: '', person: '1' } });
  assert.equal(task.priority, 'high');
  assert.ok(task.description.includes('**Priority** High (HubSpot ticket priority: Urgent)'));
  assert.deepEqual(task.tags, ['pointer', 'email', 'hubspot', 'needs-rewrite']);
  const calm = m.draftTasks({ email: email({ ticket: ticket({ priority: 'Medium' }) }), split: { client: null, points: [], questions: [], decorative: [] }, plans: [], unsplit: 'x', assignees: { mate: '', person: '1' } });
  assert.equal(calm[0].priority, null);
});

test('Gmail descriptions stay as they were', () => {
  const g = email({ app: undefined, ticket: undefined, threadUrl: 'https://mail.google.com/mail/u/0/#all/abc' });
  const d = m.buildFallbackDescription({ email: g, reason: 'x', attached: [] });
  assert.match(d.split('\n')[0], /^📧 Email from \*\*Lea Novak\*\* \(lea@seaside-marketing\.example\) · .* · \[Open in Gmail\]\(https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/abc\)$/);
  assert.equal(d.split('\n')[1], '**Subject** Redirekcijski lanac Lumen');
  assert.match(d, /Sent from Gmail with Pointer/);
});

test('links are labelled by what they are', () => {
  assert.equal(m.linkLabel(SHEET), 'Google Sheet');
  assert.equal(m.linkLabel('https://docs.google.com/document/d/1/edit'), 'Google Doc');
  assert.equal(m.linkLabel('https://drive.google.com/drive/folders/1'), 'Google Drive');
  assert.equal(m.linkLabel('https://we.tl/t-abc'), 'WeTransfer');
  assert.equal(m.linkLabel('https://www.example.com/list.pdf'), 'example.com');
});

test("the project is recognized from the ticket's name and the contact's company", () => {
  const all = [
    { listId: '1', label: 'Lumen › Development' },
    { listId: '2', label: 'Cresanka › Development' },
  ];
  const r = m.recognizeProject({ subject: 'Redirekcijski lanac Lumen', text: TEXT, senderDomain: 'seaside-marketing.example', client: 'Lumen', company: 'Seaside Marketing', subjectIs: "the ticket's name" }, all);
  assert.equal(`${r.project.label} | ${r.why} | ${r.strong}`, "Lumen › Development | its name is in the ticket's name | true");
  const byCompany = m.recognizeProject({ subject: 'Website', text: '', senderDomain: '', client: null, company: 'Hotel Cresanka d.o.o.' }, all);
  assert.equal(byCompany?.why, "the ticket's contact is at Hotel Cresanka d.o.o.");
});
