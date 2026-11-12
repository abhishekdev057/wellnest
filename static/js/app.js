/**
 * app.js
 * Application bootstrap and the single in-memory state holder.
 *
 * Every page calls initApp(pageId) which:
 *   1. renders the shared header, footer and mobile navigation
 *   2. loads the state (LocalStorage first, JSON seed data otherwise)
 *   3. applies the theme and wires global actions (log activity, theme toggle)
 *
 * Pages change data ONLY through commit(), which keeps derived data
 * (challenge completion, badges) consistent, saves to LocalStorage and
 * notifies subscribers so the UI re-renders.
 */
import { loadAppState } from './data-service.js';
import { saveState, loadSavedState, STORAGE_KEY } from './storage.js';
import { recalculateEnrollments, syncBadgeUnlocks, getUser } from './engine.js';
import { renderHeader, renderFooter, updateHeaderUser, updateThemeToggle } from './navigation.js';
import { showToast } from './components/toast.js';
import { openActivityForm } from './components/activity-form.js';
import { initNotifications, refreshNotifications } from './components/notifications.js';
import { escapeHTML, icon } from './utils.js';

export const THEME_KEY = `${STORAGE_KEY}:theme`;

let state = null;
let currentPage = '';
const listeners = new Set();

/* ---------------- State access ---------------- */

export const getState = () => state;

export const getCurrentUser = () => (state ? getUser(state, state.currentUserId) : null);

/** The person shown in the header: the organizer on the organizer page, otherwise the participant. */
const getHeaderUser = () => (state && currentPage === 'organizer' ? getUser(state, state.organizerId) : getCurrentUser());

/** Subscribe to state changes. Returns an unsubscribe function. */
export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error('[Wellnest] A view failed to update:', error);
    }
  });
}

/**
 * Apply a change to the state.
 * @param {Function} mutator receives the state and modifies it
 */
export function commit(mutator) {
  const result = mutator(state);

  // Keep derived data consistent after every change.
  recalculateEnrollments(state);
  const unlocked = syncBadgeUnlocks(state);

  if (!saveState(state)) {
    showToast({
      type: 'error',
      title: 'Changes could not be saved',
      message: 'Browser storage is full or disabled, so this change will be lost after a refresh.',
      duration: 8000,
    });
  }

  unlocked
    .filter((item) => item.userId === state.currentUserId)
    .forEach(({ badge }) => {
      showToast({ type: 'badge', title: `Badge unlocked: ${badge.name}`, message: badge.description, image: badge.icon, duration: 7000 });
    });

  emitChange();
  return result;
}

/** Replace the whole state (used after resetting demo data). */
export function replaceState(nextState) {
  state = nextState;
  applyTheme(state.settings.theme);
  emitChange();
}

/* ---------------- Theme ---------------- */

const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** Resolve "system" to light/dark and set it on <html>. */
export function applyTheme(preference = 'system') {
  const isDark = preference === 'dark' || (preference === 'system' && darkQuery && darkQuery.matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch (error) {
    /* storage unavailable: theme still applies for this page */
  }
  updateThemeToggle(isDark);
}

export function setThemePreference(preference) {
  if (!['light', 'dark', 'system'].includes(preference)) return;
  commit((draft) => {
    draft.settings.theme = preference;
  });
  applyTheme(preference);
}

if (darkQuery) {
  darkQuery.addEventListener('change', () => {
    if (state && state.settings.theme === 'system') applyTheme('system');
  });
}

/* ---------------- Global UI wiring ---------------- */

function bindGlobalActions() {
  // Event delegation: any element with data-action="log-activity" opens the form.
  document.addEventListener('click', (event) => {
    const logTrigger = event.target.closest('[data-action="log-activity"]');
    if (logTrigger) {
      event.preventDefault();
      openActivityForm({ challengeId: logTrigger.dataset.challengeId || '', type: logTrigger.dataset.type || '' });
      return;
    }
    const themeToggle = event.target.closest('[data-theme-toggle]');
    if (themeToggle) {
      const isDark = document.documentElement.dataset.theme === 'dark';
      setThemePreference(isDark ? 'light' : 'dark');
    }
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const saved = loadSavedState();
    if (saved.status === 'ok') {
      state = saved.state;
      emitChange();
    }
  });
}

function renderAppError(error) {
  const main = document.getElementById('main');
  if (!main) return;
  const isFileProtocol = window.location.protocol === 'file:';
  main.innerHTML = `
    <section class="container">
      <div class="app-error" role="alert">
        <div class="confirm-icon" data-tone="danger">${icon('alert', 'icon--lg')}</div>
        <h1 class="section-title">We couldn't load Wellnest</h1>
        <p class="muted">${escapeHTML(error.message || 'The application data could not be loaded.')}</p>
        ${isFileProtocol
          ? '<p class="small muted">This page was opened directly from the file system. Browsers block <code>fetch()</code> for local files, so please run the project with a local web server such as VS Code Live Server (see README.md).</p>'
          : '<p class="small muted">Check your connection and make sure the <code>data/</code> folder is deployed alongside the HTML files.</p>'}
        <button type="button" class="btn btn--primary" data-retry>${icon('refresh')} Try again</button>
      </div>
    </section>`;
  main.querySelector('[data-retry]').addEventListener('click', () => window.location.reload());
}

/**
 * Bootstraps a page.
 * @param {string} pageId identifier used to highlight the navigation
 * @returns {Promise<object|null>} the state, or null when loading failed
 */
export async function initApp(pageId) {
  currentPage = pageId;
  renderHeader(pageId);
  renderFooter();

  try {
    const result = await loadAppState();
    state = result.state;
    if (result.source === 'recovered') {
      showToast({
        type: 'warning',
        title: 'Saved data was reset',
        message: 'Your saved Wellnest data was unreadable, so the demo data has been restored.',
        duration: 8000,
      });
    }
  } catch (error) {
    console.error('[Wellnest] Failed to initialise application data:', error);
    renderAppError(error);
    return null;
  }

  applyTheme(state.settings.theme);
  updateHeaderUser(getHeaderUser());
  initNotifications();
  bindGlobalActions();
  onStateChange(() => {
    updateHeaderUser(getHeaderUser());
    refreshNotifications();
  });
  document.body.classList.add('is-ready');
  return state;
}
