import { analyze } from '../core/analyze.ts';
import { toMarkdown } from '../report/markdown.ts';
import { readLocalRepo } from '../sources/local.ts';

const USAGE = `Usage: repopilot check <folder> [--format md|json]

Exit codes: 0 no failed checks, 1 at least one failed check, 2 usage or input error.
`;

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

/** Runs the CLI and returns the exit code. Does not call process.exit. */
export function run(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command !== 'check') {
    io.err(USAGE);
    return 2;
  }

  let format = 'md';
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string;
    if (arg === '--format') {
      format = rest[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('--')) {
      io.err(`Unknown option: ${arg}\n${USAGE}`);
      return 2;
    } else {
      positional.push(arg);
    }
  }
  const target = positional[0];
  if (target === undefined || positional.length > 1 || (format !== 'md' && format !== 'json')) {
    io.err(USAGE);
    return 2;
  }

  let report;
  try {
    report = analyze(readLocalRepo(target));
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }

  io.out(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : toMarkdown(report));
  return report.summary.fail > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
