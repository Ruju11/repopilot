# Changelog

## 0.1.0 (release candidate)

- 12 deterministic readiness checks (README, licence, security policy, CI, lockfile, .gitignore, changelog, contributing guide, code of conduct, dependency updates, templates, CODEOWNERS).
- CLI for local folders and public GitHub repositories (`github:owner/repo`), Markdown or JSON output, exit codes 0, 1 and 2.
- GitHub source pinned to one commit, read-only and unauthenticated, with a streamed size cap and clear errors.
- Web demo with a live public-repository scan and three synthetic samples, locked down by a strict Content-Security-Policy.
- Hardened reports: file names cannot inject HTML, links or automatic links.
- Local demo server that cannot be tricked into serving files outside `web/` through links.
- Linux CI (`npm ci`, type checks, tests), with link tests that fail instead of skipping.
