import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Settings } from '../Settings.ts';

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('defaults on a fresh install', () => {
    it('provides sane defaults for every field', () => {
      const cfg = new Settings().get();
      expect(cfg.baseUrl).toBe('http://localhost:8080');
      expect(cfg.apiKey).toBe('ci-local-key');
      expect(cfg.model).toBe('ci-companion');
      expect(cfg.backendKind).toBe('openai');
      expect(cfg.apiMode).toBe('auto');
      expect(cfg.streaming).toBe(true);
      expect(cfg.storeContext).toBe(true);
      expect(cfg.sttProvider).toBe('whisper');
      expect(cfg.ttsEnabled).toBe(false);
      expect(cfg.maxHistoryMessages).toBe(20);
      expect(cfg.authMode).toBe('apiKey');
      expect(cfg.oidcClientId).toBe('ci-even');
      expect(cfg.hubBaseUrl).toBe('http://localhost');
      expect(cfg.useMemory).toBe(false);
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
  });

  describe('get()', () => {
    it('returns a snapshot copy — mutating the result does not affect internal state', () => {
      const settings = new Settings();
      const cfg = settings.get();
      cfg.baseUrl = 'http://mutated:9999';
      expect(settings.get().baseUrl).toBe('http://localhost:8080');
    });

    it('returns distinct object instances on each call', () => {
      const settings = new Settings();
      expect(settings.get()).not.toBe(settings.get());
      expect(settings.get()).toEqual(settings.get());
    });
  });

  describe('set()', () => {
    it('merges a partial patch over the existing config', () => {
      const settings = new Settings();
      settings.set({ baseUrl: 'http://new:1234' });
      const cfg = settings.get();
      expect(cfg.baseUrl).toBe('http://new:1234');
      expect(cfg.model).toBe('ci-companion'); // untouched
    });

    it('supports multiple fields in one patch', () => {
      const settings = new Settings();
      settings.set({ baseUrl: 'http://x', model: 'llama3.2', streaming: false });
      const cfg = settings.get();
      expect(cfg.baseUrl).toBe('http://x');
      expect(cfg.model).toBe('llama3.2');
      expect(cfg.streaming).toBe(false);
    });

    it('accumulates across multiple set() calls', () => {
      const settings = new Settings();
      settings.set({ baseUrl: 'http://x' });
      settings.set({ model: 'y' });
      const cfg = settings.get();
      expect(cfg.baseUrl).toBe('http://x');
      expect(cfg.model).toBe('y');
    });

    it('persists to localStorage under the expected key', () => {
      new Settings().set({ baseUrl: 'http://persisted:1' });
      const raw = localStorage.getItem('ci-glasses-config');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).baseUrl).toBe('http://persisted:1');
    });

    it('persists across separate Settings instances (simulating app reload)', () => {
      new Settings().set({ model: 'persisted-model' });
      const reloaded = new Settings();
      expect(reloaded.get().model).toBe('persisted-model');
    });

    it('persisted overrides win over defaults on a fresh instance', () => {
      const s = new Settings();
      s.set({ oidcClientId: 'ci-hub' });
      expect(new Settings().get().oidcClientId).toBe('ci-hub');
    });
  });

  describe('reset()', () => {
    it('restores every field to its default value', () => {
      const settings = new Settings();
      settings.set({
        baseUrl: 'http://changed:1',
        model: 'changed-model',
        useMemory: true,
        streaming: false,
      });
      settings.reset();
      const cfg = settings.get();
      expect(cfg.baseUrl).toBe('http://localhost:8080');
      expect(cfg.model).toBe('ci-companion');
      expect(cfg.useMemory).toBe(false);
      expect(cfg.streaming).toBe(true);
    });

    it('persists the reset so a subsequent Settings instance also sees defaults', () => {
      const settings = new Settings();
      settings.set({ baseUrl: 'http://changed:1' });
      settings.reset();
      expect(new Settings().get().baseUrl).toBe('http://localhost:8080');
    });
  });

  describe('load() resilience', () => {
    it('falls back to defaults when localStorage holds malformed JSON', () => {
      localStorage.setItem('ci-glasses-config', '{not valid json!!!');
      const cfg = new Settings().get();
      expect(cfg.baseUrl).toBe('http://localhost:8080');
      expect(cfg.model).toBe('ci-companion');
    });

    it('merges persisted fields with DEFAULT_CONFIG so a new field added later has a value', () => {
      // Simulate an old saved config predating some current field.
      localStorage.setItem(
        'ci-glasses-config',
        JSON.stringify({ baseUrl: 'http://legacy:1' })
      );
      const cfg = new Settings().get();
      expect(cfg.baseUrl).toBe('http://legacy:1'); // preserved
      expect(cfg.oidcClientId).toBe('ci-even'); // filled from defaults
      expect(cfg.useMemory).toBe(false); // filled from defaults
    });

    it('falls back to defaults when localStorage is empty', () => {
      expect(localStorage.getItem('ci-glasses-config')).toBeNull();
      const cfg = new Settings().get();
      expect(cfg).toMatchObject({ baseUrl: 'http://localhost:8080' });
    });

    it('does not throw when localStorage.getItem throws (private-mode-like failure)', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      try {
        expect(() => new Settings()).not.toThrow();
        expect(new Settings().get().baseUrl).toBe('http://localhost:8080');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('save() resilience', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not throw when localStorage.setItem throws (quota exceeded / private mode)', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      const settings = new Settings();
      expect(() => settings.set({ baseUrl: 'http://x' })).not.toThrow();
      // In-memory state still reflects the attempted change even though
      // persistence failed silently.
      expect(settings.get().baseUrl).toBe('http://x');
      spy.mockRestore();
    });
  });
});
