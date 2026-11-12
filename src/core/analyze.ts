import { checks } from './checks.ts';
import type { Report, RepoSnapshot, Status } from './types.ts';

/** Runs every check against the snapshot. Pure: same input, same output. */
export function analyze(snapshot: RepoSnapshot): Report {
  const findings = checks.map((check) => check.run(snapshot));
  const summary: Record<Status, number> = { pass: 0, warn: 0, fail: 0, 'not-applicable': 0 };
  for (const finding of findings) {
    summary[finding.status] += 1;
  }
  return { origin: snapshot.origin, summary, findings };
}
