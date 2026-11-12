/**
 * data-service.js
 * Loads the read-only JSON seed files with the Fetch API, validates and
 * normalises them, and builds the initial application state.
 *
 * Architecture:
 *   1. First visit  -> fetch JSON seed data -> build state -> save to LocalStorage
 *   2. Later visits -> read state from LocalStorage
 *   3. Reset        -> fetch JSON again and overwrite the saved state
 */
import { loadSavedState, saveState, clearSavedState, STATE_VERSION, STORAGE_KEY } from './storage.js';
import { daysBetween, toDateKey, shiftDateString } from './utils.js';
import { ACTIVITY_TYPES, recalculateEnrollments, syncBadgeUnlocks, calculateActivityPoints } from './engine.js';

/** Relative paths keep the site working from a GitHub Pages sub-folder. */
const DATA_FILES = {
  users: 'data/users.json',
  challenges: 'data/challenges.json',
  activities: 'data/activities.json',
  enrollments: 'data/enrollments.json',
  badges: 'data/badges.json',
  reminders: 'data/reminders.json',
};

/**
 * The seed data was authored around this date. On first load every date is
 * shifted by (today - reference) so the demo always looks current.
 */
export const SEED_REFERENCE_DATE = '2026-11-12';
export const DEFAULT_USER_ID = 'u-ananya';
export const ORGANIZER_ID = 'u-meera';

/** Date fields to shift for each collection. */
const DATE_FIELDS = {
  users: ['joinDate'],
  challenges: ['startDate', 'endDate', 'createdAt'],
  activities: ['date', 'loggedAt'],
  enrollments: ['enrolledAt', 'completedAt', 'leftAt'],
  reminders: ['date', 'completedOn', 'createdAt'],
};

/** Custom error so pages can show a helpful message. */
export class DataLoadError extends Error {
  constructor(message, file) {
    super(message);
    this.name = 'DataLoadError';
    this.file = file;
  }
}

/** Fetch and parse one JSON file. */
async function fetchJSON(path) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
  } catch (networkError) {
    throw new DataLoadError(`Network error while loading ${path}.`, path);
  }
  if (!response.ok) {
    throw new DataLoadError(`${path} could not be loaded (HTTP ${response.status}).`, path);
  }
  try {
    return await response.json();
  } catch (parseError) {
    throw new DataLoadError(`${path} does not contain valid JSON.`, path);
  }
}

/** Fetch all seed files in parallel. */
export async function fetchSeedData() {
  const entries = Object.entries(DATA_FILES);
  const results = await Promise.all(entries.map(([, path]) => fetchJSON(path)));
  const seed = {};
  entries.forEach(([name, path], index) => {
    if (!Array.isArray(results[index])) {
      throw new DataLoadError(`${path} must contain a JSON array.`, path);
    }
    seed[name] = results[index];
  });
  return seed;
}

/* ---------------- Normalisation ---------------- */

function normaliseChallenge(challenge) {
  const firstType = ACTIVITY_TYPES[challenge.activityTypes && challenge.activityTypes[0]];
  const defaultUnit = firstType ? Object.keys(firstType.units)[0] : 'minutes';
  return {
    guidelines: [],
    requirements: [],
    featured: false,
    difficulty: 'Beginner',
    ...challenge,
    activityTypes: Array.isArray(challenge.activityTypes) ? challenge.activityTypes : [],
    targetValue: Number(challenge.targetValue) || 1,
    rewardPoints: Number(challenge.rewardPoints) || 0,
    durationDays: daysBetween(challenge.startDate, challenge.endDate) + 1,
    // "days" challenges count days on which a daily minimum was reached.
    dailyUnit: challenge.metric === 'days' ? challenge.dailyUnit || defaultUnit : null,
    dailyMinimum: challenge.metric === 'days' ? Number(challenge.dailyMinimum) || 1 : null,
  };
}

function normaliseActivity(activity) {
  const value = Number(activity.value);
  const points = Number(activity.points);
  return {
    description: '',
    challengeId: null,
    ...activity,
    value,
    // Trust stored points (they include the daily cap) but repair missing values.
    points: Number.isFinite(points) ? points : calculateActivityPoints(activity.type, activity.unit, value),
  };
}

