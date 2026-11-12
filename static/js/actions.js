/**
 * actions.js
 * All operations that CHANGE the application state.
 * Each action validates its input, applies the change through commit()
 * (which recalculates derived data and saves to LocalStorage) and returns
 * a result object: { ok: boolean, message: string, ... }.
 */
import { getState, commit } from './app.js';
import {
  ACTIVITY_TYPES, CATEGORIES, DAILY_POINT_CAP, MAX_BACKDATE_DAYS, UNIT_LABELS,
  getChallenge, getEnrollment, isEnrolled, canJoinChallenge, isChallengeLoggable, getChallengeUnit,
  calculateActivityPoints, validateActivityValue, getPointsEarnedOnDay, getParticipantCount,
} from './engine.js';
import { createId, toDateKey, toDateTimeString, parseDate, daysBetween, slugify, PATTERNS } from './utils.js';

const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
const fail = (message, errors = {}) => ({ ok: false, message, errors });

/* =====================================================================
   Challenge enrollment
   ===================================================================== */

export function joinChallenge(challengeId) {
  const state = getState();
  const userId = state.currentUserId;
  const challenge = getChallenge(state, challengeId);
  if (!challenge) return fail('This challenge could not be found.');

  const existing = getEnrollment(state, userId, challengeId);
  if (existing && existing.status === 'completed') return fail('You have already completed this challenge.');
  if (existing && existing.status === 'active') return fail('You are already enrolled in this challenge.');

  const allowed = canJoinChallenge(challenge);
  if (!allowed.ok) return fail(allowed.reason);

  commit((draft) => {
    const record = getEnrollment(draft, userId, challengeId);
    if (record) {
      // Re-joining after leaving re-activates the same record (no duplicates).
      record.status = 'active';
      record.enrolledAt = toDateKey();
      delete record.leftAt;
    } else {
      draft.enrollments.push({
        id: createId('enr'),
        userId,
        challengeId,
        enrolledAt: toDateKey(),
        status: 'active',
        completedAt: null,
      });
    }
  });
  return ok(`You joined ${challenge.title}. Good luck!`);
}

export function leaveChallenge(challengeId) {
  const state = getState();
  const userId = state.currentUserId;
  const challenge = getChallenge(state, challengeId);
  const enrollment = getEnrollment(state, userId, challengeId);
  if (!challenge || !enrollment || enrollment.status === 'left') return fail('You are not enrolled in this challenge.');
  if (enrollment.status === 'completed') return fail('Completed challenges stay in your history and cannot be left.');

  commit((draft) => {
    const record = getEnrollment(draft, userId, challengeId);
    record.status = 'left';
    record.leftAt = toDateKey();
  });
  return ok(`You left ${challenge.title}. Your logged activities are kept.`);
}

/* =====================================================================
   Activity logging
   ===================================================================== */

/**
 * Validate activity form input against all rules.
 * @returns {object} errors keyed by field name (empty object = valid)
 */
