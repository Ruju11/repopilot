import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { run } from '../src/cli/main.ts';
import { readLocalRepo, type DirEntry, type LocalFs } from '../src/sources/local.ts';
import { fixtureOrSkip } from './support.ts';

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

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await run(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
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

// --- a fake file system for failure cases that cannot be provoked portably ---

const file = (name: string): DirEntry => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
const dir = (name: string): DirEntry => ({ name, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false });
const link = (name: string): DirEntry => ({ name, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true });
const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });

function fakeFs(
  dirs: Record<string, DirEntry[] | Error>,
  texts: Record<string, string | Error> = {},
  sizes: Record<string, number> = {},
): LocalFs {
  return {
    stat: (path) => {
      if (path in dirs) return { isDirectory: () => true, size: 0 };
      if (path in texts) return { isDirectory: () => false, size: sizes[path] ?? 10 };
      return undefined;
    },
    readdir: (path) => {
      const entries = dirs[path];
      if (entries === undefined) throw new Error('ENOENT');
      if (entries instanceof Error) throw entries;
      return entries;
    },
    readText: (path) => {
      const text = texts[path];
      if (text === undefined) throw new Error('ENOENT');
      if (text instanceof Error) throw text;
      return text;
    },
  };
}

test('local source lists files with forward slashes and skips .git and node_modules', () => {
  const snapshot = readLocalRepo(good);
  assert.deepEqual(snapshot.files, ['.github/workflows/ci.yml', 'LICENSE', 'README.md', 'SECURITY.md']);
  assert.deepEqual(Object.keys(snapshot.contents).sort(), ['LICENSE', 'README.md']);
  assert.deepEqual(snapshot.notes, []);
});

test('real symbolic links and junctions are not followed and are reported', (t) => {
  const outside = makeRepo('outside', { 'SECURITY.md': 'outside' });
  const repo = makeRepo('linked', { 'README.md': 'x' });
  let links = 0;
  try {
    symlinkSync(outside, join(repo, 'docs'), 'junction');
    links += 1;
  } catch {
    // not permitted on this system
  }
  try {
    symlinkSync(join(outside, 'SECURITY.md'), join(repo, 'SECURITY.md'), 'file');
    links += 1;
  } catch {
    // not permitted on this system
  }
  // Locally, either kind of link is enough to run; in CI (REQUIRE_LINK_TESTS=1) both must exist.
  const needed = process.env.REQUIRE_LINK_TESTS === '1' ? links === 2 : links > 0;
  if (!fixtureOrSkip(t, needed, 'cannot create both a folder link and a file link on this system')) return;
  const snapshot = readLocalRepo(repo);
  assert.deepEqual(snapshot.files, ['README.md']);
  assert.ok(snapshot.notes.includes(`${links} symbolic link(s) were not followed.`), snapshot.notes.join(' | '));
});

test('symbolic links are skipped even when they look like required files', () => {
  const snapshot = readLocalRepo('root', fakeFs({ root: [link('README.md'), link('docs'), file('LICENSE')] }, { [join('root', 'LICENSE')]: 'x' }));
  assert.deepEqual(snapshot.files, ['LICENSE']);
  assert.deepEqual(snapshot.notes, ['2 symbolic link(s) were not followed.']);
});

test('an unreadable subfolder is skipped and reported; the rest is still scanned', () => {
  const fs = fakeFs({
    root: [file('README.md'), dir('private'), dir('ok')],
    [join('root', 'private')]: denied,
    [join('root', 'ok')]: [file('SECURITY.md')],
  }, { [join('root', 'README.md')]: 'hello' });
  const snapshot = readLocalRepo('root', fs);
  assert.deepEqual(snapshot.files, ['README.md', 'ok/SECURITY.md']);
  assert.deepEqual(snapshot.notes, ['Skipped unreadable folder private (EACCES).']);
});

test('an unreadable top folder is an error, not an empty report', () => {
  assert.throws(() => readLocalRepo('root', fakeFs({ root: denied })), /Cannot read folder "root": EACCES/);
});

