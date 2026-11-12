import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fixtureOrSkip } from './support.ts';

function fakeContext(): { t: TestContext; skips: string[] } {
  const skips: string[] = [];
  const t = { skip: (message?: string) => void skips.push(message ?? '') } as unknown as TestContext;
  return { t, skips };
}

function withEnv(value: string | undefined, run: () => void): void {
  const saved = process.env.REQUIRE_LINK_TESTS;
  if (value === undefined) delete process.env.REQUIRE_LINK_TESTS;
  else process.env.REQUIRE_LINK_TESTS = value;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.REQUIRE_LINK_TESTS;
    else process.env.REQUIRE_LINK_TESTS = saved;
  }
}

test('an available fixture lets the test run, in any mode', () => {
  for (const mode of [undefined, '1']) {
    withEnv(mode, () => {
      const { t, skips } = fakeContext();
      assert.equal(fixtureOrSkip(t, true, 'x'), true);
      assert.deepEqual(skips, []);
    });
  }
});

test('a missing fixture is skipped by default, with the reason recorded', () => {
  withEnv(undefined, () => {
    const { t, skips } = fakeContext();
    assert.equal(fixtureOrSkip(t, false, 'no links here'), false);
    assert.deepEqual(skips, ['no links here']);
  });
});

test('with REQUIRE_LINK_TESTS=1 a missing fixture is a failure, never a skip', () => {
  withEnv('1', () => {
    const { t, skips } = fakeContext();
    assert.throws(() => fixtureOrSkip(t, false, 'no links here'), /REQUIRE_LINK_TESTS=1 but the fixture could not be created: no links here/);
    assert.deepEqual(skips, []);
  });
});
