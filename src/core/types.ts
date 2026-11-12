/** A read-only view of a repository. Core checks never touch disk or network. */
export interface RepoSnapshot {
  /** Human-readable origin, e.g. a local path or "github.com/owner/repo". */
  origin: string;
  /** Repository-relative file paths using forward slashes. */
  files: string[];
  /** Text of selected small files (README, licence), keyed by path. */
  contents: Record<string, string>;
  /** Anything the reader should know about how complete this snapshot is. */
  notes: string[];
  /** When set, evidence paths can be linked as urlBase plus the encoded path. */
  urlBase?: string;
  /** GitHub API requests left in the current hour, when GitHub reported it. Not part of the report. */
  apiRemaining?: number;
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
  notes: string[];
  urlBase?: string;
}

export interface Check {
  id: string;
  title: string;
  run(snapshot: RepoSnapshot): Finding;
}
