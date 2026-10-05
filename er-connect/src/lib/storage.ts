/**
 * Web Storage that never throws.
 *
 * `window.localStorage` / `sessionStorage` can throw on access (Safari with
 * "Block all cookies", some embedded webviews, sandboxed iframes) and on write
 * (quota, private mode). An unguarded read inside a render path unmounts the
 * whole React tree, so every read and write in this app goes through here and
 * degrades to "nothing is remembered" instead.
 */

export type StorageKind = 'local' | 'session';

function area(kind: StorageKind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function storageGet(kind: StorageKind, key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored. */
export function storageSet(kind: StorageKind, key: string, value: string): boolean {
  try {
    const store = area(kind);
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(kind: StorageKind, key: string): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    // nothing to remove if storage is unavailable
  }
}
