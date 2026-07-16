import { describe, it, expect, beforeEach } from 'vitest';
import { Settings } from '../Settings.ts';

describe('Settings defaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults the OIDC client to the dedicated ci-even public client', () => {
    const cfg = new Settings().get();
    expect(cfg.oidcClientId).toBe('ci-even');
    expect(cfg.oidcIssuer).toBe('https://hub.ci.computer/api/auth');
    expect(cfg.oidcScope).toContain('offline_access');
  });

  it('still defaults to legacy api-key auth mode (opt-in OIDC)', () => {
    expect(new Settings().get().authMode).toBe('apiKey');
  });

  it('persisted overrides win over defaults', () => {
    const s = new Settings();
    s.set({ oidcClientId: 'ci-hub' });
    expect(new Settings().get().oidcClientId).toBe('ci-hub');
  });
});
