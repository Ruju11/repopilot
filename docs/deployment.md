# Deploying the demo (GitHub Pages)

The demo is static: `index.html`, `style.css` and the compiled `dist/`. It needs no server, database, key or paid service. GitHub Pages is free for public repositories. The workflow `.github/workflows/pages.yml` is already in the repository; it runs **only when started by hand**. It has not been run yet. Each step that changes a GitHub setting needs the maintainer's approval.

## Steps

1. Make the repository public:
   `gh repo edit Ruju11/repopilot --visibility public --accept-visibility-change-consequences`
2. Enable Pages with the workflow as its source:
   `gh api -X POST repos/Ruju11/repopilot/pages -f build_type=workflow`
3. Start the deployment and wait for it:
   `gh workflow run "Deploy demo" --repo Ruju11/repopilot` then `gh run watch --repo Ruju11/repopilot`
   The workflow installs with `npm ci --ignore-scripts`, runs `npm run verify` (with link tests required), builds `dist/`, uploads `web/`, and deploys.
4. The site is at `https://ruju11.github.io/repopilot/`. Check it:
   - the page loads with no console errors;
   - scan `octocat/Hello-World`: it shows commit `7fd1a60` and a link to it;
   - in the browser console, `fetch('https://example.com')` fails with a Content-Security-Policy violation.

## Before step 1

`npm ci && npm run verify` passes locally and in CI, `gitleaks git --redact` is clean, a `LICENSE` exists (MIT), and `docs/deployment.md` (this file) has been read.

## Known limits of this hosting

- GitHub Pages sends no custom headers, so the policy comes from the page's `<meta>` tag. A meta tag cannot set `frame-ancestors`, so another site could embed the demo in a frame. The demo is read-only and holds no secrets, so the risk is low.
- Unauthenticated GitHub API limit: 60 requests per hour per visitor IP address; a scan uses 2 to 3.

## Roll back

Disable Pages: `gh api -X DELETE repos/Ruju11/repopilot/pages`. Go private again: `gh repo edit Ruju11/repopilot --visibility private --accept-visibility-change-consequences`.
