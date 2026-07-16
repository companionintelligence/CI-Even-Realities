/**
 * StoragePort.ts
 *
 * Small async key/value storage abstraction so the auth layer can persist
 * tokens either through the Even Hub SDK bridge (device-backed, reliable
 * across app launches) or through `window.localStorage` (browser / simulator
 * mode). Both back-ends are exposed behind one async interface.
 */

export interface StoragePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Backing store that speaks `window.localStorage` (browser / simulator). */
export const localStoragePort: StoragePort = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore (private mode / quota)
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

/**
 * Minimal shape of the Even Hub bridge storage methods we rely on. Declared
 * locally so this module doesn't hard-depend on the SDK types (keeps it unit
 * testable without the bridge).
 */
export interface BridgeStorage {
  setLocalStorage(key: string, value: string): Promise<boolean>;
  getLocalStorage(key: string): Promise<string>;
}

/**
 * Storage backed by the SDK bridge. The bridge has no delete primitive, so
 * `remove` writes an empty string (treated as "absent" by callers).
 */
export function bridgeStoragePort(bridge: BridgeStorage): StoragePort {
  return {
    async get(key) {
      try {
        const v = await bridge.getLocalStorage(key);
        return v ? v : null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        await bridge.setLocalStorage(key, value);
      } catch {
        // ignore
      }
    },
    async remove(key) {
      try {
        await bridge.setLocalStorage(key, '');
      } catch {
        // ignore
      }
    },
  };
}
