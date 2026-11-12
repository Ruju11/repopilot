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

## Demo (local only)

```
npm run demo     # builds web/dist, serves http://127.0.0.1:4173/
```

The page runs the same checks in the browser in two ways:

- **Live scan:** type `owner/repo` of a public GitHub repository. The browser contacts GitHub directly, read-only and without a token (one commit lookup and one file list from `api.github.com`, up to 5 text downloads from `raw.githubusercontent.com`), and nothing goes to any other server. The input is validated before any request. Results are pinned to one commit, and evidence links point to that commit.
- **Samples:** three synthetic reports (one with hostile file names) that make no network requests. Their Evidence column shows matched file names as plain text, not links.

Security properties, each covered by a test or a browser check: the page's Content-Security-Policy allows `connect-src` to exactly `https://api.github.com` and `https://raw.githubusercontent.com` and nothing else (the server header and the HTML meta tag are the same apart from `frame-ancestors`); `script-src 'self'`, no inline code; no cookies, credentials, storage, referrer or token; the only network call in the browser code is the audited GitHub source. All report text is placed with `textContent`; no HTML is ever parsed, and a test fails if `innerHTML` and similar calls appear. The local server resolves the real path of `web/` and of each requested file, so a symbolic link or Windows junction inside `web/` cannot expose a file outside it.

Limits: GitHub allows 60 unauthenticated requests per hour per IP address and a scan uses 2 to 3; private repositories are not supported; the demo has not been deployed and is checked in one browser engine (Chromium) only.

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