function normaliseUser(user) {
  return {
    bio: '',
    headline: '',
    weeklyGoals: { activeDays: 5, points: 400 },
    badgeUnlocks: {},
    ...user,
    privacy: { profileVisible: true, leaderboardVisible: true, activityVisible: true, ...(user.privacy || {}) },
  };
}

/** Shift every date field in a collection by `offset` days. */
function shiftCollectionDates(records, fields, offset) {
  if (offset === 0) return records;
  return records.map((record) => {
    const copy = { ...record };
    fields.forEach((field) => {
      if (typeof copy[field] === 'string') copy[field] = shiftDateString(copy[field], offset);
    });
    return copy;
  });
}

/** Turn raw seed data into a complete, consistent application state. */
export function buildInitialState(seed) {
  const offset = daysBetween(SEED_REFERENCE_DATE, toDateKey());
  const shifted = {};
  Object.keys(DATA_FILES).forEach((name) => {
    shifted[name] = shiftCollectionDates(seed[name], DATE_FIELDS[name] || [], offset);
  });

  const state = {
    version: STATE_VERSION,
    currentUserId: DEFAULT_USER_ID,
    organizerId: ORGANIZER_ID,
    seededAt: new Date().toISOString(),
    lastSavedAt: null,
    settings: {
      theme: 'system',
      reminders: { showOnDashboard: true, inAppAlerts: true, defaultTime: '08:00' },
    },
    users: shifted.users.map(normaliseUser),
    challenges: shifted.challenges.map(normaliseChallenge),
    activities: shifted.activities.map(normaliseActivity),
    enrollments: shifted.enrollments.map((e) => ({ completedAt: null, ...e })),
    badges: shifted.badges,
    reminders: shifted.reminders.map((r) => ({ note: '', completedOn: null, ...r, enabled: r.enabled !== false })),
  };

  if (!state.users.some((u) => u.id === state.currentUserId)) {
    const firstParticipant = state.users.find((u) => u.role === 'participant');
    if (!firstParticipant) throw new DataLoadError('users.json contains no participants.', DATA_FILES.users);
    state.currentUserId = firstParticipant.id;
  }

  // Derive completion status and badge unlocks from the activity records.
  recalculateEnrollments(state);
  syncBadgeUnlocks(state, { initial: true });
  return state;
}

/**
 * Challenge covers, badge icons and avatars moved from SVG to WebP images.
 * States saved by an earlier version still hold the old .svg paths, so rewrite them.
 * @returns {boolean} true when anything changed.
 */
function migrateAssetPaths(state) {
  const OLD_ASSET = /^(static\/assets\/images\/(?:challenges\/[a-z-]+|badges\/[a-z-]+|avatars\/avatar-\d{2}))\.svg$/;
  let changed = false;
  const fix = (record, field) => {
    const match = typeof record[field] === 'string' && record[field].match(OLD_ASSET);
    if (match) {
      record[field] = `${match[1]}.webp`;
      changed = true;
    }
  };
  state.challenges.forEach((challenge) => fix(challenge, 'image'));
  state.badges.forEach((badge) => fix(badge, 'icon'));
  state.users.forEach((user) => fix(user, 'avatar'));
  return changed;
}

/**
 * Returns the application state, preferring LocalStorage.
 * @returns {Promise<{state: object, source: 'storage'|'seed'|'recovered'}>}
 */
export async function loadAppState() {
  const saved = loadSavedState();
  if (saved.status === 'ok') {
    if (migrateAssetPaths(saved.state)) saveState(saved.state);
    return { state: saved.state, source: 'storage' };
  }
  const seed = await fetchSeedData();
  const state = buildInitialState(seed);
  if (saved.status === 'corrupted') clearSavedState();
  saveState(state);
  return { state, source: saved.status === 'corrupted' ? 'recovered' : 'seed' };
}

/** Restore the original demonstration data from the JSON files. */
export async function resetToSeed() {
  const seed = await fetchSeedData();
  const state = buildInitialState(seed);
  clearSavedState();
  try {
    localStorage.removeItem(`${STORAGE_KEY}:theme`);
  } catch (error) {
    /* ignore */
  }
  saveState(state);
  return state;
}
