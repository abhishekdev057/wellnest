/**
 * engine.js
 * The "rules engine" of Wellnest. Every calculation lives here so that all
 * pages show the same numbers:
 *   - activity types, units and point rules
 *   - challenge status, progress and completion
 *   - points, streaks and statistics
 *   - badge eligibility
 *   - leaderboards
 *   - reminder scheduling helpers
 *
 * Functions are "pure": they receive the state and return values without
 * touching the DOM. Mutations happen in actions.js.
 */
import { toDateKey, parseDate, addDays, startOfToday, daysBetween, percent, sumBy, formatValue, PATTERNS } from './utils.js';

/* =====================================================================
   1. Configuration
   ===================================================================== */

export const CATEGORIES = {
  movement: { label: 'Movement', icon: 'run', description: 'Walk, run, ride and move more every day.' },
  hydration: { label: 'Hydration', icon: 'droplet', description: 'Simple routines for drinking enough water.' },
  mindfulness: { label: 'Mindfulness', icon: 'lotus', description: 'Meditation, journaling and calm moments.' },
  'healthy-habits': { label: 'Healthy Habits', icon: 'leaf', description: 'Stretch breaks, balanced meals and good routines.' },
  'daily-wellness': { label: 'Daily Wellness', icon: 'sun', description: 'Small daily rituals that add up over time.' },
};

/**
 * Supported activity types. Each unit defines:
 *   rate – points per unit, min/max – accepted range per entry, step – input step.
 */
export const ACTIVITY_TYPES = {
  walking: {
    label: 'Walking', category: 'movement', icon: 'footprints',
    units: { steps: { rate: 0.005, min: 500, max: 40000, step: 1 }, minutes: { rate: 1, min: 5, max: 300, step: 1 }, km: { rate: 6, min: 0.5, max: 40, step: 0.1 } },
  },
  running: {
    label: 'Running', category: 'movement', icon: 'run',
    units: { km: { rate: 10, min: 0.5, max: 50, step: 0.1 }, minutes: { rate: 1.5, min: 5, max: 300, step: 1 } },
  },
  cycling: {
    label: 'Cycling', category: 'movement', icon: 'bike',
    units: { km: { rate: 3, min: 1, max: 150, step: 0.1 }, minutes: { rate: 1, min: 5, max: 300, step: 1 } },
  },
  exercise: { label: 'Exercise', category: 'movement', icon: 'dumbbell', units: { minutes: { rate: 1.2, min: 5, max: 240, step: 1 } } },
  yoga: { label: 'Yoga', category: 'healthy-habits', icon: 'lotus', units: { minutes: { rate: 1.2, min: 5, max: 180, step: 1 } } },
  stretching: { label: 'Stretching', category: 'healthy-habits', icon: 'stretch', units: { minutes: { rate: 1, min: 3, max: 120, step: 1 } } },
  meditation: { label: 'Meditation', category: 'mindfulness', icon: 'sparkle', units: { minutes: { rate: 1.5, min: 2, max: 120, step: 1 } } },
  hydration: {
    label: 'Hydration', category: 'hydration', icon: 'droplet',
    units: { glasses: { rate: 3, min: 1, max: 20, step: 1 }, ml: { rate: 0.012, min: 250, max: 5000, step: 50 } },
  },
  'screen-free': { label: 'Screen-free time', category: 'daily-wellness', icon: 'phone-off', units: { minutes: { rate: 0.5, min: 15, max: 480, step: 5 } } },
  journaling: { label: 'Journaling', category: 'mindfulness', icon: 'book', units: { minutes: { rate: 1, min: 2, max: 120, step: 1 } } },
  'healthy-meal': { label: 'Healthy meal', category: 'healthy-habits', icon: 'apple', units: { meals: { rate: 8, min: 1, max: 6, step: 1 } } },
  other: { label: 'Other activity', category: 'daily-wellness', icon: 'activity', units: { minutes: { rate: 0.8, min: 5, max: 240, step: 1 } } },
};

