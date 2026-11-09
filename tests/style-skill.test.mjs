// The style skill (skills/bid-extension-style) ships copies of the shared style files, so a
// coworker's extension gets the same values. This fails when a copy falls behind src/styles:
// copy the file over again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['tokens.css', 'base.css', 'controls.css']) {
  test(`style skill's ${file} matches src/styles`, () => {
    const source = readFileSync(`src/styles/${file}`, 'utf8');
    const copy = readFileSync(`skills/bid-extension-style/assets/${file}`, 'utf8');
    assert.equal(copy, source, `copy src/styles/${file} to skills/bid-extension-style/assets/`);
  });
}
