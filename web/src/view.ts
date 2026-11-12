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
  rows: RowView[];
  notes: string[];
}

const LABEL: Record<Status, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  'not-applicable': 'N/A',
};

export function toView(report: Report): ReportView {
  const base = isTrustedUrlBase(report.urlBase) ? report.urlBase : undefined;
  const { summary } = report;
  return {
    origin: clean(report.origin),
    summary: `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary['not-applicable']} not applicable`,
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