export function validateActivityInput(state, input) {
  const errors = {};
  const typeConfig = ACTIVITY_TYPES[input.type];
  if (!typeConfig) errors.type = 'Choose an activity type.';

  // Date: valid format, not in the future, not too old.
  const today = toDateKey();
  if (!PATTERNS.dateKey.test(input.date || '') || !parseDate(input.date)) {
    errors.date = 'Enter a valid date.';
  } else if (input.date > today) {
    errors.date = 'Activities cannot be logged for future dates.';
  } else if (daysBetween(input.date, today) > MAX_BACKDATE_DAYS) {
    errors.date = `Activities can be logged up to ${MAX_BACKDATE_DAYS} days back.`;
  }

  if (!PATTERNS.time.test(input.time || '')) {
    errors.time = 'Enter a valid time (HH:MM).';
  } else if (!errors.date && input.date === today && input.time > toDateTimeString().slice(11)) {
    errors.time = 'This time is still in the future.';
  }

  if (typeConfig) {
    if (!typeConfig.units[input.unit]) {
      errors.unit = `Choose a unit for ${typeConfig.label.toLowerCase()}.`;
    } else {
      const valueError = validateActivityValue(input.type, input.unit, input.value);
      if (valueError) errors.value = valueError;
    }
  }

  const description = (input.description || '').trim();
  if (description.length > 200) errors.description = 'Keep the note under 200 characters.';
  else if (!PATTERNS.safeText.test(description)) errors.description = 'Please avoid the characters < > { } and \\.';

  // Challenge rules: enrolled, active, accepts this type & unit, date inside the window.
  if (input.challengeId) {
    const challenge = getChallenge(state, input.challengeId);
    if (!challenge) {
      errors.challengeId = 'This challenge no longer exists.';
    } else if (!isEnrolled(state, state.currentUserId, challenge.id)) {
      errors.challengeId = 'Join this challenge before logging activities for it.';
    } else if (!isChallengeLoggable(challenge)) {
      errors.challengeId = 'This challenge is not active, so activities cannot count toward it.';
    } else if (typeConfig && !challenge.activityTypes.includes(input.type)) {
      errors.challengeId = `${challenge.title} does not accept ${typeConfig.label.toLowerCase()}.`;
    } else if (!errors.unit && input.unit !== getChallengeUnit(challenge)) {
      errors.unit = `${challenge.title} counts ${UNIT_LABELS[getChallengeUnit(challenge)]}. Switch the unit or log without a challenge.`;
    } else if (!errors.date && (input.date < challenge.startDate || input.date > challenge.endDate)) {
      errors.date = `${challenge.title} only counts activities between its start and end dates.`;
    }
  }

  // Duplicate protection: identical entry at the same date & time.
  if (Object.keys(errors).length === 0) {
    const dateTime = `${input.date}T${input.time}`;
    const duplicate = state.activities.some(
      (a) => a.userId === state.currentUserId && a.type === input.type && a.date === dateTime && Number(a.value) === Number(input.value),
    );
    if (duplicate) errors.form = 'An identical activity was already logged at this date and time.';
  }
  return errors;
}

/** Calculates the points an activity would earn, applying the daily cap. */
export function previewActivityPoints(state, input) {
  const base = calculateActivityPoints(input.type, input.unit, input.value);
  if (!base || !PATTERNS.dateKey.test(input.date || '')) return { base, awarded: base, capped: false };
  const earned = getPointsEarnedOnDay(state, state.currentUserId, input.type, input.date);
  const awarded = Math.max(0, Math.min(base, DAILY_POINT_CAP - earned));
  return { base, awarded, capped: awarded < base };
}

/** Save a new activity and update everything that depends on it. */
export function logActivity(input) {
  const state = getState();
  const errors = validateActivityInput(state, input);
  if (Object.keys(errors).length > 0) return fail(errors.form || 'Please fix the highlighted fields.', errors);

  const userId = state.currentUserId;
  const { awarded, capped } = previewActivityPoints(state, input);
  const enrollmentBefore = input.challengeId ? getEnrollment(state, userId, input.challengeId) : null;
  const wasActive = Boolean(enrollmentBefore && enrollmentBefore.status === 'active');

  const activity = {
    id: createId('act'),
    userId,
    challengeId: input.challengeId || null,
    type: input.type,
    value: Number(input.value),
    unit: input.unit,
    date: `${input.date}T${input.time}`,
    description: (input.description || '').trim(),
    points: awarded,
    loggedAt: toDateTimeString(),
  };

  commit((draft) => {
    draft.activities.push(activity);
  });

  // Did this activity complete a challenge?
  let completedChallenge = null;
  if (wasActive) {
    const after = getEnrollment(getState(), userId, input.challengeId);
    if (after && after.status === 'completed') completedChallenge = getChallenge(getState(), input.challengeId);
  }

  return ok('Activity saved.', { activity, points: awarded, capped, completedChallenge });
}

/* =====================================================================
   Profile, privacy & settings
   ===================================================================== */

export function validateProfileInput(input) {
  const errors = {};
  if (!PATTERNS.personName.test((input.name || '').trim())) errors.name = 'Use 2–50 letters (spaces, apostrophes and hyphens allowed).';
  if (!PATTERNS.email.test((input.email || '').trim())) errors.email = 'Enter a valid email address.';
  if ((input.headline || '').length > 70) errors.headline = 'Keep the headline under 70 characters.';
  if (!PATTERNS.safeText.test(input.headline || '')) errors.headline = 'Please avoid the characters < > { } and \\.';
  if ((input.bio || '').length > 280) errors.bio = 'Keep your bio under 280 characters.';
  if (!PATTERNS.safeText.test(input.bio || '')) errors.bio = 'Please avoid the characters < > { } and \\.';
  if ((input.location || '').length > 40) errors.location = 'Keep the location under 40 characters.';
  if (!/^static\/assets\/images\/avatars\/avatar-\d{2}\.svg$/.test(input.avatar || '')) errors.avatar = 'Choose one of the available avatars.';
  const days = Number(input.activeDays);
  if (!Number.isInteger(days) || days < 1 || days > 7) errors.activeDays = 'Choose between 1 and 7 days.';
  const points = Number(input.weeklyPoints);
  if (!Number.isInteger(points) || points < 50 || points > 3000) errors.weeklyPoints = 'Choose a goal between 50 and 3,000 points.';
  return errors;
}

