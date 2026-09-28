# er-connect

Static landing page for **er.ci.computer** — the install/quick-connect front
door for CI Companion on Even Realities G2. Plain HTML/CSS/JS, no build step.

- **Install** — links to the Even Hub app store listing and the latest
  sideloadable `.ehpk` from GitHub Releases.
- **Connect your Hub** — lets you punch in a CI-Hub base URL and probe the
  Ollama / Hermes / OpenClaw endpoints before pairing your glasses.
- **Sign in** — opens your Hub's CI-Portal OIDC sign-in page
  (`<hub-url>/api/auth`).

## Deploy (Cloudflare Pages)

```bash
npm install -g wrangler   # skip if already installed
wrangler login             # one-time, opens a browser tab

# from the repo root
wrangler pages project create ci-er-connect --production-branch=main   # one-time
wrangler pages deploy er-connect --project-name=ci-er-connect
wrangler pages domain add er.ci.computer --project-name=ci-er-connect  # one-time
```
