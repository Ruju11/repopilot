# Security Policy

## Reporting a vulnerability

Please report security problems privately. Use GitHub's "Report a vulnerability" option under this repository's Security tab if it is shown; otherwise contact the maintainer, GitHub user `Ruju11`. Please do not open a public issue with exploit details.

## What RepoPilot does and does not do

- It reads repository file names and the text of README and licence files. It never runs code from a scanned repository.
- GitHub scans are read-only, unauthenticated and use no token. No credential, cookie or storage is used anywhere.
- File names from scanned repositories are untrusted. Markdown reports escape them; the web demo shows them with `textContent` only, and its Content-Security-Policy allows connections to `api.github.com` and `raw.githubusercontent.com` only.
- Findings come from deterministic checks. They are aids, not a security audit, certification or statement of legal compliance. A licence "match" is a keyword match, not a legal validity check.

## Secrets

The project needs no secrets and no paid services. A Gitleaks scan is run before every push. If a secret is ever exposed, revoke it at the provider first; deleting it from a file or from history does not make it safe.
