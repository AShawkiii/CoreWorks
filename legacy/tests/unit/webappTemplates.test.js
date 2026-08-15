'use strict';
/**
 * Regression guard for a real bug: HtmlService.createHtmlOutputFromFile()
 * (previously used by a webapp/WebAppEntry.gs include() helper) parses its
 * target file's raw content as HTML to validate it. Bare/unwrapped JS
 * partials — especially ones containing literal HTML-looking strings like
 * '<h1 class="page-title">...' — fail that validation with "Malformed HTML
 * content". The fix removed the include()/partial-file mechanism entirely:
 * Index.html and AccessDenied.html are now fully self-contained (all
 * CSS/JS inlined), evaluated only via
 * HtmlService.createTemplateFromFile(...).evaluate() on a single top-level
 * file. This test enforces that shape directly against the files on disk
 * (there's no live Apps Script here to run the real parser — see
 * tests/README.md).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WEBAPP_DIR = path.resolve(__dirname, '..', '..', 'apps-script', 'webapp');

function read(filename) {
  return fs.readFileSync(path.join(WEBAPP_DIR, filename), 'utf8');
}

test('WebAppEntry.gs contains no include() function', () => {
  const content = read('WebAppEntry.gs');
  assert.doesNotMatch(content, /function\s+include\s*\(/);
});

test('Index.html contains no include(...) calls (neither Styles nor AppScript)', () => {
  const content = read('Index.html');
  assert.doesNotMatch(content, /include\(\s*['"]webapp\/Styles['"]/);
  assert.doesNotMatch(content, /include\(\s*['"]webapp\/AppScript['"]/);
  assert.doesNotMatch(content, /include\(/);
});

test('AccessDenied.html contains no include(...) calls', () => {
  const content = read('AccessDenied.html');
  assert.doesNotMatch(content, /include\(/);
});

test('Index.html and AccessDenied.html have no leftover unprocessed <?!= ... ?> scriptlets other than the ones they legitimately use', () => {
  // Legitimate scriptlets: <?= currentUserName ?>, <?!= JSON.stringify(...) ?>, <?= requestingEmail ?>.
  // None of them should reference include(...).
  ['Index.html', 'AccessDenied.html'].forEach((filename) => {
    const content = read(filename);
    const scriptlets = content.match(/<\?!?=.*?\?>/gs) || [];
    scriptlets.forEach((s) => assert.doesNotMatch(s, /include\(/));
  });
});

test('Index.html is self-contained: inlines the CSS (custom properties + key classes) directly', () => {
  const content = read('Index.html');
  assert.match(content, /<style>/);
  assert.match(content, /--fl-bg:/);
  assert.match(content, /\.badge-on-track/);
  assert.match(content, /\.kpi-card/);
});

test('Index.html contains exactly one <script> block for app code', () => {
  const content = read('Index.html');
  const scriptOpenTags = content.match(/<script>/g) || [];
  assert.strictEqual(scriptOpenTags.length, 1);
});

test('Index.html preserves CURRENT_USER, the router, and all 3 view placeholders', () => {
  const content = read('Index.html');
  assert.match(content, /var CURRENT_USER = \{/);
  assert.match(content, /name:\s*<\?!=\s*JSON\.stringify\(currentUserName\)\s*\?>/);
  assert.match(content, /email:\s*<\?!=\s*JSON\.stringify\(currentUserEmail\)\s*\?>/);
  assert.match(content, /var ROUTES = \{/);
  assert.match(content, /'control-center':\s*renderControlCenter/);
  assert.match(content, /'clients':\s*renderClients/);
  assert.match(content, /'tasks':\s*renderTasks/);
  assert.match(content, /function renderControlCenter/);
  assert.match(content, /function renderClients/);
  assert.match(content, /function renderTasks/);
});

test('Index.html\'s inlined script is syntactically closed (matching braces/parens, ends the IIFE and the <script> tag)', () => {
  const content = read('Index.html');
  assert.match(content, /}\s*\)\(\);\s*<\/script>/);
});

test('AccessDenied.html is self-contained: inlines the CSS it needs directly', () => {
  const content = read('AccessDenied.html');
  assert.match(content, /<style>/);
  assert.match(content, /--fl-text-muted:/);
  assert.match(content, /\.panel/);
});

test('AppScript.html (kept as a reference copy only) is syntactically complete', () => {
  const content = read('AppScript.html');
  assert.match(content, /^<script>/);
  assert.match(content, /};\s*\n\s*}\)\(\);\s*\n<\/script>/);
});

test('Styles.html (kept as a reference copy only) is syntactically complete', () => {
  const content = read('Styles.html');
  assert.match(content, /^<style>/);
  assert.match(content, /<\/style>/);
});