test('a failing stat on the top folder is reported', () => {
  const fs: LocalFs = { ...fakeFs({}), stat: () => { throw denied; } };
  assert.throws(() => readLocalRepo('root', fs), /Cannot access "root": EACCES/);
});

test('an unreadable or oversized README is reported, not fatal', () => {
  const unreadable = readLocalRepo('root', fakeFs({ root: [file('README.md')] }, { [join('root', 'README.md')]: Object.assign(new Error('io'), { code: 'EIO' }) }));
  assert.deepEqual(unreadable.notes, ['Could not read README.md (EIO).']);
  assert.deepEqual(unreadable.contents, {});

  const big = readLocalRepo('root', fakeFs({ root: [file('README.md')] }, { [join('root', 'README.md')]: 'x' }, { [join('root', 'README.md')]: 300 * 1024 }));
  assert.deepEqual(big.notes, ['README.md is larger than 256 KB and was not read.']);
  assert.deepEqual(big.contents, {});
});

test('deep folders and huge folders are cut off and the report says so', () => {
  const deep = readLocalRepo('root', fakeFs({
    root: [dir('a')],
    [join('root', 'a')]: [dir('b')],
    [join('root', 'a', 'b')]: [dir('c')],
    [join('root', 'a', 'b', 'c')]: [dir('d')],
    [join('root', 'a', 'b', 'c', 'd')]: [dir('e'), file('x')],
  }));
  assert.deepEqual(deep.files, ['a/b/c/d/x']);
  assert.deepEqual(deep.notes, ['Folders nested deeper than 4 levels were not scanned.']);

  const many = readLocalRepo('root', fakeFs({ root: Array.from({ length: 20_001 }, (_, i) => file(`f${i}.txt`)) }));
  assert.equal(many.files.length, 20_000);
  assert.deepEqual(many.notes, ['Stopped after 20000 files; later files were not scanned.']);
});

test('control characters in names cannot break the notes', () => {
  const snapshot = readLocalRepo('root', fakeFs({ root: [dir('bad\nname')], [join('root', 'bad\nname')]: denied }));
  assert.deepEqual(snapshot.notes, ['Skipped unreadable folder bad?name (EACCES).']);
});

test('check exits 0 and prints Markdown when nothing fails', async () => {
  const result = await cli('check', good);
  assert.equal(result.code, 0);
  assert.match(result.out, /^# RepoPilot report/);
  assert.match(result.out, /\| PASS \| Security policy \|/);
  assert.match(result.out, /keyword match suggests MIT/);
});

test('check exits 1 when a required check fails', async () => {
  const result = await cli('check', empty);
  assert.equal(result.code, 1);
  assert.match(result.out, /\| FAIL \| README \|/);
  assert.match(result.out, /## Suggested fixes/);
});

test('--format json prints a parseable report', async () => {
  const result = await cli('check', empty, '--format', 'json');
  const report = JSON.parse(result.out);
  assert.equal(report.summary.fail, 4);
  assert.equal(report.findings.length, 12);
  assert.deepEqual(report.notes, []);
});

test('bad or malformed input exits 2 with a message on stderr and nothing on stdout', async () => {
  const cases = [
    [],
    ['check'],
    ['scan', good],
    ['check', good, 'extra'],
    ['check', good, '--format', 'xml'],
    ['check', good, '--format'],
    ['check', good, '--nope'],
    ['check', ''],
    ['check', 'bad\0path'],
    ['check', join(good, 'README.md')],
    ['check', 'github:'],
    ['check', 'github:a/b/c'],
    ['check', 'github:../x'],
    ['check', 'https://github.com/only-owner'],
  ];
  for (const argv of cases) {
    const result = await cli(...argv);
    assert.equal(result.code, 2, JSON.stringify(argv));
    assert.equal(result.out, '', JSON.stringify(argv));
    assert.notEqual(result.err, '', JSON.stringify(argv));
  }
  assert.match((await cli('check', join(temp, 'does-not-exist'))).err, /Not a directory/);
  assert.match((await cli('check', join(good, 'README.md'))).err, /Not a directory/);
  assert.doesNotMatch((await cli('check', 'bad\0path')).err, /\0/);
});
