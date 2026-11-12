import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('the demo intro describes sample evidence as file names and makes no claim of links', () => {
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');
  assert.match(html, /Evidence column shows the <strong>file names<\/strong> a check matched, as plain text/);
  assert.match(html, /no link is made because no real repository is behind them/);
  assert.doesNotMatch(html, /linked to its source/i);
});

// --- static server: normal behaviour (needs no links, so it always runs) ---

const temp = mkdtempSync(join(tmpdir(), 'repopilot-serve-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const root = join(temp, 'web');
const outside = join(temp, 'outside');
mkdirSync(root);
mkdirSync(outside);
writeFileSync(join(root, 'ok.css'), 'body{}');
writeFileSync(join(outside, 'secret.css'), 'TOP-SECRET');

async function withServer(dir: string, run: (base: string) => Promise<void>): Promise<void> {
  const server = createStaticServer(dir);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

test('POSITIVE over HTTP: a normal file is served with security headers (no links needed)', async () => {
  await withServer(root, async (base) => {
    const ok = await fetch(`${base}/ok.css`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'body{}');
    assert.equal(ok.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    assert.match(ok.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    assert.equal((await fetch(`${base}/missing.css`)).status, 404);
    assert.equal((await fetch(`${base}/ok.css`, { method: 'POST' })).status, 404);
  });
  assert.ok(resolveServable(root, '/ok.css')?.endsWith('ok.css'));
});

// --- links inside web/ must not expose files outside it ---
// Each test builds and proves its OWN fixture and skips alone when that fixture cannot be made.

/** Creates a link, then proves it resolves to the intended target. False if it cannot be made or is wrong. */
function makeLink(target: string, path: string, type: 'junction' | 'file'): boolean {
  try {
    symlinkSync(target, path, type);
    return realpathSync.native(path) === realpathSync.native(target);
  } catch {
    return false;
  }
}

const dirLink = makeLink(outside, join(root, 'dir-link'), 'junction'); // a junction on Windows
const fileLink = makeLink(join(outside, 'secret.css'), join(root, 'file-link.css'), 'file');
const rootLink = makeLink(root, join(temp, 'web-link'), 'junction');

/** Proof that the fixture would leak without the real-path check: reading through the link works. */
const leaksThrough = (path: string): void => assert.equal(readFileSync(path, 'utf8'), 'TOP-SECRET');

test('REGRESSION: a folder link inside web/ cannot serve a file outside it', async (t) => {
  if (!dirLink) return t.skip('could not create the folder link fixture');
  leaksThrough(join(root, 'dir-link', 'secret.css'));
  assert.ok(resolveStatic(root, '/dir-link/secret.css'), 'the name-only check is fooled by links');
  assert.equal(resolveServable(root, '/dir-link/secret.css'), undefined);
  await withServer(root, async (base) => {
    for (const path of ['/dir-link/secret.css', '/dir-link%2Fsecret.css']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.ok(!(await response.text()).includes('TOP-SECRET'), path);
    }
  });
});

test('REGRESSION: a file link inside web/ cannot serve a file outside it', async (t) => {
  if (!fileLink) return t.skip('could not create the file link fixture');
  leaksThrough(join(root, 'file-link.css'));
  assert.ok(resolveStatic(root, '/file-link.css'), 'the name-only check is fooled by links');
  assert.equal(resolveServable(root, '/file-link.css'), undefined);
  await withServer(root, async (base) => {
    const response = await fetch(`${base}/file-link.css`);
    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes('TOP-SECRET'));
  });
});

test('a web/ folder that is itself a link still serves its own files', (t) => {
  if (!rootLink) return t.skip('could not create the root link fixture');
  assert.equal(readFileSync(join(temp, 'web-link', 'ok.css'), 'utf8'), 'body{}');
  assert.ok(resolveServable(join(temp, 'web-link'), '/ok.css')?.endsWith('ok.css'));
});

test('REGRESSION: links inside a web/ folder reached through a root link are still refused', (t) => {
  if (!rootLink) return t.skip('could not create the root link fixture');
  if (!dirLink) return t.skip('could not create the folder link fixture');
  leaksThrough(join(temp, 'web-link', 'dir-link', 'secret.css'));
  assert.equal(resolveServable(join(temp, 'web-link'), '/dir-link/secret.css'), undefined);
});

test('the local server only serves files below web/', () => {
  const base = join(webDir);
  assert.equal(resolveStatic(base, '/'), join(base, 'index.html'));
  assert.equal(resolveStatic(base, '/style.css?x=1'), join(base, 'style.css'));
  assert.equal(resolveStatic(base, '/dist/web/src/main.js'), join(base, 'dist', 'web', 'src', 'main.js'));
  const refused = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/a\\b.css', '/index.html%00', '/%zz', '/package.json', '/src/main.ts', '//etc/passwd', '/C:/Windows/win.ini', '/dist/', '/.env'];
  for (const path of refused) {
    assert.equal(resolveStatic(base, path), undefined, path);
  }
});
