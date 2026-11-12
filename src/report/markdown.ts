import type { Report, Status } from '../core/types.ts';

const LABEL: Record<Status, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  'not-applicable': 'N/A',
};

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ');
}

export function toMarkdown(report: Report): string {
  const { summary } = report;
  const lines = [
    `# RepoPilot report: ${report.origin}`,
    '',
    `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary['not-applicable']} not applicable.`,
    '',
    '| Status | Check | Result | Evidence |',
    '|--------|-------|--------|----------|',
  ];
  for (const finding of report.findings) {
    const evidence =
      finding.evidence.length > 0
        ? finding.evidence.map((path) => `\`${path}\``).join(', ')
        : `searched: ${finding.searched.join(', ')}`;
    lines.push(
      `| ${LABEL[finding.status]} | ${cell(finding.title)} | ${cell(finding.message)} | ${cell(evidence)} |`,
    );
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
