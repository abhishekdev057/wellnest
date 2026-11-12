/**
 * storage.js
 * Thin, defensive wrapper around LocalStorage and SessionStorage.
 *
 * - The whole application state lives under ONE namespaced key so that
 *   we never touch unrelated data (localStorage.clear() is never used).
 * - Corrupted or incompatible data is detected and discarded safely.
 */

export const STORAGE_KEY = 'wellnest_app_v1';
export const STATE_VERSION = 1;
const SESSION_PREFIX = 'wellnest_session_';

/** Collections that must exist (as arrays) for a saved state to be usable. */
const REQUIRED_COLLECTIONS = ['users', 'challenges', 'activities', 'enrollments', 'badges', 'reminders'];

/** Checks that the browser allows LocalStorage (it can be disabled in private modes). */
export function isStorageAvailable() {
  try {
    const testKey = `${STORAGE_KEY}__test`;
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
}

/** Returns true when an object has the shape of a Wellnest application state. */
export function isValidState(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.version !== STATE_VERSION) return false;
  if (typeof state.currentUserId !== 'string') return false;
  const collectionsOk = REQUIRED_COLLECTIONS.every((name) => Array.isArray(state[name]));
  if (!collectionsOk) return false;
  // The current user must exist, otherwise every page would break.
  return state.users.some((user) => user.id === state.currentUserId);
}

/**
 * Read the saved state.
 * @returns {{ status: 'ok'|'empty'|'corrupted', state: object|null }}
 */
export function loadSavedState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[Wellnest] LocalStorage is not accessible:', error);
    return { status: 'empty', state: null };
  }

  if (raw === null) return { status: 'empty', state: null };

  try {
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed)) {
      console.warn('[Wellnest] Saved state failed validation and will be replaced with seed data.');
      return { status: 'corrupted', state: null };
    }
    return { status: 'ok', state: parsed };
  } catch (error) {
    console.warn('[Wellnest] Saved state is not valid JSON:', error);
    return { status: 'corrupted', state: null };
  }
}

/**
 * Persist the full application state.
 * @returns {boolean} true when the save succeeded.
 */
export function saveState(state) {
  try {
    state.lastSavedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    // QuotaExceededError or storage disabled.
    console.error('[Wellnest] Unable to save state:', error);
    return false;
  }
}

/** Remove only Wellnest's own key. */
export function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[Wellnest] Unable to clear saved state:', error);
  }
}

/** Approximate size of the saved state in kilobytes (for the settings page). */
export function getStoredSizeKB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    return Math.round((raw.length * 2) / 1024);
  } catch (error) {
    return 0;
  }
}

/**
 * Update one record inside a collection by id.
 * Returns the updated record or null when it was not found.
 */
export function updateRecord(state, collection, id, changes) {
  const list = state[collection];
  if (!Array.isArray(list)) return null;
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return null;
  list[index] = { ...list[index], ...changes };
  return list[index];
}

/** Remove one record from a collection by id. Returns true when removed. */
export function removeRecord(state, collection, id) {
  const list = state[collection];
  if (!Array.isArray(list)) return false;
  const before = list.length;
  state[collection] = list.filter((item) => item.id !== id);
  return state[collection].length < before;
}

/* ---------------- SessionStorage (temporary, per-tab data) ---------------- */

export function sessionGet(key, fallback = null) {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export function sessionSet(key, value) {
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(value));
  } catch (error) {
    console.warn('[Wellnest] SessionStorage write failed:', error);
  }
}

export function sessionRemove(key) {
  try {
    sessionStorage.removeItem(SESSION_PREFIX + key);
  } catch (error) {
    /* ignore */
  }
}
