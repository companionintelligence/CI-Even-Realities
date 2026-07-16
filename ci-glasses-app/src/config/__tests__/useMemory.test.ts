import { describe, it, expect, beforeEach } from 'vitest';
import { Settings } from '../Settings.ts';

/**
 * Memory-augmented chat defaults. The `useMemory` flag is forwarded to the
 * agent-hub as `metadata.use_memory` on every chat request, so it must be
 * opt-in (a fresh install has no CI-Server behind its agent-hub) and must
 * survive a settings round-trip once enabled.
 */
describe('useMemory setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to false on a fresh install', () => {
    const settings = new Settings();
    expect(settings.get().useMemory).toBe(false);
  });

  it('defaults to false for configs persisted before the flag existed', () => {
    // Simulate a pre-useMemory saved config (no key at all).
    localStorage.setItem(
      'ci-glasses-config',
      JSON.stringify({ baseUrl: 'http://old:8080', model: 'old' })
    );
    const settings = new Settings();
    expect(settings.get().useMemory).toBe(false);
    expect(settings.get().baseUrl).toBe('http://old:8080');
  });

  it('persists across reloads once enabled', () => {
    new Settings().set({ useMemory: true });
    expect(new Settings().get().useMemory).toBe(true);
  });

  it('reset() turns it back off', () => {
    const settings = new Settings();
    settings.set({ useMemory: true });
    settings.reset();
    expect(settings.get().useMemory).toBe(false);
  });
});
