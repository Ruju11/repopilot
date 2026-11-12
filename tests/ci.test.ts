import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

test('the CI workflow can only read the repository and uses no secrets', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/\bwrite\b/.test(workflow.replace(/^\s*#.*$/gm, '')), 'no write permission');
  assert.ok(!/secrets\./.test(workflow), 'no secrets');
  assert.ok(!/pull_request_target|workflow_run/.test(workflow), 'no privileged triggers');
});

test('every action is pinned to a full commit SHA', () => {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? '');
  assert.equal(uses.length, 2);
  for (const reference of uses) {
    assert.match(reference, /^actions\/[\w.-]+@[0-9a-f]{40}$/, reference);
  }
});

test('the workflow is minimal: Linux, one supported Node version, clean install, full verify', () => {
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /run: npm ci --ignore-scripts/);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(!/\$\{\{\s*github\.(event|head_ref)/.test(workflow), 'no event data in the workflow');
  const engines = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node as string;
  assert.equal(engines, '>=24.2', 'workflow Node 24 must satisfy engines');
});

test('CI requires link fixtures, so the symlink tests fail instead of skipping on Linux', () => {
  assert.match(workflow, /env:\n\s+#[^\n]*\n\s+#[^\n]*\n\s+REQUIRE_LINK_TESTS: '1'/);
  for (const file of ['cli.test.ts', 'web.test.ts']) {
    const source = readFileSync(join(root, 'tests', file), 'utf8');
    assert.ok(source.includes('fixtureOrSkip('), `${file} uses fixtureOrSkip`);
    assert.ok(!/t\.skip\(/.test(source), `${file} must not skip directly`);
  }
});

const pages = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');

test('the Pages workflow starts only by hand, is pinned, and gives write access to the deploy job only', () => {
  assert.match(pages, /^on:\n {2}workflow_dispatch:\n/m);
  assert.ok(!/^\s+(push|pull_request|pull_request_target|schedule|workflow_run):/m.test(pages), 'no automatic trigger');
  assert.match(pages, /^permissions:\n {2}contents: read\n/m);
  const uses = [...pages.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? '');
  assert.equal(uses.length, 4);
  for (const reference of uses) assert.match(reference, /^actions\/[\w.-]+@[0-9a-f]{40}$/, reference);
  const deployJob = pages.slice(pages.indexOf('\n  deploy:'));
  assert.match(deployJob, /permissions:\n {6}pages: write\n {6}id-token: write\n/);
  const buildJob = pages.slice(pages.indexOf('\n  build:'), pages.indexOf('\n  deploy:'));
  assert.ok(!/pages: write|id-token: write/.test(buildJob), 'build job has no write access');
  assert.ok(!/secrets\./.test(pages), 'no secrets');
  assert.ok(!/\$\{\{\s*github\.(event|head_ref)/.test(pages), 'no event data');
  assert.match(pages, /REQUIRE_LINK_TESTS: '1'/);
  assert.match(pages, /path: web\n/);
});

test('package-lock.json is committed, matches package.json, and is usable by npm ci', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  assert.ok(lock.lockfileVersion >= 3);
  assert.equal(lock.name, pkg.name);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
  for (const [name, version] of Object.entries(pkg.devDependencies as Record<string, string>)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} is pinned and locked`);
  }
});
