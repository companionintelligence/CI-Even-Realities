# er-connect

The public "Setup & Connect" app for **CI Companion**, live at
**[er.ci.computer](https://er.ci.computer)**. A real Vite + React app now —
not a hand-styled static page — built on the canonical
[`@companionintelligence/ui`](https://github.com/companionintelligence/CI-Common/tree/main/packages/ui)
component kit and [`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/styles/tokens),
so it renders the real CI phthalo/sage palette, the real logo mark, and the
same Button/Card/Dialog/Stepper/StatusPill primitives every other CI surface
uses, instead of a hand-approximated copy.

- **Install** — an `AppCard` for CI Companion (Even Hub store link) plus a
  `QrCode` to scan on your phone, or sideload the latest `.ehpk` from GitHub.
- **Sign in** — real Authorization Code + PKCE flow against CI-Portal
  (`https://hub.ci.computer/api/auth`), mirroring
  `ci-glasses-app/src/auth/OidcClient.ts`.
- **Connect your Hub** — a `Stepper` walks Install → Connect → Talk. Once
  you've signed in and entered a Hub host, both are remembered
  (`localStorage`) and reconnect automatically on your next visit.
- **Help** — everything explanatory (how it works, screenshots, manual
  backend config, supported Backend Kinds, troubleshooting) lives behind a
  `Dialog` with tabs, out of the main flow.

## Why a build step

This used to be plain HTML/CSS/JS with hand-copied hex values standing in
for the real canon palette — `--bg: #060606` where the real dark background
is `#041620`, a teal-black, not near-black. CI-Common's own governance
(`styles/UI-STYLE-GUIDE.md` §11) calls that exact pattern the drift its
token bundle exists to prevent: *"Consume the package; never copy a token
block... A hand-copied block is exactly the drift the gate exists to
catch."* Pulling in the real `@companionintelligence/ui` kit means a real
npm install against the private `@companionintelligence` registry, and
Tailwind v4 needs a build step to generate its utility classes — so this is
now a proper app, not a static file.

## Develop

```bash
cd er-connect
npm install   # needs a GitHub token with packages:read — see below
npm run dev   # http://localhost:5174
```

### The private registry

`@companionintelligence/ui` and `@companionintelligence/tokens` are private
packages on GitHub Packages (`npm.pkg.github.com`), per `.npmrc` in this
directory. `npm install` needs `NODE_AUTH_TOKEN` set to a token with
`packages:read` for the `companionintelligence` org:

```bash
NODE_AUTH_TOKEN="$(gh auth token)" npm install
```

CI does the same with `secrets.GITHUB_TOKEN` (see `.github/workflows/deploy-er-connect.yml`
and `ci.yml`'s `ci-glasses-app` job, which consumes the same registry the
same way).

## Build

```bash
npm run build   # tsc -b && vite build → dist/
```

`dist/` is what actually gets deployed — `wrangler.jsonc`'s
`assets.directory` points at it. `public/_headers` (security headers, CSP)
is copied into `dist/` verbatim by Vite on every build; never edit
`dist/_headers` directly.

## Deploy

**Live** at <https://er.ci.computer>, deployed as a **Cloudflare Worker with
static assets** — not a classic Cloudflare Pages project, and that wasn't a
choice, it's what `wrangler` (4.143.0, as of this writing) does by default
now. `wrangler pages project create ci-er-connect` produced a Worker (with
`assets.directory` set) rather than an entry in `wrangler pages project
list`; the CLI itself says so — "Workers are the recommended way to deploy
all new projects" — and even offers a `--force` flag to opt back into a
classic Pages project, which we did not use. `wrangler pages deploy` does
not work against it (`The Pages project "ci-er-connect" does not exist`) —
everything below uses plain `wrangler deploy`, which reads the Worker name,
the `dist/` assets directory, and the `er.ci.computer` custom-domain route
straight from `wrangler.jsonc`, rather than from CLI flags.

Worth knowing: the rest of `ci.computer`'s sites (`ci-virtual-home`,
`time-machine`, `ci-os-hub-docs`, `ci-pebble`, `avatars`,
`ci-public-website`, `spellbook` — checked via `wrangler pages project
list` against this same account) are all still classic Pages projects on
`*.pages.dev` with dashboard-managed custom domains. This site is the
current outlier, forced by what the CLI does today rather than chosen for
consistency with its siblings.

### Redeploy

```bash
cd er-connect
npm run build
npx wrangler deploy
```

Needs a Cloudflare account with access to `ci.computer` — run `npx wrangler
login` first if not already authenticated (opens a browser tab once).

### Or via GitHub Actions

[`deploy-er-connect.yml`](../.github/workflows/deploy-er-connect.yml) installs,
builds, and runs the same `wrangler deploy` from CI, manually triggered:

```bash
gh workflow run deploy-er-connect.yml --repo companionintelligence/CI-Even-Realities --ref main
```

Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as repo secrets
(Settings → Secrets and variables → Actions): the token from My Profile →
API Tokens → **Create Token** → "Edit Cloudflare Workers" template, scoped
to the account that owns `ci.computer`; the account ID from the dashboard
sidebar under Workers & Pages → Overview. `NODE_AUTH_TOKEN` for the private
registry install comes from the workflow's own `secrets.GITHUB_TOKEN` — no
extra secret needed for that part.

### Give a future Claude session Cloudflare access instead

This Claude Code org has a **"Cloudflare Developer Platform"** connector
available. Connecting it at
[claude.ai/customize/connectors](https://claude.ai/customize/connectors) and
starting a new session would let Claude run `npm run build && wrangler
deploy` (or call the API directly) without a human in the loop for future
redeploys.

## Prerequisite: register the OIDC client

`src/auth/oidc.ts` uses `client_id: 'ci-er-connect'`. CI-Portal's
`PUBLIC_CLIENTS` registry needs an entry for it with `redirect_uri` set to
this app's deployed URL (`https://er.ci.computer/`) — that's a CI-Portal-side
change, not something this repo can do on its own. Until it's registered,
sign-in will fail at the authorize step with an invalid-client error from
the IdP.

## Files

- `src/App.tsx` — page layout: header, hero, the Install/Connect/Talk `Stepper`, footer, `HelpDialog`.
- `src/components/HelpDialog.tsx` — the tabbed help modal (how it works, screenshots, manual config, backends, troubleshooting).
- `src/auth/` — `pkce.ts` (RFC 7636 helpers), `oidc.ts` (the CI-Portal Authorization Code + PKCE flow, mirrors `ci-glasses-app/src/auth/OidcClient.ts`), `useConnect.ts` (the React hook wiring sign-in + Hub-connect lifecycle together, including auto-reconnect on boot).
- `src/hub/connect.ts` — CI-Hub host normalization and the `agent-hub` reachability probe, mirrors `ci-glasses-app/src/config/HubPresets.ts`.
- `public/` — favicon, screenshots (from `docs/ui/`), and `_headers` — copied into `dist/` verbatim on build.
- `wrangler.jsonc` — the Worker config: name (`ci-er-connect`), `dist/` as the assets directory, and the `er.ci.computer` custom-domain route.
