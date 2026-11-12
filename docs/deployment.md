# Deploying the demo (GitHub Pages)

The demo is static: `index.html`, `style.css` and the compiled `dist/`. It needs no server, database, key or paid service. GitHub Pages is free for public repositories. **Nothing below has been run yet.** Each step that changes a GitHub setting needs the maintainer's approval.

## 1. Before going public

1. Choose a licence and add `LICENSE` (RepoPilot's own check fails without one).
2. `npm ci && npm run verify` passes locally and in CI (Linux).
3. Gitleaks on history is clean: `gitleaks git --redact`.
4. Make the repository public (a visibility change; needs approval): `gh repo edit Ruju11/repopilot --visibility public --accept-visibility-change-consequences`.

## 2. Add the deploy workflow

Create `.github/workflows/pages.yml` with the content below, commit and push. It runs only when started by hand, so nothing deploys by accident.

```yaml
name: Deploy demo
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: '24'
      - run: npm ci --ignore-scripts
      - run: npm run verify
        env:
          REQUIRE_LINK_TESTS: '1'
      - run: npm run build:web
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: web
  deploy:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

## 3. Enable Pages and deploy

```
gh api -X POST repos/Ruju11/repopilot/pages -f build_type=workflow
gh workflow run "Deploy demo" --repo Ruju11/repopilot
gh run watch --repo Ruju11/repopilot
```

The site appears at `https://ruju11.github.io/repopilot/`.

## 4. Check the live site

- Open the URL; the page loads with no console errors.
- Scan `octocat/Hello-World`: it shows commit `7fd1a60` and a link to it.
- In the browser console, `fetch('https://example.com')` must fail with a Content-Security-Policy violation.

## Known limits of this hosting

- GitHub Pages sends no custom headers, so the policy comes from the page's `<meta>` tag. A meta tag cannot set `frame-ancestors`, so another site could embed the demo in a frame. The demo is read-only and holds no secrets, so the risk is low.
- Unauthenticated GitHub API limit: 60 requests per hour per visitor IP address; a scan uses 2 to 3.

## Roll back

Disable Pages: `gh api -X DELETE repos/Ruju11/repopilot/pages`. To go private again: `gh repo edit Ruju11/repopilot --visibility private --accept-visibility-change-consequences`.
