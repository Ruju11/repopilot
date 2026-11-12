import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/cli/main.ts';
import { readLocalRepo } from '../src/sources/local.ts';

const temp = mkdtempSync(join(tmpdir(), 'repopilot-'));
after(() => rmSync(temp, { recursive: true, force: true }));

function makeRepo(name: string, files: Record<string, string>): string {
  const root = join(temp, name);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
  }
  mkdirSync(root, { recursive: true });
  return root;
}

function cli(...argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = run(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

const good = makeRepo('good', {
  'README.md': `# Good\n\n${'Readable documentation. '.repeat(12)}`,
  LICENSE: 'MIT License\n\nPermission is hereby granted, free of charge',
  'SECURITY.md': 'Report privately.',
  '.github/workflows/ci.yml': 'name: ci',
  '.git/config': 'ignored',
  'node_modules/dep/README.md': 'ignored',
});
const empty = makeRepo('empty', {});

test('local source lists files with forward slashes and skips .git and node_modules', () => {
  const snapshot = readLocalRepo(good);
  assert.deepEqual(snapshot.files, ['.github/workflows/ci.yml', 'LICENSE', 'README.md', 'SECURITY.md']);
  assert.deepEqual(Object.keys(snapshot.contents).sort(), ['LICENSE', 'README.md']);
});

test('local source does not follow symbolic links', (t) => {
  const outside = makeRepo('outside', { 'SECURITY.md': 'outside' });
  const repo = makeRepo('linked', { 'README.md': 'x' });
  try {
    symlinkSync(outside, join(repo, 'docs'), 'junction');
  } catch {
    t.skip('cannot create a link on this system');
    return;
  }
  assert.deepEqual(readLocalRepo(repo).files, ['README.md']);
});

test('check exits 0 and prints Markdown when nothing fails', () => {
  const result = cli('check', good);
  assert.equal(result.code, 0);
  assert.match(result.out, /^# RepoPilot report/);
  assert.match(result.out, /\| PASS \| Security policy \|/);
  assert.match(result.out, /looks like MIT/);
});

test('check exits 1 when a required check fails', () => {
  const result = cli('check', empty);
  assert.equal(result.code, 1);
  assert.match(result.out, /\| FAIL \| README \|/);
  assert.match(result.out, /## Suggested fixes/);
});

test('--format json prints a parseable report', () => {
  const result = cli('check', empty, '--format', 'json');
  const report = JSON.parse(result.out);
  assert.equal(report.summary.fail, 4);
  assert.equal(report.findings.length, 12);
});

test('bad input exits 2 with a message on stderr and nothing on stdout', () => {
  for (const argv of [[], ['check'], ['scan', good], ['check', good, '--format', 'xml'], ['check', good, '--nope']]) {
    const result = cli(...argv);
    assert.equal(result.code, 2, argv.join(' '));
    assert.equal(result.out, '');
    assert.notEqual(result.err, '');
  }
  const missing = cli('check', join(temp, 'does-not-exist'));
  assert.equal(missing.code, 2);
  assert.match(missing.err, /Not a directory/);
});