export function updateProfile(input) {
  const errors = validateProfileInput(input);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  commit((draft) => {
    const user = draft.users.find((u) => u.id === draft.currentUserId);
    Object.assign(user, {
      name: input.name.trim(),
      email: input.email.trim(),
      headline: input.headline.trim(),
      bio: input.bio.trim(),
      location: input.location.trim(),
      avatar: input.avatar,
      weeklyGoals: { activeDays: Number(input.activeDays), points: Number(input.weeklyPoints) },
    });
  });
  return ok('Profile updated.');
}

export function updatePrivacy(changes) {
  commit((draft) => {
    const user = draft.users.find((u) => u.id === draft.currentUserId);
    user.privacy = { ...user.privacy, ...changes };
  });
  return ok('Privacy preferences saved.');
}

export function updateReminderPreferences(changes) {
  commit((draft) => {
    draft.settings.reminders = { ...draft.settings.reminders, ...changes };
  });
  return ok('Reminder preferences saved.');
}

export function switchDemoUser(userId) {
  const state = getState();
  const user = state.users.find((u) => u.id === userId && u.role === 'participant');
  if (!user) return fail('That participant does not exist.');
  commit((draft) => {
    draft.currentUserId = userId;
  });
  return ok(`You are now viewing Wellnest as ${user.name}.`);
}

/* =====================================================================
   Reminders
   ===================================================================== */

export function validateReminderInput(input) {
  const errors = {};
  const title = (input.title || '').trim();
  if (title.length < 3 || title.length > 60) errors.title = 'Use 3–60 characters.';
  else if (!PATTERNS.safeText.test(title)) errors.title = 'Please avoid the characters < > { } and \\.';
  if (!PATTERNS.time.test(input.time || '')) errors.time = 'Enter a valid time.';
  if (!['daily', 'weekdays', 'weekends', 'once'].includes(input.repeat)) errors.repeat = 'Choose how often to repeat.';
  if (input.repeat === 'once') {
    if (!PATTERNS.dateKey.test(input.date || '') || !parseDate(input.date)) errors.date = 'Choose a date for a one-time reminder.';
    else if (input.date < toDateKey()) errors.date = 'Choose today or a future date.';
  }
  if ((input.note || '').length > 120) errors.note = 'Keep the note under 120 characters.';
  else if (!PATTERNS.safeText.test(input.note || '')) errors.note = 'Please avoid the characters < > { } and \\.';
  if (!ACTIVITY_TYPES[input.category]) errors.category = 'Choose a category.';
  return errors;
}

export function saveReminder(input, reminderId = null) {
  const errors = validateReminderInput(input);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);
  const fields = {
    title: input.title.trim(),
    note: (input.note || '').trim(),
    time: input.time,
    repeat: input.repeat,
    date: input.repeat === 'once' ? input.date : null,
    category: input.category,
  };
  commit((draft) => {
    if (reminderId) {
      const reminder = draft.reminders.find((r) => r.id === reminderId && r.userId === draft.currentUserId);
      if (reminder) Object.assign(reminder, fields);
    } else {
      draft.reminders.push({ id: createId('rem'), userId: draft.currentUserId, enabled: true, completedOn: null, createdAt: toDateKey(), ...fields });
    }
  });
  return ok(reminderId ? 'Reminder updated.' : 'Reminder added.');
}

function updateOwnReminder(reminderId, updater) {
  const state = getState();
  const reminder = state.reminders.find((r) => r.id === reminderId && r.userId === state.currentUserId);
  if (!reminder) return null;
  commit((draft) => updater(draft.reminders.find((r) => r.id === reminderId)));
  return reminder;
}

export function toggleReminderEnabled(reminderId) {
  const reminder = updateOwnReminder(reminderId, (r) => {
    r.enabled = !r.enabled;
  });
  return reminder ? ok(reminder.enabled ? 'Reminder enabled.' : 'Reminder paused.') : fail('Reminder not found.');
}

