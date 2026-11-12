import type { TestContext } from 'node:test';

/**
 * Use at the top of a test that needs a fixture the machine may not allow (a symbolic link).
 * Returns true when the fixture exists. Otherwise it skips the test, EXCEPT when
 * REQUIRE_LINK_TESTS=1 (set in CI), where a missing fixture throws: a failure, never a silent skip.
 */
export function fixtureOrSkip(t: TestContext, available: boolean, reason: string): boolean {
  if (available) return true;
  if (process.env.REQUIRE_LINK_TESTS === '1') {
    throw new Error(`REQUIRE_LINK_TESTS=1 but the fixture could not be created: ${reason}`);
  }
  t.skip(reason);
  return false;
}
