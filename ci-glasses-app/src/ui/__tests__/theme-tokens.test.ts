import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Theme/token contract for the CI Companion HUD surface.
 *
 * The HUD is dark-only and must ship the Companion Intelligence canonical
 * `--primary` teal (#abd4d8 on the dark surface, the CI dark-HUD primary).
 * This guards the token contract that the README "Interface" gallery documents;
 * the repo-wide canon lint gate (scripts/lint-canon.mjs + style-canon-lint.yml)
 * covers the full palette in CI.
 */
// vitest runs from the package root (ci-glasses-app/).
const css = readFileSync(resolve('src/ui/styles.css'), 'utf8');

describe('HUD theme tokens', () => {
  it('defines the CI canonical --primary teal (#abd4d8)', () => {
    // The token is authored as oklch with an authoritative hex comment.
    expect(css).toMatch(/--primary:\s*oklch\([^)]*203\.701[^)]*\);/);
    expect(css).toMatch(/--primary:[^;]*;\s*\/\*\s*#abd4d8\s*\*\//i);
  });

  it('aliases the accent onto the canonical --primary token', () => {
    // The HUD accent must not fork from canon — it references var(--primary).
    expect(css).toMatch(/--color-accent:\s*var\(--primary\)/);
  });

  it('is dark-only — no light-theme override block', () => {
    // A heads-up display ships a single dark surface; there must be no
    // `.light`/`[data-theme="light"]` selector reintroducing a second theme.
    expect(css).not.toMatch(/\.light\b/);
    expect(css).not.toMatch(/\[data-theme=["']?light/);
  });
});
