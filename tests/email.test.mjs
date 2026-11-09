// Send to ClickUp (Gmail): splitting, grouping, routing and descriptions. Run with `pnpm test`.
// The first case is the example email from the feature brief, with a recorded GLM answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'pointer-email-test-'));
const entry = join(dir, 'entry.ts');
const src = (p) => join(process.cwd(), p).replace(/\\/g, '/');
writeFileSync(
  entry,
  `export * from '${src('src/shared/email.ts')}';
   export * from '${src('src/shared/routing.ts')}';
   export { splitEmail, rewrite } from '${src('src/background/zai.ts')}';
   export { recognizeProject } from '${src('src/background/projects.ts')}';`,
);
const out = join(dir, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const m = await import(pathToFileURL(out).href);

const SENT = new Date(2026, 9, 16, 9, 12).getTime(); // Friday 16 October 2026, 09:12

const EXAMPLE_TEXT = `Hi team, a few things:
1. On the Rooms page the Deluxe Suite still says 45 m², it should be 52 m². Also "balcony" is misspelled in the Superior Room text.
2. The Book Now button is hard to see on mobile, on the homepage and on Offers. Can it be bigger?
3. Please replace the Wellness hero photo with the attached one.
4. When will the new spa page be live?
5. Yesterday the booking engine showed €0 for one night. Guests noticed!

Best regards,
Ana Horvat
Hotel Example`;

const example = () => ({
  subject: 'Website changes',
  threadUrl: 'https://mail.google.com/mail/u/0/#all/FMfcgzQXJWDsKmzVvzRJLhmnZvdPxbMx',
  messages: [
    {
      n: 1,
      id: '19a0b1c2d3e4f5a6',
      from: { name: 'Ana Horvat', email: 'ana@hotel-example.hr' },
      dateText: 'Fri, Oct 16, 2026, 9:12 AM',
      sentAt: SENT,
      context: null,
      text: EXAMPLE_TEXT,
      clipped: false,
    },
  ],
  files: [{ n: 1, name: 'wellness-hero.jpg', mime: 'image/jpeg', kind: 'attachment', message: 1 }],
});

// what GLM answered for it (curly quotes around "balcony", as models often write them)
const EXAMPLE_REPLY = {
  client: 'Hotel Example',
  points: [
    {
      message: 1,
      quote: 'On the Rooms page the Deluxe Suite still says 45 m², it should be 52 m².',
      title: 'Change the Deluxe Suite size to 52 m²',
      instruction: "On the Rooms page, change the Deluxe Suite's size from 45 m² to 52 m².",
      kind: 'content',
      pages: ['Rooms page'],
      urls: [],
      component: 'Deluxe Suite',
      files: [],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Also “balcony” is misspelled in the Superior Room text.',
      title: 'Fix the "balcony" typo in the Superior Room text',
      instruction: 'Correct the spelling of "balcony" in the Superior Room text on the Rooms page.',
      kind: 'content',
      pages: ['Rooms page'],
      urls: [],
      component: 'Superior Room text',
      files: [],
      sensitive: null,
      vague: 'none',
      size: 'small',
      urgent: 'null',
      due: null,
    },
    {
      message: 1,
      quote: 'The Book Now button is hard to see on mobile, on the homepage and on Offers. Can it be bigger?',
      title: 'Make Book Now more visible on mobile',
      instruction: 'Make the Book Now button easier to see on mobile, on the homepage and the Offers page, for example by making it bigger.',
      kind: 'design',
      pages: ['homepage', 'Offers'],
      urls: [],
      component: 'Book Now button',
      files: [],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Please replace the Wellness hero photo with the attached one.',
      title: 'Replace the Wellness hero photo',
      instruction: 'Replace the hero photo on the Wellness page with the photo attached to the email.',
      kind: 'media',
      pages: ['Wellness'],
      urls: [],
      component: 'hero photo',
      files: [1],
      sensitive: null,
      vague: null,
      size: 'small',
      urgent: null,
      due: null,
    },
    {
      message: 1,
      quote: 'Yesterday the booking engine showed €0 for one night. Guests noticed!',
      title: '€0 price shown in the booking engine',
      instruction: 'Find out why the booking engine showed a price of €0 for a one-night stay and fix it.',
      kind: 'bug',
      pages: [],
      urls: [],
      component: 'booking engine',
      files: [],
      sensitive: 'prices',
      vague: null,
      size: 'larger',
      urgent: 'Guests noticed!',
      due: null,
    },
  ],
  questions: [{ message: 1, quote: 'When will the new spa page be live?' }],
};

const point = (over = {}) => ({
  id: 'p1',
  message: 1,
  quote: '',
  quoteFound: true,
  title: 'Fix it',
  instruction: 'Fix it.',
  kind: 'content',
  pages: [],
  urls: [],
  component: null,
  files: [],
  sensitive: null,
  vague: null,
  size: 'small',
  urgent: null,
  due: null,
  ...over,
});

test('example email: the reply is tidied, every quote is found', () => {
  const split = m.sanitizeSplit(EXAMPLE_REPLY, example());
  assert.equal(split.points.length, 5);
  assert.equal(split.questions.length, 1);
  assert.equal(split.client, 'Hotel Example');
  assert.ok(split.points.every((p) => p.quoteFound), JSON.stringify(split.points.map((p) => [p.id, p.quoteFound])));
  assert.equal(split.points[1].vague, null, '"none" means no');
  assert.equal(split.points[1].urgent, null, '"null" means no');
  assert.deepEqual(split.points[3].files, [1]);
  assert.equal(split.points[4].sensitive, 'prices');
  assert.equal(split.questions[0].quote, 'When will the new spa page be live?');
});

test('example email: today Mate gets none of it (no CMS access); four tasks, the price bug alone and urgent', () => {
  const split = m.sanitizeSplit(EXAMPLE_REPLY, example());
  const plans = m.planTasks(split);
  assert.deepEqual(
    plans.map((p) => p.title),
    ['Content fixes on Rooms page', 'Make Book Now more visible on mobile', 'Replace the Wellness hero photo', '€0 price shown in the booking engine'],
  );
  assert.deepEqual(plans[0].points, ['p1', 'p2']);
  assert.deepEqual(
    plans.map((p) => p.route),
    ['person', 'person', 'person', 'person'],
  );
  assert.match(plans[0].reasons.join(), /CMS/);
  assert.match(plans[1].reasons.join(), /design decision/);
  assert.deepEqual(
    plans.map((p) => p.priority),
    [null, null, null, 'high'],
  );
  assert.match(plans[3].reasons.join(), /prices/);
});

test('example email: once Mate can edit the CMS, the brief\'s expected routing comes out', () => {
  const split = m.sanitizeSplit(EXAMPLE_REPLY, example());
  const plans = m.planTasks(split, { ...m.ROUTING, mateEditsCms: true });
  assert.deepEqual(
    plans.map((p) => `${p.title} → ${p.route}`),
    [
      'Content fixes on Rooms page → mate',
      'Make Book Now more visible on mobile → person',
      'Replace the Wellness hero photo → mate',
      '€0 price shown in the booking engine → person',
    ],
  );
});

test('example email: drafts carry quotes, a link back, the right file and the right people', () => {
  const email = example();
  const split = m.sanitizeSplit(EXAMPLE_REPLY, email);
  const drafts = m.draftTasks({
    email,
    split,
    plans: m.planTasks(split),
    assignees: { mate: '118313848', person: '82460953' },
    reporter: 'Ana Test',
    now: new Date(2026, 9, 16, 14, 3),
  });
  assert.equal(drafts.length, 4);
  const [rooms, , wellness, price] = drafts;
  assert.equal(rooms.assigneeId, '82460953');
  assert.match(rooms.description, /^📧 Email from \*\*Ana Horvat\*\* \(ana@hotel-example\.hr\) · Fri, Oct 16, 2026, 9:12 AM · \[Open in Gmail\]\(https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/FMfcgz/);
  assert.match(rooms.description, /\*\*1\. Change the Deluxe Suite size to 52 m²\*\*\n- On the Rooms page, change the Deluxe Suite's size from 45 m² to 52 m²\.\n\*\*Page\*\* Rooms page \(no link\) · \*\*Element\*\* Deluxe Suite\n> On the Rooms page the Deluxe Suite still says 45 m², it should be 52 m²\./);
  assert.match(rooms.description, /\*\*2\. Fix the "balcony" typo/);
  assert.doesNotMatch(rooms.description, /not found word for word/);
  assert.match(rooms.description, /Sent from Gmail with Pointer · 16\.10\.2026 14:03 · by Ana Test$/);
  assert.deepEqual(rooms.files, []);
  assert.deepEqual(wellness.files, [1], 'the hero photo goes on its task only');
  assert.match(wellness.description, /\*\*Image\*\* wellness-hero\.jpg/);
  assert.doesNotMatch(wellness.description, /\*\*1\./, 'one point: no numbering');
  assert.deepEqual(price.files, []);
  assert.match(price.description, /\*\*Priority\*\* High \(“Guests noticed!”\)/);
  assert.deepEqual(price.tags, ['pointer', 'email']);
});

test('sanitizeSplit drops invented links, unknown files and points from context messages', () => {
  const email = example();
  email.messages[0].text += '\nSee https://www.hotel-example.hr/en/rooms for the page.';
  email.messages.push({ ...email.messages[0], n: 2, id: '', from: { name: 'Mate', email: 'mate@bid.hr' }, context: 'ours', text: 'Thanks, we will look.' });
  const split = m.sanitizeSplit(
    {
      points: [
        { message: 1, quote: 'Deluxe Suite still says 45 m²', title: 'Fix size', urls: ['https://www.hotel-example.hr/en/rooms/', 'https://evil.example/rooms'], files: [1, 7, '1'], kind: 'weird' },
        { message: 2, quote: 'Thanks, we will look.', title: 'Look' },
        { message: 9, quote: 'not in the email at all', title: 'Something' },
      ],
    },
    email,
  );
  assert.equal(split.points.length, 2, 'the agency reply gives no points');
  assert.deepEqual(split.points[0].urls, ['https://www.hotel-example.hr/en/rooms/']);
  assert.deepEqual(split.points[0].files, [1]);
  assert.equal(split.points[0].kind, 'other');
  assert.equal(split.points[0].size, 'larger', 'no size given: assume it is not small');
  assert.equal(split.points[1].message, 1, 'an unknown message number falls back to the latest client message');
  assert.equal(split.points[1].quoteFound, false);
  assert.equal(m.sanitizeSplit('nonsense', email), null);
  assert.equal(m.sanitizeSplit({ title: 'x' }, email), null);
});

test('quotes match despite curly quotes, spacing and image markers', () => {
  assert.ok(m.quoteFound('Also “balcony” is   misspelled.', 'Also "balcony" is misspelled in the text.'));
  assert.ok(m.quoteFound('see the photo here', 'see the photo [image 2] here'));
  assert.ok(!m.quoteFound('the balcony is fine', 'Also "balcony" is misspelled.'));
  assert.ok(!m.quoteFound('ok', 'ok'), 'too short to mean anything');
});

test('deadlines must be real dates near the email', () => {
  const email = example();
  const dueOf = (due) => m.sanitizeSplit({ points: [{ message: 1, title: 'X', due }] }, email).points[0].due;
  assert.deepEqual(dueOf({ date: '2026-10-23', said: 'by next Friday' }), { date: '2026-10-23', said: 'by next Friday' });
  assert.equal(dueOf({ date: '2026-02-31', said: 'x' }), null);
  assert.equal(dueOf({ date: '17.10.2026', said: 'x' }), null);
  assert.equal(dueOf({ date: '2031-01-01', said: 'x' }), null);
  assert.equal(dueOf({ date: '2026-09-01', said: 'x' }), null, 'before the email was sent');
  assert.equal(dueOf('by Friday'), null);
});

test('a group bigger than the limit is split so its pull request stays reviewable', () => {
  const points = Array.from({ length: 8 }, (_, i) => point({ id: `p${i + 1}`, title: `Fix ${i + 1}`, pages: ['Rooms page'], kind: 'style' }));
  const plans = m.planTasks({ client: null, points, questions: [] });
  assert.deepEqual(
    plans.map((p) => [p.title, p.points.length]),
    [
      ['Style fixes on Rooms page (1 of 2)', 6],
      ['Style fixes on Rooms page (2 of 2)', 2],
    ],
  );
  assert.ok(plans.every((p) => p.route === 'mate'));
});

test('the same component on several pages goes together; different kinds or people stay apart', () => {
  const plans = m.planTasks({
    client: null,
    points: [
      point({ id: 'p1', title: 'Bigger Book Now on home', kind: 'style', pages: ['homepage'], component: 'Book Now button' }),
      point({ id: 'p2', title: 'Bigger Book Now on offers', kind: 'style', pages: ['Offers'], component: 'Book now  button' }),
      point({ id: 'p3', title: 'Typo on home', kind: 'content', pages: ['home page'] }),
      point({ id: 'p4', title: 'Layout on home', kind: 'style', pages: ['Homepage'] }),
    ],
    questions: [],
  });
  assert.deepEqual(
    plans.map((p) => [p.title, p.points.join()]),
    [
      ['Style fixes: Book Now button (homepage, Offers)', 'p1,p2'],
      ['Typo on home', 'p3'],
      ['Layout on home', 'p4'],
    ],
  );
});

test('vague points and booking, prices or legal text are tasks of their own, for a person', () => {
  const plans = m.planTasks({
    client: null,
    points: [
      point({ id: 'p1', title: 'Feel more premium', kind: 'design', pages: ['homepage'], vague: 'no concrete change' }),
      point({ id: 'p2', title: 'Update cookie text', kind: 'content', pages: ['homepage'], sensitive: 'legal' }),
      point({ id: 'p3', title: 'Typo in footer', kind: 'content', pages: ['homepage'] }),
    ],
    questions: [],
  });
  assert.equal(plans.length, 3);
  assert.ok(plans[0].needsClarification);
  assert.ok(plans.slice(0, 2).every((p) => p.route === 'person'));
  assert.match(plans[0].reasons.join(), /needs clarification/);
  assert.match(plans[1].reasons.join(), /legal/);
});

test('Mate only gets clear, small changes in a named place', () => {
  const route = (over) => m.routePoint(point(over)).to;
  assert.equal(route({ kind: 'style', pages: ['homepage'] }), 'mate');
  assert.equal(route({ kind: 'bug', component: 'menu' }), 'mate');
  assert.equal(route({ kind: 'bug' }), 'person', 'no page or element');
  assert.equal(route({ kind: 'bug', component: 'menu', size: 'larger' }), 'person');
  assert.equal(route({ kind: 'feature', component: 'menu' }), 'person');
  assert.equal(route({ kind: 'content', pages: ['homepage'] }), 'person', 'CMS content');
  assert.equal(m.routePoint(point({ kind: 'content', pages: ['homepage'] }), { ...m.ROUTING, mateEditsCms: true }).to, 'mate');
});

test('without a coding agent nothing is routed, but risky points still get tasks of their own', () => {
  const noAgent = { ...m.ROUTING, agent: false };
  for (const over of [{ kind: 'feature', component: 'menu' }, { kind: 'bug' }, { kind: 'content', pages: ['homepage'] }]) {
    assert.deepEqual(m.routePoint(point(over), noAgent), { to: 'mate', reasons: [] });
  }
  const plans = m.planTasks(
    {
      client: null,
      points: [
        point({ id: 'a', kind: 'style', pages: ['homepage'] }),
        point({ id: 'b', kind: 'style', pages: ['homepage'], sensitive: 'prices' }),
        point({ id: 'c', kind: 'feature', pages: ['homepage'] }),
      ],
      questions: [],
    },
    noAgent,
  );
  assert.ok(plans.every((p) => p.route === 'mate' && p.reasons.length === 0));
  assert.ok(
    plans.some((p) => p.points.length === 1 && p.points[0] === 'b'),
    'the prices point stays on its own',
  );
});

test("teamDomains: the account's own domain (not webmail) and the agency's", () => {
  assert.deepEqual(m.teamDomains({ email: 'ana@bid.hr', footerCredit: 'bid.agency, bid.hr' }), ['bid.hr', 'bid.agency']);
  assert.deepEqual(m.teamDomains({ email: 'someone@gmail.com', footerCredit: '' }), []);
  assert.deepEqual(m.teamDomains({ email: undefined, footerCredit: 'acme.co.uk' }), ['acme.co.uk']);
  assert.ok(m.isOurDomain('mia@studio.acme.co.uk', ['acme.co.uk']));
  assert.ok(!m.isOurDomain('client@hotel.hr', ['bid.hr']));
  assert.ok(!m.isOurDomain('client@notbid.hr', ['bid.hr']));
});

test('files no point claimed go on every task, so nothing from the email is lost', () => {
  const email = example();
  email.files.push({ n: 2, name: 'screenshot.png', mime: 'image/png', kind: 'inline', message: 1 });
  const split = m.sanitizeSplit(EXAMPLE_REPLY, email);
  const drafts = m.draftTasks({ email, split, plans: m.planTasks(split), assignees: { mate: '1', person: '2' } });
  assert.ok(drafts.every((d) => d.files.includes(2)));
  assert.match(drafts[0].description, /\*\*Other image from the email\*\* screenshot\.png \(not tied to one point\)/);
  assert.deepEqual(drafts[2].files, [1, 2]);
  // a file that didn't download stays off every task and out of the descriptions
  const without = m.draftTasks({ email, split, plans: m.planTasks(split), assignees: { mate: '1', person: '2' }, available: [1] });
  assert.ok(without.every((d) => !d.files.includes(2) && !d.description.includes('screenshot.png')));
});

test('an email that could not be split goes as one task, quoted whole, to a person', () => {
  const email = example();
  const [draft] = m.draftTasks({ email, split: { client: null, points: [], questions: [] }, plans: [], unsplit: 'Z.ai 500', assignees: { mate: '1', person: '2' } });
  assert.equal(draft.name, 'Email from Ana Horvat: Website changes');
  assert.equal(draft.assigneeId, '2');
  assert.deepEqual(draft.files, [1]);
  assert.deepEqual(draft.tags, ['pointer', 'email', 'needs-rewrite']);
  assert.match(draft.description, /couldn't split this email into tasks \(Z\.ai 500\)/);
  assert.match(draft.description, /\n> 5\. Yesterday the booking engine showed €0 for one night\. Guests noticed!\n/);
  assert.match(draft.description, /\*\*Image\*\* wellness-hero\.jpg/);
});

test("in the review, tasks follow the first one's person, but never to Mate when the rules keep them from Mate", () => {
  const t = (assigneeId, route, followsFirst) => ({ assigneeId, route, followsFirst });
  // a person on the first: everyone following gets them, Mate's tasks too
  assert.deepEqual(m.inheritAssignees([t('7', 'person', false), t('mate', 'mate', true), t('1', 'person', true)], 'mate'), ['7', '7', '7']);
  // Mate on the first: only the tasks Mate may take follow; the rest keep their person
  assert.deepEqual(m.inheritAssignees([t('mate', 'mate', false), t('1', 'person', true), t('1', 'mate', true)], 'mate'), ['mate', '1', 'mate']);
  // picked by hand: its own person, whatever the first has
  assert.deepEqual(m.inheritAssignees([t('7', 'person', false), t('9', 'person', false), t('1', 'person', true)], 'mate'), ['7', '9', '7']);
  // no one on the first: no one on the followers
  assert.deepEqual(m.inheritAssignees([t('', 'person', false), t('1', 'person', true)], 'mate'), ['', '']);
  // without a default assignee there's no Mate to keep away
  assert.deepEqual(m.inheritAssignees([t('7', 'person', false), t('1', 'person', true)], ''), ['7', '7']);
  assert.deepEqual(m.inheritAssignees([], 'mate'), []);
});

test("Mate's own token never makes Mate the person for tasks it shouldn't take", () => {
  const MATE = '118313848';
  // the usual: Mate is the default, a person's token
  assert.deepEqual(m.routeAssignees({ defaultId: MATE, ownerId: '82460953', mateId: MATE }), { mate: MATE, person: '82460953' });
  // Mate's token in Pointer, a person as default: that person gets them
  assert.deepEqual(m.routeAssignees({ defaultId: '82460953', ownerId: MATE, mateId: MATE }), { mate: '82460953', person: '82460953' });
  // Mate's token and Mate as default: no one, rather than Mate
  assert.deepEqual(m.routeAssignees({ defaultId: MATE, ownerId: MATE, mateId: MATE }), { mate: MATE, person: '' });
  // no token user known yet
  assert.deepEqual(m.routeAssignees({ defaultId: MATE, ownerId: '', mateId: MATE }), { mate: MATE, person: '' });
});

test("the review's summary is the task's instructions, without Markdown", () => {
  const email = example();
  const split = m.sanitizeSplit(EXAMPLE_REPLY, email);
  const [rooms] = m.draftTasks({ email, split, plans: m.planTasks(split), assignees: { mate: '1', person: '2' } });
  assert.deepEqual(m.previewLines(rooms.description), [
    "On the Rooms page, change the Deluxe Suite's size from 45 m² to 52 m².",
    'Correct the spelling of "balcony" in the Superior Room text on the Rooms page.',
  ]);
  assert.deepEqual(m.previewLines('- See **this** [page](https://x.hr) and `code`'), ['See this page and code']);
  // the whole email as one task: its first quoted lines
  assert.deepEqual(m.previewLines('📧 Email\n\nPointer couldn’t split it.\n\n> Hi team,\n> fix the menu\n> thanks'), ['Hi team,', 'fix the menu']);
});

const PROJECTS = [
  { listId: '901417200456', label: 'Cresanka › Development' },
  { listId: '901407290920', label: 'Bluesun' },
  { listId: '901418360025', label: 'Hotel Dubrovnik Zagreb › Development' },
  { listId: '901400000001', label: 'Sunčani Hvar' },
  { listId: '901415053456', label: 'bid. › Development' },
  { listId: '901400000002', label: 'Lauris › Development' },
];
const recognize = (over) => m.recognizeProject({ subject: '', text: '', senderDomain: '', client: null, ...over }, PROJECTS);
const which = (r) => (r ? `${r.project.label} | ${r.why} | ${r.strong ? 'strong' : 'weak'}` : null);

test('the project is recognized from the subject, links, addresses, the sender and the text', () => {
  assert.equal(which(recognize({ subject: 'test tasks for cresanka', text: 'please fix the footer' })), 'Cresanka › Development | its name is in the subject | strong');
  assert.equal(which(recognize({ text: 'see https://cresanka-staging.vercel.app/rooms please' })), 'Cresanka › Development | a link to cresanka-staging.vercel.app | strong');
  assert.equal(which(recognize({ text: 'PR: https://github.com/bidgrupa/pages-bluesun/pull/12' })), 'Bluesun | a link to github.com/bidgrupa/pages-bluesun | strong');
  assert.equal(which(recognize({ text: 'the new photos on https://www.suncanihvar.hr/en' })), 'Sunčani Hvar | a link to suncanihvar.hr | strong');
  assert.equal(which(recognize({ senderDomain: 'bluesunhotels.com' })), "Bluesun | the sender's domain, bluesunhotels.com | weak");
  assert.equal(which(recognize({ text: '---------- Forwarded message ---------\nFrom: Ana <ana@cresanka.hr>' })), 'Cresanka › Development | an address at cresanka.hr in the email | weak');
  assert.equal(which(recognize({ client: 'Hotel Cresanka' })), 'Cresanka › Development | the email is from Hotel Cresanka | weak');
});

test('names are found the way people write them: Croatian endings, run together, without "hotel"', () => {
  assert.equal(which(recognize({ text: 'Na stranici Cresanke footer ne radi.' })), 'Cresanka › Development | its name is in the email | weak');
  assert.equal(which(recognize({ text: 'Slike Sunčanog Hvara su stare.' }))?.split(' | ')[0], 'Sunčani Hvar');
  assert.equal(which(recognize({ text: 'Booking for Dubrovnik Zagreb is down' }))?.split(' | ')[0], 'Hotel Dubrovnik Zagreb › Development');
  assert.equal(recognize({ text: 'the hotel was lovely, thanks' }), null, '"hotel" alone names no project');
});

test('the subject outweighs the text; two projects equally named, or only bid itself, give no answer', () => {
  assert.equal(which(recognize({ subject: 'Lauris homepage', text: 'like we did for Cresanka, Cresanka has it' }))?.split(' | ')[0], 'Lauris › Development');
  assert.equal(recognize({ subject: 'Cresanka and Bluesun' }), null);
  assert.equal(recognize({ subject: 'bid. website footer', text: 'see https://bid.agency and write to info@bid.hr', senderDomain: '' }), null);
  assert.equal(recognize({ text: 'https://docs.google.com/document/d/123 and https://www.figma.com/file/abc' }), null, 'tools are not client sites');
});

test('the prompt lists messages, marks context and says where each file is', () => {
  const email = example();
  email.messages.unshift({ ...email.messages[0], n: 0, context: 'ours', text: 'Earlier reply' });
  email.files.push({ n: 2, name: 'shot.png', mime: 'image/png', kind: 'inline', message: 1 });
  const p = JSON.parse(m.emailPrompt(email));
  assert.equal(p.subject, 'Website changes');
  assert.equal(p.messages[0].context_only, true);
  assert.equal(p.messages[1].context_only, undefined);
  assert.equal(p.messages[1].sent, 'Friday 2026-10-16 09:12');
  assert.equal(p.messages[1].from, 'Ana Horvat <ana@hotel-example.hr>');
  assert.deepEqual(p.files[0], { number: 1, name: 'wellness-hero.jpg', type: 'image/jpeg', where: 'attached to message 1' });
  assert.equal(p.files[1].where, 'shown as [image 2] in message 1');
});

test('the project is remembered by domain, or by address for webmail', () => {
  assert.equal(m.senderKey('Ana@Hotel-Cresanka.HR'), 'hotel-cresanka.hr');
  assert.equal(m.senderKey('someone@gmail.com'), 'someone@gmail.com');
  assert.equal(m.senderKey('vlasnik@net.hr'), 'vlasnik@net.hr');
  assert.equal(m.senderKey('nonsense'), '');
  assert.deepEqual(m.senderNames('cresanka.hr'), ['cresanka']);
  assert.deepEqual(m.senderNames('someone@gmail.com'), []);
});

test("Gmail's ids carry the time and convert between their two forms", () => {
  const ms = Date.UTC(2026, 9, 16, 7, 12);
  const hex = `${ms.toString(16)}a1b2c`;
  assert.equal(m.messageTime(hex), ms);
  assert.equal(m.messageTime('nothex'), 0);
  assert.equal(m.messageTime('1'), 0);
  assert.equal(m.hexIdFromSync(`#msg-f:${BigInt(`0x${hex}`).toString()}`), hex);
  assert.equal(m.hexIdFromSync('#thread-f:abc'), '');
});

test('Z.ai is asked with an effort level it takes (low, high or max: "medium" is a 400)', async () => {
  const bodies = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"points":[],"questions":[]}' } }] }), { status: 200 });
  };
  try {
    await m.splitEmail('key', example());
    await m.rewrite('key', { note: 'cta preko naslova', block: { name: '', id: '', source: 'none' }, element: { selector: '', text: '' }, page: { path: '/' }, projectLabel: '' });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(bodies.length, 2);
  assert.deepEqual(
    bodies.map((b) => b.reasoning_effort),
    ['high', 'low'],
  );
});

test('due labels and timestamps keep to the day', () => {
  assert.equal(m.dueLabel('2026-10-23'), 'Fri 23.10.2026');
  const t = new Date(m.dueTimestamp('2026-10-17'));
  assert.equal(t.getDate(), 17);
  assert.equal(t.getHours(), 12);
});
