# RepoPilot

Checks a repository for readiness (README, licence, security policy, CI and more) and links every finding to the file it is based on. Findings come from deterministic checks. No AI model, no API key, no backend.

## Usage

Requires Node.js 24.2 or newer. No packages are needed to run it.

```
node src/cli/main.ts check <folder>
node src/cli/main.ts check github:owner/repo
node src/cli/main.ts check https://github.com/owner/repo --format json
```

Exit codes: `0` no failed checks, `1` at least one failed check, `2` bad input or an error.

GitHub targets are **public** repositories, read through GitHub's unauthenticated API. RepoPilot never reads, sends or logs a token. One run costs one API request; GitHub allows 60 per hour per IP address, and RepoPilot reports when the limit is reached.

## Development

```
npm install      # TypeScript only (dev dependency)
npm run verify   # type check, then tests
```

Tests are offline: GitHub is replaced by a fake fetcher, and file-system failures by a fake file system.

## Limitations

- A passing README check means a README file exists (and, for the root file, has some length). It says nothing about quality.
- Licence detection is a keyword match on the licence text. It is not a legal validity check.
- Checks look for files in standard places only; a project that keeps them elsewhere will show a warning.
- Local scans stop at 4 folder levels and 20,000 files, skip `.git` and `node_modules`, and never follow symbolic links or junctions. Each cut-off is listed under "Notes" in the report.
- GitHub links point to the default branch (`HEAD`), so they can change when the repository changes.
- Private repositories are not supported.
