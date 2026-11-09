// Updating from bid's own builds before 1.0 keeps bid's setup; nothing else gets it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './bundle.mjs';

const m = await load('src/background/migrate.ts');

test('olderThan compares versions number by number', () => {
  assert.ok(m.olderThan('0.10.0', '1.0.0'));
  assert.ok(m.olderThan('0.9.0', '0.10.0'));
  assert.ok(!m.olderThan('1.0.0', '1.0.0'));
  assert.ok(!m.olderThan('1.0.1', '1.0.0'));
  assert.ok(m.olderThan('1.0', '1.0.1'));
});

test('an install that never saved settings gets the whole bid setup', () => {
  assert.deepEqual(m.bidSetup({}), {
    spaceId: '90142472614',
    spaceName: 'bid › DEVELOPMENT',
    assigneeId: '118313848',
    assigneeName: 'Mate',
    codingAgent: true,
    sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
    footerCredit: 'bid.agency, bid.hr',
  });
});

test("what someone chose stays: another space, another assignee isn't a coding agent", () => {
  const patch = m.bidSetup({ spaceId: '123', assigneeId: '82460956', assigneeName: 'Tea Babić', sites: ['staging.example.com'], footerCredit: 'acme.co.uk' });
  assert.deepEqual(patch, {});
});

test('saved old defaults (DEVELOPMENT, Mate) get their name and Mate becomes the coding agent', () => {
  assert.deepEqual(m.bidSetup({ spaceId: '90142472614', assigneeId: '118313848', assigneeName: 'Mate' }), {
    spaceName: 'bid › DEVELOPMENT',
    codingAgent: true,
    sites: ['*-staging.vercel.app', '*-bid.vercel.app'],
    footerCredit: 'bid.agency, bid.hr',
  });
});
