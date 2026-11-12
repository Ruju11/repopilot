import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { analyze } from '../src/core/analyze.ts';
import { createStaticServer, resolveServable, resolveStatic } from '../scripts/serve.ts';
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

test('the demo intro says the Evidence column shows file names', () => {
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');
  assert.match(html, /Evidence column shows the <strong>file names<\/strong> a check matched, as plain text/);
  assert.match(html, /no link is made because no real repository is behind them/);
});

// --- links inside web/ must not expose files outside it ---

const temp = mkdtempSync(join(tmpdir(), 'repopilot-serve-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const root = join(temp, 'web');
const outside = join(temp, 'outside');
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(root, 'ok.css'), 'body{}');
writeFileSync(join(outside, 'secret.css'), 'TOP-SECRET');
let links = 0;
const tryLink = (target: string, path: string, type: 'junction' | 'file'): void => {
  try {
    symlinkSync(target, path, type);
    links += 1;
  } catch {
    // not permitted on this system
  }
};
tryLink(outside, join(root, 'dir-link'), 'junction'); // a folder link (a junction on Windows)
tryLink(join(outside, 'secret.css'), join(root, 'file-link.css'), 'file');
const rootLink = join(temp, 'web-link');
tryLink(root, rootLink, 'junction');

test('REGRESSION: a link inside web/ cannot serve a file outside it', (t) => {
  if (links === 0) {
    t.skip('cannot create links on this system');
    return;
  }
  // The name-only check is fooled by links; that is why the real-path check exists.
  assert.ok(resolveStatic(root, '/dir-link/secret.css'));
  assert.equal(resolveServable(root, '/dir-link/secret.css'), undefined);
  assert.equal(resolveServable(root, '/file-link.css'), undefined);
  assert.ok(resolveServable(root, '/ok.css')?.endsWith('ok.css'));
  assert.equal(resolveServable(root, '/missing.css'), undefined);
});

test('a web/ folder that is itself a link still serves its own files and nothing else', (t) => {
  if (!resolveStatic(rootLink, '/ok.css') || links === 0) {
    t.skip('cannot create links on this system');
    return;
  }
  assert.ok(resolveServable(rootLink, '/ok.css')?.endsWith('ok.css'));
  assert.equal(resolveServable(rootLink, '/dir-link/secret.css'), undefined);
});

test('REGRESSION over HTTP: the server answers 404 and never sends the outside file', async (t) => {
  if (links === 0) {
    t.skip('cannot create links on this system');
    return;
  }
  const server = createStaticServer(root);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const path of ['/dir-link/secret.css', '/file-link.css', '/dir-link/../ok.css/../dir-link/secret.css']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.ok(!(await response.text()).includes('TOP-SECRET'), path);
    }
    const ok = await fetch(`${base}/ok.css`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'body{}');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
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