export const UNIT_LABELS = { steps: 'steps', minutes: 'minutes', km: 'km', glasses: 'glasses', ml: 'ml', meals: 'meals', days: 'days' };

/** Maximum points one participant can earn per activity type per day. */
export const DAILY_POINT_CAP = 200;
/** Activities may be logged up to this many days in the past. */
export const MAX_BACKDATE_DAYS = 13;

export const STATUS_LABELS = {
  draft: 'Draft', upcoming: 'Upcoming', active: 'Active', paused: 'Paused', completed: 'Ended', archived: 'Archived',
};

/* =====================================================================
   2. Activity rules
   ===================================================================== */

export const getActivityType = (key) => ACTIVITY_TYPES[key] || null;

export const getActivityIcon = (key) => (ACTIVITY_TYPES[key] ? ACTIVITY_TYPES[key].icon : 'activity');

export const getActivityCategory = (key) => (ACTIVITY_TYPES[key] ? ACTIVITY_TYPES[key].category : 'daily-wellness');

/** Base points for one activity entry (before the daily cap). */
export function calculateActivityPoints(type, unit, value) {
  const rule = ACTIVITY_TYPES[type] && ACTIVITY_TYPES[type].units[unit];
  const amount = Number(value);
  if (!rule || !Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(1, Math.floor(amount * rule.rate + 0.5));
}

/**
 * Validates an activity value against the rules of its type and unit.
 * @returns {string} an error message, or '' when valid.
 */
export function validateActivityValue(type, unit, rawValue) {
  const typeConfig = ACTIVITY_TYPES[type];
  if (!typeConfig) return 'Choose a supported activity type.';
  const rule = typeConfig.units[unit];
  if (!rule) return `${typeConfig.label} cannot be recorded in ${unit}.`;
  const text = String(rawValue).trim();
  if (text === '') return 'Enter how much you did.';
  if (!PATTERNS.positiveNumber.test(text)) return 'Use a positive number with up to two decimals.';
  const value = Number(text);
  if (rule.step >= 1 && !Number.isInteger(value)) return `Whole ${UNIT_LABELS[unit]} only, please.`;
  if (value < rule.min) return `The minimum for one entry is ${formatValue(rule.min)} ${UNIT_LABELS[unit]}.`;
  if (value > rule.max) return `The maximum for one entry is ${formatValue(rule.max)} ${UNIT_LABELS[unit]}.`;
  return '';
}

/** Human readable amount, e.g. "8,200 steps". */
export const describeAmount = (value, unit) => `${formatValue(value)} ${UNIT_LABELS[unit] || unit}`;

/** Points the user already earned today for one activity type (used for the daily cap). */
export function getPointsEarnedOnDay(state, userId, type, dateKey) {
  return sumBy(
    state.activities.filter((a) => a.userId === userId && a.type === type && a.date.slice(0, 10) === dateKey),
    (a) => a.points,
  );
}

/* =====================================================================
   3. Challenges
   ===================================================================== */

export const getChallenge = (state, id) => state.challenges.find((c) => c.id === id) || null;

/**
 * The status shown to users. Stored statuses draft/paused/archived are kept;
 * an "active" challenge becomes upcoming or completed depending on its dates.
 */
export function getChallengeStatus(challenge, todayKey = toDateKey()) {
  if (['draft', 'paused', 'archived'].includes(challenge.status)) return challenge.status;
  if (todayKey < challenge.startDate) return 'upcoming';
  if (todayKey > challenge.endDate) return 'completed';
  return 'active';
}

/** Whether a participant may join a challenge right now. */
export function canJoinChallenge(challenge) {
  const status = getChallengeStatus(challenge);
  const reasons = {
    draft: 'This challenge is still a draft and is not open yet.',
    paused: 'This challenge is paused and not accepting new participants.',
    archived: 'Archived challenges cannot accept new participants.',
    completed: 'This challenge has already ended.',
  };
  return reasons[status] ? { ok: false, reason: reasons[status] } : { ok: true, reason: '' };
}

/** True when activities can currently be counted toward this challenge. */
export const isChallengeLoggable = (challenge) => getChallengeStatus(challenge) === 'active';

export function getEnrollment(state, userId, challengeId) {
  return state.enrollments.find((e) => e.userId === userId && e.challengeId === challengeId) || null;
}

export function isEnrolled(state, userId, challengeId) {
  const enrollment = getEnrollment(state, userId, challengeId);
  return Boolean(enrollment && enrollment.status !== 'left');
}

/** Enrollments that are not "left", i.e. current or completed participants. */
export const getChallengeEnrollments = (state, challengeId) =>
  state.enrollments.filter((e) => e.challengeId === challengeId && e.status !== 'left');

export const getParticipantCount = (state, challengeId) => getChallengeEnrollments(state, challengeId).length;

/** Text such as "6 days left", "Starts in 3 days" or "Ended 2 Nov". */
export function getTimeRemaining(challenge) {
  const status = getChallengeStatus(challenge);
  const today = toDateKey();
  if (status === 'upcoming' || (['draft', 'paused'].includes(status) && today < challenge.startDate)) {
    const days = daysBetween(today, challenge.startDate);
    return { days, label: days === 1 ? 'Starts tomorrow' : `Starts in ${days} days` };
  }
  if (status === 'completed' || status === 'archived') {
    return { days: 0, label: 'Ended' };
  }
  const days = Math.max(0, daysBetween(today, challenge.endDate));
  return { days, label: days === 0 ? 'Last day' : `${days} ${days === 1 ? 'day' : 'days'} left` };
}

/** Describes the target, e.g. "150,000 steps" or "14 days · 8+ glasses daily". */
export function describeTarget(challenge) {
  if (challenge.metric === 'days') {
    return `${challenge.targetValue} days · ${formatValue(challenge.dailyMinimum)}+ ${UNIT_LABELS[challenge.dailyUnit]} a day`;
  }
  return describeAmount(challenge.targetValue, challenge.targetUnit);
}

/** Activity types + unit combinations that count toward a challenge. */
export function getChallengeUnit(challenge) {
  return challenge.metric === 'days' ? challenge.dailyUnit : challenge.targetUnit;
}

/**
 * Progress of one participant in one challenge.
 * @param {string} [asOfKey] only count activities on or before this date (for rank movement).
 */
export function getChallengeProgress(state, userId, challenge, asOfKey = null) {
  const unit = getChallengeUnit(challenge);
  const activities = state.activities
    .filter((a) => a.userId === userId && a.challengeId === challenge.id && a.unit === unit)
    .filter((a) => !asOfKey || a.date.slice(0, 10) <= asOfKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  let current = 0;
  let completedOn = null;

  if (challenge.metric === 'days') {
    // Count distinct days where the daily minimum was reached.
    const totalsByDay = {};
    activities.forEach((activity) => {
      const day = activity.date.slice(0, 10);
      const before = totalsByDay[day] || 0;
      totalsByDay[day] = before + Number(activity.value);
      if (before < challenge.dailyMinimum && totalsByDay[day] >= challenge.dailyMinimum) {
        current += 1;
        if (current === challenge.targetValue) completedOn = day;
      }
    });
  } else {
    activities.forEach((activity) => {
      const before = current;
      current += Number(activity.value);
      if (before < challenge.targetValue && current >= challenge.targetValue) completedOn = activity.date.slice(0, 10);
    });
    current = Math.round(current * 10) / 10;
  }

  const target = challenge.targetValue;
  return {
    current,
    target,
    unit: challenge.metric === 'days' ? 'days' : challenge.targetUnit,
    percent: percent(current, target),
    remaining: Math.max(0, Math.round((target - current) * 10) / 10),
    completed: current >= target,
    completedOn,
    activityCount: activities.length,
  };
}

/** Challenges a user can attach a new activity of `type` to. */
export function getEligibleChallengesForActivity(state, userId, type) {
  return state.challenges.filter(
    (challenge) =>
      isEnrolled(state, userId, challenge.id) &&
      isChallengeLoggable(challenge) &&
      challenge.activityTypes.includes(type),
  );
}

/**
 * Marks enrollments as completed once their target has been reached.
 * Called after every state change so data always stays consistent.
 * @returns {Array} enrollments that were newly completed.
 */
export function recalculateEnrollments(state) {
  const newlyCompleted = [];
  state.enrollments.forEach((enrollment) => {
    if (enrollment.status !== 'active') return;
    const challenge = getChallenge(state, enrollment.challengeId);
    if (!challenge) return;
    const progress = getChallengeProgress(state, enrollment.userId, challenge);
    if (progress.completed) {
      enrollment.status = 'completed';
      enrollment.completedAt = progress.completedOn || toDateKey();
      newlyCompleted.push(enrollment);
    }
  });
  return newlyCompleted;
}

/* =====================================================================
   4. Points, streaks & statistics
   ===================================================================== */

export const getUserActivities = (state, userId) =>
  state.activities.filter((a) => a.userId === userId).sort((a, b) => b.date.localeCompare(a.date));

export const getUser = (state, userId) => state.users.find((u) => u.id === userId) || null;

export const getParticipants = (state) => state.users.filter((u) => u.role === 'participant');

/** Challenge completion rewards for a user: [{ challenge, points, date }] */
export function getRewardEvents(state, userId) {
  return state.enrollments
    .filter((e) => e.userId === userId && e.status === 'completed')
    .map((e) => {
      const challenge = getChallenge(state, e.challengeId);
      return challenge ? { challenge, points: challenge.rewardPoints, date: e.completedAt } : null;
    })
    .filter(Boolean);
}

/**
 * Points earned between two date keys (inclusive). Omit a bound to leave it open.
 * Total = activity points + challenge completion rewards.
 */
export function getPointsInRange(state, userId, fromKey = null, toKey = null) {
  const inRange = (key) => (!fromKey || key >= fromKey) && (!toKey || key <= toKey);
  const activityPoints = sumBy(
    state.activities.filter((a) => a.userId === userId && inRange(a.date.slice(0, 10))),
    (a) => a.points,
  );
  const rewardPoints = sumBy(
    getRewardEvents(state, userId).filter((r) => inRange(r.date || '')),
    (r) => r.points,
  );
  return activityPoints + rewardPoints;
}

/** Current and longest streak of consecutive active days. */
export function calculateStreak(activities, todayKey = toDateKey()) {
  const activeDays = new Set(activities.map((a) => a.date.slice(0, 10)));
  if (activeDays.size === 0) return { current: 0, longest: 0, activeToday: false };

  // Current streak: count back from today (or from yesterday if nothing logged yet today).
  const today = parseDate(todayKey);
  const activeToday = activeDays.has(todayKey);
  let cursor = activeToday ? today : addDays(today, -1);
  let current = 0;
  while (activeDays.has(toDateKey(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  // Longest streak: walk through the sorted days.
  const sortedDays = Array.from(activeDays).filter((d) => d <= todayKey).sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  sortedDays.forEach((day) => {
    run = previous && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  });

  return { current, longest: Math.max(longest, current), activeToday };
}

/** Date key for N days before today. */
export const daysAgoKey = (days) => toDateKey(addDays(startOfToday(), -days));

/** All statistics for one user, computed from the raw records. */
export function getUserStats(state, userId) {
  const activities = getUserActivities(state, userId);
  const enrollments = state.enrollments.filter((e) => e.userId === userId && e.status !== 'left');
  const rewardEvents = getRewardEvents(state, userId);
  const activityPoints = sumBy(activities, (a) => a.points);
  const rewardPoints = sumBy(rewardEvents, (r) => r.points);
  const streak = calculateStreak(activities);
  const weekStart = daysAgoKey(6);
  const weekActivities = activities.filter((a) => a.date.slice(0, 10) >= weekStart);

  const activeChallenges = enrollments.filter((e) => {
    const challenge = getChallenge(state, e.challengeId);
    return challenge && e.status === 'active' && ['active', 'upcoming', 'paused'].includes(getChallengeStatus(challenge));
  });

  return {
    totalPoints: activityPoints + rewardPoints,
    activityPoints,
    rewardPoints,
    totalActivities: activities.length,
    activeChallenges: activeChallenges.length,
    completedChallenges: enrollments.filter((e) => e.status === 'completed').length,
    joinedChallenges: enrollments.length,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    activeToday: streak.activeToday,
    weekPoints: getPointsInRange(state, userId, weekStart),
    previousWeekPoints: getPointsInRange(state, userId, daysAgoKey(13), daysAgoKey(7)),
    weekActivities: weekActivities.length,
    weekActiveDays: new Set(weekActivities.map((a) => a.date.slice(0, 10))).size,
    totalMinutes: sumBy(activities.filter((a) => a.unit === 'minutes'), (a) => a.value),
    activeDays: new Set(activities.map((a) => a.date.slice(0, 10))).size,
  };
}

/** Per-day totals for the last `days` days ending today. */
export function getDailySeries(activities, days = 7) {
  const today = startOfToday();
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const key = toDateKey(date);
    const dayActivities = activities.filter((a) => a.date.slice(0, 10) === key);
    series.push({
      key,
      date,
      points: sumBy(dayActivities, (a) => a.points),
      count: dayActivities.length,
    });
  }
  return series;
}

/** Visual intensity level (0-4) for the streak calendar. */
export function getActivityLevel(points) {
  if (points <= 0) return 0;
  if (points < 40) return 1;
  if (points < 90) return 2;
  if (points < 150) return 3;
  return 4;
}

/** Count activities by wellness category. */
export function getCategoryDistribution(activities) {
  const counts = Object.keys(CATEGORIES).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
  activities.forEach((a) => {
    counts[getActivityCategory(a.type)] += 1;
  });
  return Object.entries(counts).map(([category, count]) => ({ category, label: CATEGORIES[category].label, count }));
}

/* =====================================================================
   5. Badges
   ===================================================================== */

/** Current value of a badge rule for a user. */
function getRuleValue(rule, stats, activities) {
  switch (rule.type) {
    case 'activityCount':
      return stats.totalActivities;
    case 'longestStreak':
      return stats.longestStreak;
    case 'challengesCompleted':
      return stats.completedChallenges;
    case 'challengesJoined':
      return stats.joinedChallenges;
    case 'totalPoints':
      return stats.totalPoints;
    case 'typeCount':
      return activities.filter((a) => a.type === rule.activityType).length;
    case 'typeTotal':
      return sumBy(activities.filter((a) => a.type === rule.activityType && a.unit === rule.unit), (a) => a.value);
    default:
      console.warn(`[Wellnest] Unknown badge rule type "${rule.type}"`);
      return 0;
  }
}

/** Progress for every badge: [{ badge, current, target, percent, unlocked, unlockedAt }] */
export function getBadgeProgress(state, userId) {
  const user = getUser(state, userId);
  const stats = getUserStats(state, userId);
  const activities = getUserActivities(state, userId);
  const unlocks = (user && user.badgeUnlocks) || {};

  return state.badges.map((badge) => {
    const current = getRuleValue(badge.rule, stats, activities);
    const target = badge.rule.threshold;
    // Achievements are permanent: once unlocked they stay unlocked.
    const unlocked = current >= target || Boolean(unlocks[badge.id]);
    return {
      badge,
      current: Math.min(current, target),
      target,
      percent: unlocked ? 100 : percent(current, target),
      unlocked,
      unlockedAt: unlocks[badge.id] || null,
    };
  });
}

/**
 * A copy of the state "as it was" at the end of a given day:
 * later activities are removed and later completions are undone.
 * Used to work out when seed-data badges were originally earned.
 */
function getStateAsOf(state, dateKey) {
  return {
    ...state,
    activities: state.activities.filter((a) => a.date.slice(0, 10) <= dateKey),
    enrollments: state.enrollments
      .filter((e) => e.enrolledAt <= dateKey)
      .map((e) => (e.status === 'completed' && e.completedAt > dateKey ? { ...e, status: 'active' } : e)),
  };
}

/** Earliest activity day on which a badge rule was satisfied. */
function findFirstUnlockDate(state, user, badge) {
  const days = Array.from(new Set(getUserActivities(state, user.id).map((a) => a.date.slice(0, 10)))).sort();
  const snapshotUser = { ...user, badgeUnlocks: {} };
  const found = days.find((day) => {
    const snapshot = getStateAsOf(state, day);
    snapshot.users = state.users.map((u) => (u.id === user.id ? snapshotUser : u));
    return getBadgeProgress(snapshot, user.id).some((p) => p.badge.id === badge.id && p.unlocked);
  });
  return found || toDateKey();
}

/**
 * Records unlock dates for badges that became eligible.
 * @param {boolean} initial true while building the seed state (dates are reconstructed from history)
 * @returns {Array<{userId, badge}>} newly unlocked badges.
 */
export function syncBadgeUnlocks(state, { initial = false } = {}) {
  const unlockedNow = [];
  getParticipants(state).forEach((user) => {
    user.badgeUnlocks = user.badgeUnlocks || {};
    const progress = getBadgeProgress(state, user.id);
    progress.forEach((item) => {
      if (item.unlocked && !user.badgeUnlocks[item.badge.id]) {
        user.badgeUnlocks[item.badge.id] = initial ? findFirstUnlockDate(state, user, item.badge) : toDateKey();
        if (!initial) unlockedNow.push({ userId: user.id, badge: item.badge });
      }
    });
  });
  return unlockedNow;
}

/* =====================================================================
   6. Leaderboards
   ===================================================================== */

/**
 * Builds ranked leaderboard rows.
 * @param {object} options
 * @param {'overall'|'weekly'|'challenge'} options.scope
 * @param {string} [options.challengeId] required for the challenge scope
 * @param {boolean} [options.includeHidden] include users who hid themselves (private views only)
 */
export function buildLeaderboard(state, { scope = 'overall', challengeId = null, includeHidden = false } = {}) {
  const challenge = challengeId ? getChallenge(state, challengeId) : null;
  let users = getParticipants(state);

  if (scope === 'challenge') {
    if (!challenge) return [];
    const enrolledIds = new Set(getChallengeEnrollments(state, challengeId).map((e) => e.userId));
    users = users.filter((u) => enrolledIds.has(u.id));
  }
  if (!includeHidden) {
    users = users.filter((u) => u.privacy && u.privacy.leaderboardVisible !== false);
  }

  const today = toDateKey();
  const weekAgo = daysAgoKey(7);

  const rows = users.map((user) => {
    const activities = getUserActivities(state, user.id);
    const streak = calculateStreak(activities).current;
    let score;
    let previousScore;
    let activityCount;
    let progress = null;

    if (scope === 'weekly') {
      score = getPointsInRange(state, user.id, daysAgoKey(6), today);
      previousScore = getPointsInRange(state, user.id, daysAgoKey(13), weekAgo);
      activityCount = activities.filter((a) => a.date.slice(0, 10) >= daysAgoKey(6)).length;
    } else if (scope === 'challenge') {
      progress = getChallengeProgress(state, user.id, challenge);
      score = progress.current;
      previousScore = getChallengeProgress(state, user.id, challenge, weekAgo).current;
      activityCount = progress.activityCount;
    } else {
      score = getPointsInRange(state, user.id);
      previousScore = getPointsInRange(state, user.id, null, weekAgo);
      activityCount = activities.length;
    }

    const points = scope === 'challenge'
      ? sumBy(activities.filter((a) => a.challengeId === challengeId), (a) => a.points)
      : score;

    return { user, score, previousScore, points, activityCount, streak, progress };
  });

  const compare = (scoreKey) => (a, b) =>
    b[scoreKey] - a[scoreKey] || b.activityCount - a.activityCount || a.user.name.localeCompare(b.user.name);

  // Previous ranking (one week ago) for movement indicators.
  const previousOrder = [...rows].sort(compare('previousScore'));
  const previousRank = new Map(previousOrder.map((row, index) => [row.user.id, index + 1]));

  const ranked = [...rows].sort(compare('score'));
  let lastScore = null;
  let lastRank = 0;
  ranked.forEach((row, index) => {
    // Standard competition ranking: equal scores share a rank (1, 2, 2, 4).
    row.rank = row.score === lastScore ? lastRank : index + 1;
    lastScore = row.score;
    lastRank = row.rank;
    const before = previousRank.get(row.user.id);
    if (row.previousScore <= 0) {
      row.movement = { dir: row.score > 0 ? 'new' : 'same', change: 0 };
    } else {
      const change = before - (index + 1);
      row.movement = { dir: change > 0 ? 'up' : change < 0 ? 'down' : 'same', change: Math.abs(change) };
    }
  });
  return ranked;
}

/* =====================================================================
   7. Reminders
   ===================================================================== */

export const REPEAT_LABELS = { daily: 'Every day', weekdays: 'Weekdays', weekends: 'Weekends', once: 'One time' };

/** Does a reminder apply on the given date? */
export function isReminderScheduledOn(reminder, date = new Date()) {
  const day = date.getDay(); // 0 = Sunday
  switch (reminder.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekends':
      return day === 0 || day === 6;
    case 'once':
      return reminder.date === toDateKey(date);
    default:
      return false;
  }
}

/** Completed for the current occurrence? (repeating reminders reset every day) */
export function isReminderCompleted(reminder) {
  if (!reminder.completedOn) return false;
  return reminder.repeat === 'once' ? true : reminder.completedOn === toDateKey();
}

/** Next date-time this reminder will fire, or null (disabled / finished). */
export function getNextOccurrence(reminder, now = new Date()) {
  if (!reminder.enabled || !PATTERNS.time.test(reminder.time)) return null;
  const [hours, minutes] = reminder.time.split(':').map(Number);
  if (reminder.repeat === 'once') {
    if (isReminderCompleted(reminder)) return null;
    const date = parseDate(reminder.date);
    if (!date) return null;
    date.setHours(hours, minutes);
    return date;
  }
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = addDays(startOfToday(), offset);
    candidate.setHours(hours, minutes);
    const skipToday = offset === 0 && isReminderCompleted(reminder);
    if (!skipToday && isReminderScheduledOn(reminder, candidate) && (candidate >= now || offset === 0)) {
      return candidate;
    }
  }
  return null;
}

/** "due" (time passed today, not done), "upcoming", "completed" or "disabled". */
export function getReminderStatus(reminder, now = new Date()) {
  if (!reminder.enabled) return 'disabled';
  if (isReminderCompleted(reminder)) return 'completed';
  const next = getNextOccurrence(reminder, now);
  if (!next) return reminder.repeat === 'once' ? 'missed' : 'upcoming';
  if (reminder.repeat === 'once' && toDateKey(next) < toDateKey(now)) return 'missed';
  if (toDateKey(next) === toDateKey(now) && next <= now) return 'due';
  return 'upcoming';
}

export const getUserReminders = (state, userId) => state.reminders.filter((r) => r.userId === userId);
