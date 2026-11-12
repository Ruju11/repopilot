import { clean, encodePath } from '../core/text.ts';
import type { Report, Status } from '../core/types.ts';

const LABEL: Record<Status, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  'not-applicable': 'N/A',
};

/** Plain text for a table cell or list item: no control characters, backticks or pipes. */
function plain(text: string): string {
  return clean(text).replaceAll('`', "'").replaceAll('|', '\\|');
}

/** Paths come from untrusted repositories: neutralise control characters and backticks. */
function evidenceLink(path: string, urlBase: string | undefined): string {
  const label = `\`${clean(path).replaceAll('`', "'")}\``;
  return urlBase === undefined ? label : `[${label}](${urlBase}${encodePath(path)})`;
}

export function toMarkdown(report: Report): string {
  const { summary } = report;
  const lines = [
    `# RepoPilot report: ${clean(report.origin)}`,
    '',
    `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary['not-applicable']} not applicable.`,
    '',
    '| Status | Check | Result | Evidence |',
    '|--------|-------|--------|----------|',
  ];
  for (const finding of report.findings) {
    const evidence =
      finding.evidence.length > 0
        ? finding.evidence.map((path) => evidenceLink(path, report.urlBase)).join(', ').replaceAll('|', '\\|')
        : plain(`searched: ${finding.searched.join(', ')}`);
    lines.push(`| ${LABEL[finding.status]} | ${plain(finding.title)} | ${plain(finding.message)} | ${evidence} |`);
  }
  if (report.notes.length > 0) {
    lines.push('', '## Notes', '');
    for (const note of report.notes) {
      lines.push(`- ${plain(note)}`);
    }
  }
  const fixes = report.findings.filter((finding) => finding.hint !== undefined);
  if (fixes.length > 0) {
    lines.push('', '## Suggested fixes', '');
    for (const finding of fixes) {
      lines.push(`- **${finding.title}:** ${finding.hint}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
