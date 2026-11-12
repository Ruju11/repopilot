import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyze } from '../src/core/analyze.ts';
import { resolveStatic } from '../scripts/serve.ts';
import { SAMPLES } from '../web/src/samples.ts';
import { toView } from '../web/src/view.ts';

const webDir = join(import.meta.dirname, '..', 'web');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const sample = (id: string) => {
  const found = SAMPLES.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};

test('samples are distinct and give the results they describe', () => {
  assert.equal(new Set(SAMPLES.map((item) => item.id)).size, SAMPLES.length);
  const well = analyze(sample('well-kept').snapshot);
  assert.equal(well.summary.pass, well.findings.length);
  assert.ok(analyze(sample('bare').snapshot).summary.fail >= 3);
});

test('hostile names reach the view as plain text, never as links', () => {
  const view = toView(analyze(sample('hostile').snapshot));
  const ci = view.rows.find((row) => row.title === 'Continuous integration');
  assert.deepEqual(ci?.evidence.map((item) => item.text), [
    '.github/workflows/<img src=x onerror=alert(1)>.yml',
    '.github/workflows/www.evil.example.yml',
  ]);
  assert.ok(view.rows.every((row) => row.evidence.every((item) => item.href === undefined)));
});

test('links appear only for a GitHub URL pinned to a full commit SHA', () => {
  const report = analyze(sample('hostile').snapshot);
  const pinned = toView({ ...report, urlBase: `https://github.com/o/r/blob/${SHA}/` });
  const hrefs = pinned.rows.flatMap((row) => row.evidence.map((item) => item.href));
  assert.ok(hrefs.length > 0);
  assert.ok(hrefs.every((href) => href?.startsWith(`https://github.com/o/r/blob/${SHA}/`)));
  assert.ok(hrefs.some((href) => href?.includes('%3Cimg')));
  for (const urlBase of ['javascript:alert(1)//', 'https://github.com/o/r/blob/HEAD/', 'https://evil.test/o/r/blob/' + SHA + '/', undefined]) {
    const view = toView({ ...report, urlBase });
    assert.ok(view.rows.every((row) => row.evidence.every((item) => item.href === undefined)), String(urlBase));
  }
});

test('demo code never parses HTML or runs strings as code', () => {
  const files = readdirSync(join(webDir, 'src')).map((name) => join(webDir, 'src', name));
  assert.ok(files.length >= 3);
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setTimeout\s*\(\s*['"`]|DOMParser|createContextualFragment|javascript:/;
  for (const file of files) {
    assert.ok(!banned.test(readFileSync(file, 'utf8')), file);
  }
});

test('the page is locked down: strict policy, no network, no inline code or handlers', () => {
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  for (const rule of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "img-src 'none'"]) {
    assert.ok(policy.includes(rule), rule);
  }
  assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(policy));
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'inline script');
  assert.ok(!/\son\w+\s*=/i.test(html), 'inline event handler');
  assert.ok(!/(?:src|href)\s*=\s*"(?:https?:)?\/\//i.test(html), 'external resource');
});

test('the local server only serves files below web/', () => {
  const root = join(webDir);
  assert.equal(resolveStatic(root, '/'), join(root, 'index.html'));
  assert.equal(resolveStatic(root, '/style.css?x=1'), join(root, 'style.css'));
  assert.equal(resolveStatic(root, '/dist/web/src/main.js'), join(root, 'dist', 'web', 'src', 'main.js'));
  const refused = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/a\\b.css', '/index.html%00', '/%zz', '/package.json', '/src/main.ts', '//etc/passwd', '/C:/Windows/win.ini', '/dist/', '/.env'];
  for (const path of refused) {
    assert.equal(resolveStatic(root, path), undefined, path);
  }
});
