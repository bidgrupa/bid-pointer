// Setup codes: a team's settings as one string, and back, with nothing personal in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const m = await load('src/shared/setupcode.ts');

// bid's own setup, as a maintainer has it
const BID = {
  zaiKey: 'abc123.def456',
  clickupToken: 'pk_secret',
  clickupUser: { id: 7, username: 'Ana Test', email: 'ana@bid.hr' },
  assigneeId: '118313848',
  assigneeName: 'Mate',
  spaceId: '90142472614',
  spaceName: 'bid › DEVELOPMENT',
  codingAgent: true,
  sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
  footerCredit: 'bid.agency, bid.hr',
  consentAt: '2026-11-09T10:00:00.000Z',
  reviewBeforeSend: false,
  pageTask: true,
  commentMode: false,
  seoCheck: true,
  hostProjects: { cresanka: { listId: '901417200456', label: 'Cresanka › Development' } },
  domainProjects: {},
  recent: [],
};

test('a code carries the team setup there and back, and never the token, the OK or the history', async () => {
  const code = await m.encodeSetup(m.sharedSettings(BID, true));
  assert.match(code, /^PTR1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 400, `short enough to paste: ${code.length}`);
  assert.ok(!code.includes('pk_') && !code.includes('Mate'), "it's not readable at a glance");
  const back = await m.decodeSetup(code);
  assert.deepEqual(back, {
    spaceId: '90142472614',
    spaceName: 'bid › DEVELOPMENT',
    assigneeId: '118313848',
    assigneeName: 'Mate',
    codingAgent: true,
    sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
    footerCredit: 'bid.agency, bid.hr',
    zaiKey: 'abc123.def456',
    reviewBeforeSend: false,
    pageTask: true,
    commentMode: false,
    seoCheck: true,
  });
  for (const personal of ['clickupToken', 'clickupUser', 'consentAt', 'hostProjects', 'domainProjects', 'recent']) assert.ok(!(personal in back), personal);
});

/** What's actually inside a code, before Pointer reads it. */
const inside = async (code) => {
  const bytes = Buffer.from(code.slice('PTR1.'.length), 'base64url');
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text());
};
const deflated = async (payload) =>
  `PTR1.${Buffer.from(await new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()).toString('base64url')}`;

test('the ClickUp connection never goes into a code: no token, no account', async () => {
  const raw = await inside(await m.encodeSetup(m.sharedSettings(BID, true)));
  assert.deepEqual(Object.keys(raw).sort(), ['a', 'an', 'c', 'f', 'm', 'o', 'p', 'r', 's', 'sn', 'v', 'w', 'z']);
  const text = JSON.stringify(raw);
  for (const personal of ['pk_secret', 'Ana Test', 'ana@bid.hr', '2026-11-09T10:00']) assert.ok(!text.includes(personal), personal);
});

test("a code made by hand can't set anyone's ClickUp connection either", async () => {
  const sneaky = await deflated({
    v: 1,
    s: '90142472614',
    clickupToken: 'pk_attacker',
    clickupUser: { id: 1, username: 'Someone else', email: 'x@y.z' },
    consentAt: '2026-01-01T00:00:00.000Z',
    t: 'pk_attacker',
    recent: [{}],
  });
  assert.deepEqual(await m.decodeSetup(sneaky), { spaceId: '90142472614' });
});

test('the Z.ai key goes in only when asked for, and empty settings stay out', async () => {
  const without = await m.decodeSetup(await m.encodeSetup(m.sharedSettings(BID, false)));
  assert.ok(!('zaiKey' in without));
  const fresh = { ...BID, zaiKey: '', spaceId: '', spaceName: '', assigneeId: '', assigneeName: '', sites: [], footerCredit: '' };
  const empty = await m.decodeSetup(await m.encodeSetup(m.sharedSettings(fresh, true)));
  assert.deepEqual(Object.keys(empty).sort(), ['codingAgent', 'commentMode', 'pageTask', 'reviewBeforeSend', 'seoCheck']);
});

test('pasting is forgiving about whitespace, and says plainly what is wrong otherwise', async () => {
  const code = await m.encodeSetup(m.sharedSettings(BID, false));
  const wrapped = `  ${code.slice(0, 40)}\n${code.slice(40, 90)} \n${code.slice(90)}\n`;
  assert.deepEqual(await m.decodeSetup(wrapped), await m.decodeSetup(code));
  await assert.rejects(m.decodeSetup('pk_123456'), /isn't a Pointer setup code/);
  await assert.rejects(m.decodeSetup(code.slice(0, -12)), /cut off or mistyped/);
  const flipped = code.slice(0, 30) + (code[30] === 'A' ? 'B' : 'A') + code.slice(31);
  await assert.rejects(m.decodeSetup(flipped), /cut off or mistyped/);
});

test('a code from a newer Pointer asks for an update instead of half-applying', async () => {
  const json = JSON.stringify({ v: 2, s: '1' });
  const bytes = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const code = `PTR1.${Buffer.from(bytes).toString('base64url')}`;
  await assert.rejects(m.decodeSetup(code), /newer Pointer/);
});

test('only known fields of the right kind get through, tidied like the options page does', () => {
  assert.deepEqual(
    m.sanitizeShared({
      spaceId: '123abc',
      assigneeId: ' 42 ',
      assigneeName: 'Tea',
      sites: ['HTTPS://Staging.Example.com/x', 'staging.example.com', 7, ''],
      footerCredit: 'https://acme.co.uk/, nonsense',
      zaiKey: '<script>',
      codingAgent: 'yes',
      seoCheck: false,
      clickupToken: 'pk_sneaky',
    }),
    { assigneeId: '42', assigneeName: 'Tea', sites: ['staging.example.com'], footerCredit: 'acme.co.uk', seoCheck: false },
  );
});

test('describeSetup lists what a code sets, for checking before it is used', () => {
  assert.deepEqual(m.describeSetup(m.sharedSettings(BID, true)), [
    'ClickUp space: bid › DEVELOPMENT',
    'Default assignee: Mate, a coding agent',
    'Your sites: *-staging.vercel.app, *-bid.vercel.app',
    'Agency domains: bid.agency, bid.hr',
    'Z.ai key: included',
    'Review the rewrite before creating the task: off',
    'Page Specific Task: on',
    'Comment Mode: off',
    'SEO checker: on',
  ]);
});
