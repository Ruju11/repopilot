import { clean, encodePath, isTrustedUrlBase } from '../core/text.ts';
import type { Report, Status } from '../core/types.ts';

/*
 * Every file name in a report comes from an untrusted repository. Nothing from a
 * report may become HTML, a link or an extra table column. Links are built only
 * from a validated GitHub URL pinned to a commit; any other base yields no links.
 */

const LABEL: Record<Status, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
  'not-applicable': 'N/A',
};

/** Plain text for a table cell or list item. */
function plain(text: string): string {
  return clean(text)
    .replaceAll('\\', '\\\\')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('`', "'")
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('|', '\\|')
    // GitHub-flavoured Markdown turns "www.x", "http(s)://x" and "a@b.c" in plain text into
    // clickable links. A zero-width space after the trigger stops that without changing what is read.
    .replaceAll(/www\./gi, (match) => `${match.slice(0, 3)}​.`)
    .replaceAll('://', ':​//')
    .replaceAll(/@(?=[A-Za-z0-9-]+\.)/g, '@​');
}

/** A code span (no angle brackets, so it is inert even in a renderer that allows HTML), linked if safe. */
function evidenceLink(path: string, urlBase: string | undefined): string {
  const label = `\`${clean(path).replaceAll('`', "'").replaceAll('<', '‹').replaceAll('>', '›')}\``;
  return urlBase === undefined ? label : `[${label}](${urlBase}${encodePath(path)})`;
}

export function toMarkdown(report: Report): string {
  const { summary } = report;
  const urlBase = isTrustedUrlBase(report.urlBase) ? report.urlBase : undefined;
  const lines = [
    `# RepoPilot report: ${plain(report.origin)}`,
    '',
    `${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failed, ${summary['not-applicable']} not applicable.`,
    '',
    '| Status | Check | Result | Evidence |',
    '|--------|-------|--------|----------|',
  ];
  for (const finding of report.findings) {
    const evidence =
      finding.evidence.length > 0
        ? finding.evidence.map((path) => evidenceLink(path, urlBase)).join(', ').replaceAll('|', '\\|')
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
      // Hints are fixed strings written in this project (one contains a trusted URL), not repository data.
      lines.push(`- **${plain(finding.title)}:** ${finding.hint ?? ''}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
