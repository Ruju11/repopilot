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

GitHub targets are **public** repositories, read through GitHub's unauthenticated API. RepoPilot never reads, sends or logs a token. One run resolves the default branch to a commit once, then reads the file list and the README and licence texts from that exact commit, so a push during a scan cannot mix revisions. It costs 2 API requests (GitHub allows 60 per hour per IP address); RepoPilot reports when the limit is reached. Downloads are capped at 256 KB, counted in bytes as they stream, and cancelled once the cap is crossed.

File names come from untrusted repositories. In Markdown output they are escaped and shown in code spans, and links are built only from a validated GitHub URL pinned to the commit. Anything that renders a report in a browser should show the structured JSON fields as plain text, not as HTML.

## Demo (sample data, local only)

```
npm run demo     # builds web/dist, serves http://127.0.0.1:4173/
```

The page runs the same checks in the browser on three synthetic samples, one of them with hostile file names. It makes no network requests: the page's Content-Security-Policy sets `connect-src 'none'`, `script-src 'self'` and no inline code. All report text is placed with `textContent`; no HTML is ever parsed, and a test fails if `innerHTML` and similar calls appear in the demo code. Live GitHub scans are not part of the demo yet; adding them will need a deliberate policy change and a review. The demo has not been deployed.

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
- GitHub evidence links point to the scanned commit, not the latest code. A repository with no commits (empty) is reported as empty; that response was handled from GitHub's documentation and has not been tried against a real empty repository.
- Private repositories are not supported.
