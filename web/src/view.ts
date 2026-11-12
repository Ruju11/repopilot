import { clean, encodePath, isTrustedUrlBase } from '../../src/core/text.ts';
import type { Report, Status } from '../../src/core/types.ts';

/*
 * A display-ready copy of a report. Every string is meant to be shown as TEXT
 * (textContent), never as HTML. Links exist only when the report carries a
 * GitHub URL pinned to a full commit SHA; otherwise there are none.
 */

export interface EvidenceView {
  text: string;
  href?: string;
}

export interface RowView {
  status: Status;
  label: string;
  title: string;
  message: string;
  hint?: string;
  evidence: EvidenceView[];
  searched: string;
}

export interface ReportView {
  origin: string;
  summary: string;
  /** Link to the scanned commit; only for a pinned GitHub URL. */
  commitHref?: string;
  rows: RowView[];
  notes: string[];
}

export interface GroupView {
  status: Status;
  heading: string;
  rows: RowView[];
}

export interface ErrorView {
  title: string;
  advice: string;
  /** True when trying again is reasonable without changing the input. */
  retry: boolean;
}

const LABEL: Record<Status, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  'not-applicable': 'N/A',
};

/** Most urgent first. */
export const STATUS_ORDER: readonly Status[] = ['fail', 'warn', 'pass', 'not-applicable'];

export const STATUS_HEADING: Record<Status, string> = {
  fail: 'Failed',
  warn: 'Warnings',
  pass: 'Passed',
  'not-applicable': 'Not applicable',
};

export function toView(report: Report): ReportView {
  const base = isTrustedUrlBase(report.urlBase) ? report.urlBase : undefined;
  const { summary } = report;
  return {
    origin: clean(report.origin),
    summary: `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary['not-applicable']} not applicable`,
    ...(base === undefined ? {} : { commitHref: base.replace('/blob/', '/commit/').replace(/\/$/, '') }),
    rows: report.findings.map((finding) => ({
      status: finding.status,
      label: LABEL[finding.status],
      title: finding.title,
      message: clean(finding.message),
      ...(finding.hint === undefined ? {} : { hint: finding.hint }),
      evidence: finding.evidence.map((path) => ({
        text: clean(path),
        ...(base === undefined ? {} : { href: `${base}${encodePath(path)}` }),
      })),
      searched: clean(finding.searched.join(', ')),
    })),
    notes: report.notes.map(clean),
  };
}

/**
 * Groups file paths by their first folder for the repository map. The key '' holds root files.
 * Paths are untrusted; a Map is used so a folder named like an object property cannot collide.
 */
export function groupFilesByTopFolder(files: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of files) {
    const slash = path.indexOf('/');
    const key = slash === -1 ? '' : path.slice(0, slash);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [path]);
    else group.push(path);
  }
  return groups;
}

/** Groups rows by status, most urgent first, leaving out empty groups. */
export function groupRows(rows: RowView[]): GroupView[] {
  return STATUS_ORDER.map((status) => ({
    status,
    heading: STATUS_HEADING[status],
    rows: rows.filter((row) => row.status === status),
  })).filter((group) => group.rows.length > 0);
}

/** Turns a scan error message into a title and a next step. The message itself is shown as detail. */
export function explainError(message: string): ErrorView {
  if (/was not found, or it is private/.test(message)) {
    return { title: 'Repository not found', advice: 'Check the spelling of the owner and the repository name. Private repositories are not supported.', retry: false };
  }
  if (/limit of 60 unauthenticated requests/.test(message)) {
    // The source message carries the reset time only when GitHub reported one.
    const iso = /Resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(message)?.[1];
    const reset = iso === undefined ? undefined : new Date(iso);
    const when =
      reset === undefined || Number.isNaN(reset.getTime())
        ? 'GitHub did not say when the limit resets; it is usually within an hour.'
        : `You can scan again after ${reset.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (your local time).`;
    return { title: "GitHub's request limit was reached", advice: `GitHub limits unauthenticated requests per IP address. ${when}`, retry: false };
  }
  if (/Could not reach GitHub/.test(message)) {
    return { title: 'Could not reach GitHub', advice: 'Check your internet connection, then try again.', retry: true };
  }
  if (/moved or been renamed|redirect/.test(message)) {
    return { title: 'The repository has moved', advice: 'Enter the repository under its new name.', retry: false };
  }
  if (/refused the request/.test(message)) {
    // No retry button: repeating a refused request straight away can make a temporary block last longer.
    return {
      title: 'GitHub refused the request (HTTP 403)',
      advice:
        'GitHub refuses requests when too many arrive in a short time, or when access to a repository is blocked. Wait a few minutes before scanning again. If it still fails, open the repository on github.com to check that it is available.',
      retry: false,
    };
  }
  if (/could not read|too large to read|HTTP 5\d\d/.test(message)) {
    return { title: "GitHub's answer could not be used", advice: 'Try again later. A very large repository may be too big for this demo.', retry: true };
  }
  return { title: 'The scan failed', advice: 'Try again. If it keeps failing, check the repository name.', retry: true };
}
