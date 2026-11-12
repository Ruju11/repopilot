/** A read-only view of a repository. Core checks never touch disk or network. */
export interface RepoSnapshot {
  /** Human-readable origin, e.g. a local path or "owner/repo". */
  origin: string;
  /** Repository-relative file paths using forward slashes. */
  files: string[];
  /** Text of selected small files (README, licence), keyed by path. */
  contents: Record<string, string>;
}

export type Status = 'pass' | 'warn' | 'fail' | 'not-applicable';

export interface Finding {
  id: string;
  title: string;
  status: Status;
  message: string;
  /** Files that support the finding. */
  evidence: string[];
  /** Locations that were searched; shown when nothing was found. */
  searched: string[];
  /** How to fix it. Present unless the check passed. */
  hint?: string;
}

export interface Report {
  origin: string;
  summary: Record<Status, number>;
  findings: Finding[];
}

export interface Check {
  id: string;
  title: string;
  run(snapshot: RepoSnapshot): Finding;
}
