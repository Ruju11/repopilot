import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');

test('the CI workflow can only read the repository and uses no secrets', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/\bwrite\b/.test(workflow.replace(/^#.*$/gm, '')), 'no write permission');
  assert.ok(!/secrets\./.test(workflow), 'no secrets');
  assert.ok(!/pull_request_target|workflow_run/.test(workflow), 'no privileged triggers');
});

test('every action is pinned to a full commit SHA', () => {
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? '');
  assert.ok(uses.length >= 2);
  for (const reference of uses) {
    assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, reference);
  }
});

test('the workflow runs untrusted event data nowhere, installs without scripts, and runs the full gate', () => {
  assert.ok(!/\$\{\{\s*github\.(event|head_ref)/.test(workflow), 'no event data in the workflow');
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /run: npm audit/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node: \['24', '26'\]/);
});
