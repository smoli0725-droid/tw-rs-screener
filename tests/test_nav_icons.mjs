import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
const STYLES = fs.readFileSync(path.join(ROOT, 'site/styles.css'), 'utf8');

const SYMBOLS = [
  'nav-icon-holdings',
  'nav-icon-recommend',
  'nav-icon-teaching',
  'nav-icon-settings',
];

test('shared paper-line SVG nav sprite defines all four icons', () => {
  for (const id of SYMBOLS) {
    assert.match(INDEX, new RegExp(`id="${id}"`));
    assert.match(INDEX, new RegExp(`href="#${id}"`));
  }
  assert.match(INDEX, /viewBox="0 0 24 24"/);
  assert.match(INDEX, /stroke="currentColor"/);
  assert.match(INDEX, /stroke-width="1\.5"/);
  assert.doesNotMatch(INDEX, /[▣◈✎⚙]/);
});

test('designer-approved path geometry is present', () => {
  assert.match(INDEX, /M9\.5 9\.5v10/); // holdings left column
  assert.match(INDEX, /M13 3\.5 6\.5 13h5L10\.5 20\.5/); // recommend bolt
  assert.match(INDEX, /M8 4\.5v15/); // teaching spine
  assert.match(INDEX, /M 10\.40 7\.05 L 10\.25 4\.19/); // settings tooth-up
});

test('sidebar and bottom nav both reference the shared sprite', () => {
  const sideUses = INDEX.match(/side-link[\s\S]*?<\/nav>/)?.[0] || '';
  const bottomUses = INDEX.match(/bottom-nav[\s\S]*?<\/nav>/)?.[0] || '';
  for (const id of SYMBOLS) {
    assert.match(sideUses, new RegExp(`href="#${id}"`));
    assert.match(bottomUses, new RegExp(`href="#${id}"`));
  }
});

test('nav icon CSS sizes SVGs (not Unicode font-size)', () => {
  assert.match(STYLES, /\.nav-icon\s*\{[^}]*width:\s*1\.35rem/s);
  assert.match(STYLES, /\.nav-icon\s*\{[^}]*height:\s*1\.35rem/s);
  assert.doesNotMatch(STYLES, /\.nav-icon\s*\{\s*font-size:/);
});
