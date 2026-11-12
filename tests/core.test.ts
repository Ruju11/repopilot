import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../src/core/analyze.ts';
import type { Finding, RepoSnapshot } from '../src/core/types.ts';

const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person...';
const LONG_README = `# Demo\n\n${'This project does something useful. '.repeat(10)}`;

function snapshot(contents: Record<string, string>, extraFiles: string[] = []): RepoSnapshot {
  return { origin: 'test', files: [...Object.keys(contents), ...extraFiles], contents };
}

function finding(repo: RepoSnapshot, id: string): Finding {
  const found = analyze(repo).findings.find((item) => item.id === id);
  assert.ok(found, `no finding with id ${id}`);
  return found;
}

const complete = snapshot({ 'README.md': LONG_README, LICENSE: MIT }, [
  'SECURITY.md',
  '.github/workflows/ci.yml',
  '.gitignore',
  'package.json',
  'package-lock.json',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug.md',
  '.github/CODEOWNERS',
]);

test('a complete repository passes every check', () => {
  const report = analyze(complete);
  assert.deepEqual(
    report.findings.filter((item) => item.status !== 'pass'),
    [],
  );
  assert.equal(report.summary.pass, report.findings.length);
});

test('an empty repository fails the required checks and warns on the rest', () => {
  const report = analyze(snapshot({}));
  const failed = report.findings.filter((item) => item.status === 'fail').map((item) => item.id);
  assert.deepEqual(failed.sort(), ['ci', 'license', 'readme', 'security-policy']);
  assert.equal(finding(snapshot({}), 'lockfile').status, 'not-applicable');
  assert.equal(report.summary.fail, 4);
});

test('every finding that did not pass says where it looked and how to fix it', () => {
  for (const item of analyze(snapshot({})).findings) {
    assert.ok(item.searched.length > 0, `${item.id} has no searched locations`);
    if (item.status === 'warn' || item.status === 'fail') {
      assert.ok(item.hint, `${item.id} has no hint`);
    }
  }
});

test('passing findings name the file as evidence', () => {
  assert.deepEqual(finding(complete, 'security-policy').evidence, ['SECURITY.md']);
  assert.deepEqual(finding(complete, 'ci').evidence, ['.github/workflows/ci.yml']);
});

test('a very short README is a warning', () => {
  const result = finding(snapshot({ 'README.md': '# Demo' }), 'readme');
  assert.equal(result.status, 'warn');
  assert.match(result.message, /6 characters/);
});

test('README is found case-insensitively and under .github', () => {
  assert.equal(finding(snapshot({ 'readme.rst': LONG_README }), 'readme').status, 'pass');
  assert.equal(finding(snapshot({ '.github/README.md': LONG_README }), 'readme').status, 'pass');
});

test('a README in an unrelated subfolder does not count', () => {
  assert.equal(finding(snapshot({ 'src/README.md': LONG_README }), 'readme').status, 'fail');
});

test('licence type is detected from its text', () => {
  assert.match(finding(snapshot({ LICENSE: MIT }), 'license').message, /MIT/);
  const apache = snapshot({ 'LICENSE.txt': 'Apache License\nVersion 2.0, January 2004' });
  assert.match(finding(apache, 'license').message, /Apache-2\.0/);
  const agpl = snapshot({ COPYING: 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007' });
  assert.match(finding(agpl, 'license').message, /AGPL-3\.0/);
});

test('an unrecognised licence text is a warning, not a pass', () => {
  const result = finding(snapshot({ LICENSE: 'All rights reserved.' }), 'license');
  assert.equal(result.status, 'warn');
});

test('a manifest without a lockfile is a warning naming the ecosystem', () => {
  const result = finding(snapshot({}, ['package.json', 'Cargo.toml', 'Cargo.lock']), 'lockfile');
  assert.equal(result.status, 'warn');
  assert.match(result.message, /npm/);
  assert.doesNotMatch(result.message, /Rust/);
});

test('a workflow file outside .github/workflows is not CI', () => {
  assert.equal(finding(snapshot({}, ['workflows/ci.yml']), 'ci').status, 'fail');
  assert.equal(finding(snapshot({}, ['.gitlab-ci.yml']), 'ci').status, 'pass');
});

test('analysis does not change its input and is repeatable', () => {
  const before = JSON.stringify(complete);
  const first = analyze(complete);
  const second = analyze(complete);
  assert.equal(JSON.stringify(complete), before);
  assert.deepEqual(first, second);
});