export function toggleReminderCompleted(reminderId) {
  const today = toDateKey();
  let completed = false;
  const reminder = updateOwnReminder(reminderId, (r) => {
    const isDone = r.repeat === 'once' ? Boolean(r.completedOn) : r.completedOn === today;
    r.completedOn = isDone ? null : today;
    completed = !isDone;
  });
  return reminder ? ok(completed ? 'Nice work — reminder marked as done.' : 'Reminder marked as pending.') : fail('Reminder not found.');
}

export function deleteReminder(reminderId) {
  const state = getState();
  if (!state.reminders.some((r) => r.id === reminderId && r.userId === state.currentUserId)) return fail('Reminder not found.');
  commit((draft) => {
    draft.reminders = draft.reminders.filter((r) => r.id !== reminderId);
  });
  return ok('Reminder deleted.');
}

/* =====================================================================
   Organizer: challenge management
   ===================================================================== */

export const ORGANIZER_STATUSES = ['draft', 'active', 'paused', 'archived'];

export function validateChallengeInput(state, input, existingId = null) {
  const errors = {};
  const title = (input.title || '').trim();
  if (title.length < 4 || title.length > 60) errors.title = 'Use 4–60 characters.';
  else if (!PATTERNS.safeText.test(title)) errors.title = 'Please avoid the characters < > { } and \\.';
  else if (state.challenges.some((c) => c.id !== existingId && c.title.toLowerCase() === title.toLowerCase())) {
    errors.title = 'Another challenge already uses this name.';
  }
  const tagline = (input.tagline || '').trim();
  if (tagline.length > 80) errors.tagline = 'Keep the tagline under 80 characters.';
  const description = (input.description || '').trim();
  if (description.length < 20 || description.length > 400) errors.description = 'Write 20–400 characters.';
  else if (!PATTERNS.safeText.test(description)) errors.description = 'Please avoid the characters < > { } and \\.';
  if (!CATEGORIES[input.category]) errors.category = 'Choose a category.';
  if (!/^static\/assets\/images\/challenges\/[a-z-]+\.svg$/.test(input.image || '')) errors.image = 'Choose a cover image.';

  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (!PATTERNS.dateKey.test(input.startDate || '') || !start) errors.startDate = 'Enter a valid start date.';
  if (!PATTERNS.dateKey.test(input.endDate || '') || !end) errors.endDate = 'Enter a valid end date.';
  if (start && end) {
    const length = daysBetween(input.startDate, input.endDate) + 1;
    if (length < 1) errors.endDate = 'The end date must be on or after the start date.';
    else if (length > 120) errors.endDate = 'Challenges can last up to 120 days.';
  }

  const types = Array.isArray(input.activityTypes) ? input.activityTypes : [];
  if (types.length === 0) errors.activityTypes = 'Select at least one activity type.';
  else if (types.some((t) => !ACTIVITY_TYPES[t])) errors.activityTypes = 'Unknown activity type selected.';

  if (!['total', 'days'].includes(input.metric)) errors.metric = 'Choose how progress is measured.';
  const unit = input.metric === 'days' ? input.dailyUnit : input.targetUnit;
  if (!errors.activityTypes && !types.every((t) => ACTIVITY_TYPES[t].units[unit])) {
    errors[input.metric === 'days' ? 'dailyUnit' : 'targetUnit'] = 'Every selected activity type must support this unit.';
  }
  const target = Number(input.targetValue);
  if (!PATTERNS.positiveNumber.test(String(input.targetValue || '')) || target <= 0) errors.targetValue = 'Enter a positive target.';
  else if (input.metric === 'days' && start && end && target > daysBetween(input.startDate, input.endDate) + 1) {
    errors.targetValue = 'The number of days cannot exceed the challenge duration.';
  } else if (target > 1000000) errors.targetValue = 'That target is too large.';
  if (input.metric === 'days') {
    const minimum = Number(input.dailyMinimum);
    if (!PATTERNS.positiveNumber.test(String(input.dailyMinimum || '')) || minimum <= 0) errors.dailyMinimum = 'Enter a daily minimum.';
  }
  const reward = Number(input.rewardPoints);
  if (!PATTERNS.integer.test(String(input.rewardPoints || '')) || reward < 10 || reward > 1000) errors.rewardPoints = 'Use a whole number from 10 to 1,000.';
  if (!ORGANIZER_STATUSES.includes(input.status)) errors.status = 'Choose a status.';
  if (input.status === 'active' && end && input.endDate < toDateKey()) errors.status = 'A challenge that has already ended cannot be activated. Choose new dates or archive it.';
  const guidelines = (input.guidelines || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (guidelines.length === 0) errors.guidelines = 'Add at least one guideline (one per line).';
  else if (!PATTERNS.safeText.test(input.guidelines)) errors.guidelines = 'Please avoid the characters < > { } and \\.';
  return errors;
}

function uniqueChallengeId(state, title) {
  const base = slugify(title) || 'challenge';
  let id = base;
  let counter = 2;
  while (state.challenges.some((c) => c.id === id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  return id;
}

export function saveChallenge(input, existingId = null) {
  const state = getState();
  const errors = validateChallengeInput(state, input, existingId);
  if (Object.keys(errors).length) return fail('Please fix the highlighted fields.', errors);

  const isDays = input.metric === 'days';
  const target = Number(input.targetValue);
  const fields = {
    title: input.title.trim(),
    tagline: (input.tagline || '').trim(),
    description: input.description.trim(),
    objective: (input.objective || '').trim() || input.description.trim(),
    category: input.category,
    image: input.image,
    startDate: input.startDate,
    endDate: input.endDate,
    durationDays: daysBetween(input.startDate, input.endDate) + 1,
    activityTypes: input.activityTypes,
    metric: input.metric,
    targetValue: target,
    targetUnit: isDays ? 'days' : input.targetUnit,
    dailyMinimum: isDays ? Number(input.dailyMinimum) : null,
    dailyUnit: isDays ? input.dailyUnit : null,
    rewardPoints: Number(input.rewardPoints),
    status: input.status,
    featured: Boolean(input.featured),
    difficulty: input.difficulty || 'Beginner',
    guidelines: input.guidelines.split('\n').map((line) => line.trim()).filter(Boolean),
  };
  fields.requirements = [
    isDays
      ? `Reach ${fields.dailyMinimum} ${UNIT_LABELS[fields.dailyUnit]} on ${target} different days.`
      : `Reach ${target} total ${UNIT_LABELS[fields.targetUnit]}.`,
    `Only activities logged in ${UNIT_LABELS[isDays ? fields.dailyUnit : fields.targetUnit]} count toward this challenge.`,
    'Only activities dated inside the challenge window count.',
  ];

  let id = existingId;
  commit((draft) => {
    if (existingId) {
      const challenge = draft.challenges.find((c) => c.id === existingId);
      Object.assign(challenge, fields, { updatedAt: toDateKey() });
    } else {
      id = uniqueChallengeId(draft, fields.title);
      draft.challenges.push({ id, ...fields, createdBy: draft.organizerId, createdAt: toDateKey() });
    }
  });
  return ok(existingId ? `${fields.title} was updated.` : `${fields.title} was created.`, { id });
}

const STATUS_MESSAGES = { active: 'is now active', paused: 'has been paused', archived: 'has been archived', draft: 'was moved to drafts' };

export function setChallengeStatus(challengeId, status) {
  const state = getState();
  const challenge = getChallenge(state, challengeId);
  if (!challenge) return fail('Challenge not found.');
  if (!ORGANIZER_STATUSES.includes(status)) return fail('Unknown status.');
  if (status === 'active' && challenge.endDate < toDateKey()) {
    return fail('This challenge has already ended. Edit its dates before activating it again.');
  }
  if (status === 'draft' && getParticipantCount(state, challengeId) > 0) {
    return fail('Challenges with participants cannot be moved back to draft.');
  }
  commit((draft) => {
    const record = draft.challenges.find((c) => c.id === challengeId);
    record.status = status;
    record.updatedAt = toDateKey();
  });
  return ok(`${challenge.title} ${STATUS_MESSAGES[status]}.`);
}

export function deleteChallenge(challengeId) {
  const state = getState();
  const challenge = getChallenge(state, challengeId);
  if (!challenge) return fail('Challenge not found.');
  if (challenge.status !== 'draft') return fail('Only draft challenges can be deleted. Archive active challenges instead.');
  if (getParticipantCount(state, challengeId) > 0) return fail('This draft already has participants and cannot be deleted.');
  commit((draft) => {
    draft.challenges = draft.challenges.filter((c) => c.id !== challengeId);
    draft.enrollments = draft.enrollments.filter((e) => e.challengeId !== challengeId);
  });
  return ok(`${challenge.title} was deleted.`);
}
