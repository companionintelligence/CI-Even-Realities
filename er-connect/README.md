# er-connect

Static landing page for **er.ci.computer** — the install/quick-connect front
door for CI Companion on Even Realities G2. Plain HTML/CSS/JS, no build step.

- **Install** — links to the Even Hub app store listing and the latest
  sideloadable `.ehpk` from GitHub Releases.
- **Sign in** — real Authorization Code + PKCE flow against CI-Portal
  (`https://hub.ci.computer/api/auth`), mirroring
  `ci-glasses-app/src/auth/OidcClient.ts`. Tokens persist in `localStorage`.
- **Connect your Hub** — enter a CI-Hub base URL once and it's remembered
  (`localStorage`); probes `<host>:8787` (the `agent-hub`), the single
  endpoint all services (Assistant/Ollama/Hermes/OpenClaw/Memory) route
  through — see `ci-glasses-app/src/config/HubPresets.ts`.
- **Auto setup** — once both a session and a Hub URL exist on this device,
  reloading the page signs you in and reconnects automatically; no clicks.

### Prerequisite: register the OIDC client

`app.js` uses `client_id: 'ci-er-connect'`. CI-Portal's `PUBLIC_CLIENTS`
registry must have an entry for it with `redirect_uri` set to this page's own
URL (e.g. `https://er.ci.computer/`) — that's a CI-Portal-side change, not
something this repo can do on its own. Until it's registered, sign-in will
fail at the authorize step with an invalid-client error from the IdP.

## Deploy (Cloudflare Pages)

```bash
npm install -g wrangler   # skip if already installed
wrangler login             # one-time, opens a browser tab

# from the repo root
wrangler pages project create ci-er-connect --production-branch=main   # one-time
wrangler pages deploy er-connect --project-name=ci-er-connect
wrangler pages domain add er.ci.computer --project-name=ci-er-connect  # one-time
```
