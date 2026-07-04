# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — Design system

The HUD adopted the Companion Intelligence canonical design system. The glasses
HUD is a **dark-only** surface (there is no light theme by design), so it carries
the CI **dark** palette; the canonical `--primary` teal is `#abd4d8` on this
surface (the light-mode `#0f717a` is the same brand teal in the design system,
present here as the `--teal-600` ramp step).

- **CI canonical teal primary.** The shadcn token layer (`--primary`, `--accent`,
  `--background`, …) is authored in oklch with authoritative hex comments and
  pinned to the CI dark-HUD `--primary` `#abd4d8`. The bespoke `--color-accent`
  now aliases `var(--primary)` so existing rules consume the canonical token
  without forking. Guarded by `src/ui/__tests__/theme-tokens.test.ts`.
- **Montserrat type.** `--font-sans` leads with `"Montserrat Variable"`
  (registered via `@fontsource-variable/montserrat`), with the prior system
  stack retained as fallback.
- **Enriched design tokens (v0.2.0).** Added an additive palette layer matching
  `@companionintelligence/tokens` v0.2.0: the teal ramp (`--teal-50` … `--teal-950`),
  aqua/mint accents (`--aqua`, `--aqua-light`, `--mint`, `--teal-mid`,
  `--teal-accent`), semantic status colors (`--success`, `--warning`, `--info`
  with foregrounds), brand gradients (`--gradient-brand`, `--gradient-hero`,
  `--gradient-aurora`), an elevation scale (`--shadow-sm/md/lg`), and the added
  radius steps (`--radius-md`, `--radius-2xl`). This layer is strictly additive —
  no existing token or component rule was modified, and the bespoke
  `--radius-sm/lg/xl` pixel values are preserved.
- **Design-canon lint gate.** Added `scripts/lint-canon.mjs` (zero-dependency;
  fails on any non-teal `--primary` in hex/rgb/hsl/oklch/oklab notation, warns on
  hardcoded hex in component source) wired into CI via
  `.github/workflows/style-canon-lint.yml`.
- **Refreshed dark UI screenshots.** Updated the README "Interface" gallery with
  dark-surface captures of the Chat and Settings tabs
  (`docs/ui/glasses-chat-dark.png`, `docs/ui/glasses-settings-dark.png`).

[Unreleased]: https://github.com/companionintelligence/CI-Even-Realities/commits/main
