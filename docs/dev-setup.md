# Developer Setup Guide

Complete guide for setting up a local development environment for `ci-even-realities`.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install Node.js](#install-nodejs)
3. [Install global Even Hub tooling](#install-global-even-hub-tooling)
4. [Clone and install dependencies](#clone-and-install-dependencies)
5. [Start the development server](#start-the-development-server)
6. [Open in the Even Hub Simulator](#open-in-the-even-hub-simulator)
7. [Run on a real device](#run-on-a-real-device)
8. [Type-check and build](#type-check-and-build)
9. [IDE setup](#ide-setup)
10. [Common issues](#common-issues)

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 18 LTS | Also installs `npm` |
| npm | 9+ | Bundled with Node 18 |
| Even Hub CLI | latest | Publishing to Even Hub portal |
| Even Hub Simulator | latest | Local UI testing without glasses |
| Even Hub mobile app | latest | Pairing with physical G2 / R1 hardware |
| Even G2 / R1 glasses | — | Optional for most dev work |

---

## Install Node.js

Download and install from [nodejs.org](https://nodejs.org/). Choose the **LTS** (long-term support) release.

Verify:

```bash
node --version   # e.g. v20.12.0
npm --version    # e.g. 10.5.0
```

---

## Install global Even Hub tooling

> **macOS / Linux**: prefix commands with `sudo`.
> **Windows**: omit `sudo`.

```bash
# Even Hub CLI — used to publish apps to the Even Hub portal
sudo npm install -g @evenrealities/evenhub-cli

# Even Hub Simulator — desktop simulator for the Even Hub mobile app
sudo npm install -g @evenrealities/evenhub-simulator

# Vite (optional — it is also a dev dependency in the project)
sudo npm install -g vite@latest
```

Verify:

```bash
evenhub-cli --version
evenhub-simulator --help
vite --version
```

---

## Clone and install dependencies

```bash
git clone https://github.com/companionintelligence/ci-even-realities.git
cd ci-even-realities/ci-glasses-app
npm install
```

This installs:

| Package | Version | Role |
|---|---|---|
| `@evenrealities/even_hub_sdk` | `^0.0.7` | Even Hub bridge, display, event APIs |
| `typescript` | `^5.4.0` | TypeScript compiler |
| `vite` | `^5.2.0` | Dev server + production bundler |
| `@types/node` | `^20.0.0` | Node type definitions for Vite config |

---

## Start the development server

```bash
cd ci-glasses-app
npm run dev
```

Output:

```
  VITE v5.x.x  ready in Xms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.42:5173/
```

The app is now accessible in your browser at `http://localhost:5173`. Open it to see the Chat and Settings views without connecting to glasses.

### Specify host / port explicitly

The `vite.config.ts` already sets `host: '0.0.0.0'` and `port: 5173`. These can be overridden:

```bash
npx vite --host 192.168.1.42 --port 9000
```

---

## Open in the Even Hub Simulator

The simulator launches a desktop window that mirrors how the app looks inside the Even Hub mobile app.

1. Start the Vite dev server (step above) and note your LAN IP address.
2. In a **second terminal**, run:

```bash
evenhub-simulator http://192.168.1.42:5173
```

The simulator opens two windows:
- **Phone view** — the full Even Hub mobile app UI with your app embedded.
- **Glasses preview** — a simulated G2/R1 display.

You can interact with simulated ring gestures (single tap, double tap, scroll) from the simulator controls.

---

## Run on a real device

1. Ensure your development machine and phone are on the **same Wi-Fi network**.
2. Start Vite and note the LAN IP (`npm run dev` prints `Network: http://x.x.x.x:5173`).
3. In the Even Hub mobile app:
   - Go to **Developer** → **Load custom app**
   - Enter `http://x.x.x.x:5173`
4. Connect your G2 glasses to the app via Bluetooth.
5. The app loads in the Even Hub WebView and bridges to the glasses.

---

## Type-check and build

```bash
# Type-check only (no output files)
npm run typecheck

# Production build (outputs to dist/)
npm run build
```

TypeScript is configured with strict mode + `noUnusedLocals` + `noUnusedParameters`. Fix all type errors before publishing.

### Publish to Even Hub portal

```bash
npm run build
evenhub-cli publish dist/
```

Or upload `dist/` manually at the [Even Hub developer console](https://hub.evenrealities.com/hub) (needs an Even Realities developer login).

---

## IDE setup

### VS Code (recommended)

1. Install the **ESLint** extension.
2. Install the **Volar** extension (Vue/Vite TypeScript support).
3. The project's `tsconfig.json` is automatically picked up.

Useful extensions:

| Extension | Purpose |
|---|---|
| `dbaeumer.vscode-eslint` | Linting |
| `Vue.volar` | Vite/TypeScript IntelliSense |
| `bradlc.vscode-tailwindcss` | If Tailwind is added later |
| `ms-vscode.live-server` | Alternative to Vite for quick HTML edits |

### Cursor / other AI-assisted IDEs

The project works in Cursor, Windsurf, and other Vite-aware IDEs. Point the IDE's TypeScript language server at `ci-glasses-app/tsconfig.json`.

---

## Common issues

### `waitForEvenAppBridge` never resolves

The SDK bridge is only injected by the Even Hub mobile app or the simulator. When opening `http://localhost:5173` directly in a desktop browser, the app enters **browser mode** automatically — you will see a warning message in the chat view. This is expected behaviour; all non-BLE functionality still works.

### Mic does not work in browser

The browser must be served over HTTPS (or `localhost`) for the `getUserMedia` microphone API to work. The Vite dev server on `localhost` satisfies this requirement. If you expose via LAN IP, microphone access is blocked — use the simulator instead.

### `evenhub-simulator` command not found

Re-run:

```bash
sudo npm install -g @evenrealities/evenhub-simulator
```

Ensure `/usr/local/bin` (macOS/Linux) is on your `PATH`.

### TypeScript error: unused variable

The `tsconfig.json` sets `noUnusedLocals: true` and `noUnusedParameters: true`. Remove or prefix unused identifiers with `_`.

### Port 5173 already in use

Kill the existing process or start on a different port:

```bash
npm run dev -- --port 5174
```
