/**
 * reminders.js
 * Reminder management UI: list, add, edit, complete, enable/disable, delete.
 * Used from the dashboard, notifications panel and settings page.
 */
import { getState, onStateChange } from '../app.js';
import { saveReminder, toggleReminderEnabled, toggleReminderCompleted, deleteReminder, validateReminderInput } from '../actions.js';
import {
  ACTIVITY_TYPES, REPEAT_LABELS, getUserReminders, getReminderStatus, getNextOccurrence,
  getActivityIcon, getActivityCategory,
} from '../engine.js';
import { openModal, confirmDialog } from './modal.js';
import { showToast } from './toast.js';
import {
  escapeHTML, icon, formatClock, formatShortDate, formatRelativeDay, toDateKey,
  fieldError, describedBy, setFieldErrors, readForm,
} from '../utils.js';

const STATUS_TEXT = { due: 'Due now', upcoming: 'Upcoming', completed: 'Done', disabled: 'Paused', missed: 'Missed' };

/** Sort reminders: due first, then by next occurrence, disabled last. */
export function sortReminders(reminders) {
  const order = { due: 0, upcoming: 1, missed: 2, completed: 3, disabled: 4 };
  return [...reminders].sort((a, b) => {
    const statusDiff = order[getReminderStatus(a)] - order[getReminderStatus(b)];
    if (statusDiff !== 0) return statusDiff;
    const nextA = getNextOccurrence(a);
    const nextB = getNextOccurrence(b);
    return (nextA ? nextA.getTime() : Infinity) - (nextB ? nextB.getTime() : Infinity) || a.time.localeCompare(b.time);
  });
}

/** Describe when a reminder fires next: "Today · 3:30 pm". */
export function describeSchedule(reminder) {
  const next = getNextOccurrence(reminder);
  const repeat = reminder.repeat === 'once' ? formatShortDate(reminder.date) : REPEAT_LABELS[reminder.repeat];
  const when = next ? `${formatRelativeDay(toDateKey(next))} · ${formatClock(reminder.time)}` : formatClock(reminder.time);
  return `${when} · ${repeat}`;
}

/**
 * Markup for one reminder row.
 * @param {boolean} manage include edit / delete / enable controls
 */
export function reminderRow(reminder, { manage = false } = {}) {
  const status = getReminderStatus(reminder);
  const done = status === 'completed';
  return `
    <li class="reminder-row" data-reminder-id="${reminder.id}" data-status="${status}">
      <button type="button" class="reminder-check" data-reminder-action="complete" aria-pressed="${done}"
        aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${escapeHTML(reminder.title)}" ${reminder.enabled ? '' : 'disabled'}>
        ${icon('check')}
      </button>
      <span class="activity-icon" data-category="${getActivityCategory(reminder.category)}">${icon(getActivityIcon(reminder.category))}</span>
      <div class="list-row__main">
        <p class="list-row__title">${escapeHTML(reminder.title)}</p>
        <p class="list-row__meta">${escapeHTML(describeSchedule(reminder))}${reminder.note ? ` · ${escapeHTML(reminder.note)}` : ''}</p>
      </div>
      <span class="status" data-status="${status === 'due' ? 'paused' : status === 'completed' ? 'completed' : status === 'disabled' ? 'archived' : 'upcoming'}">${STATUS_TEXT[status]}</span>
      ${manage ? `
        <div class="reminder-row__controls">
          <label class="switch" title="${reminder.enabled ? 'Disable' : 'Enable'} reminder">
            <input type="checkbox" data-reminder-action="toggle" ${reminder.enabled ? 'checked' : ''} aria-label="Reminder enabled: ${escapeHTML(reminder.title)}">
            <span class="switch__track"></span>
          </label>
          <button type="button" class="icon-btn icon-btn--sm" data-reminder-action="edit" aria-label="Edit ${escapeHTML(reminder.title)}">${icon('edit')}</button>
          <button type="button" class="icon-btn icon-btn--sm" data-reminder-action="delete" aria-label="Delete ${escapeHTML(reminder.title)}">${icon('trash')}</button>
        </div>` : ''}
    </li>`;
}

/**
 * Handles clicks on reminder controls inside any container (event delegation).
 * Pages call this from their own click listener.
 * @returns {boolean} true when the event was handled
 */
export async function handleReminderAction(event) {
  const control = event.target.closest('[data-reminder-action]');
  if (!control) return false;
  const row = control.closest('[data-reminder-id]');
  const reminderId = row && row.dataset.reminderId;
  const reminder = getState().reminders.find((r) => r.id === reminderId);
  if (!reminder) return true;

  const action = control.dataset.reminderAction;
  if (action === 'complete') {
    const result = toggleReminderCompleted(reminderId);
    showToast({ type: result.ok ? 'success' : 'error', title: result.message });
  } else if (action === 'toggle') {
    const result = toggleReminderEnabled(reminderId);
    showToast({ type: 'info', title: result.message, duration: 2500 });
  } else if (action === 'edit') {
    openReminderForm(reminder);
  } else if (action === 'delete') {
    const confirmed = await confirmDialog({
      title: 'Delete reminder?',
      message: `"${reminder.title}" will be removed permanently.`,
      confirmText: 'Delete reminder',
      tone: 'danger',
    });
    if (confirmed) {
      const result = deleteReminder(reminderId);
      showToast({ type: result.ok ? 'success' : 'error', title: result.message });
    }
  }
  return true;
}

/* ---------------- Reminder form ---------------- */

const FORM_ID = 'reminder-form';

export function openReminderForm(reminder = null) {
  const state = getState();
  const defaults = reminder || {
    title: '', note: '', time: state.settings.reminders.defaultTime || '08:00', repeat: 'daily', date: toDateKey(), category: 'hydration',
  };
  const categoryOptions = Object.entries(ACTIVITY_TYPES)
    .map(([key, type]) => `<option value="${key}" ${key === defaults.category ? 'selected' : ''}>${escapeHTML(type.label)}</option>`)
    .join('');
  const repeatOptions = Object.entries(REPEAT_LABELS)
    .map(([key, label]) => `<option value="${key}" ${key === defaults.repeat ? 'selected' : ''}>${label}</option>`)
    .join('');

  const modal = openModal({
    title: reminder ? 'Edit reminder' : 'New reminder',
    description: 'Reminders appear in Wellnest while it is open. No emails or push notifications are sent.',
    content: `
      <form id="${FORM_ID}" class="form" novalidate>
        <p class="form-alert" data-form-alert role="alert" hidden></p>
        <div class="form-grid">
          <div class="field field--full">
            <label for="${FORM_ID}-title" class="required">Reminder</label>
            <input class="input" id="${FORM_ID}-title" name="title" value="${escapeHTML(defaults.title)}" required minlength="3" maxlength="60" placeholder="e.g. Refill water bottle" aria-describedby="${describedBy(FORM_ID, 'title')}" data-autofocus>
            ${fieldError(FORM_ID, 'title')}
          </div>
          <div class="field">
            <label for="${FORM_ID}-category" class="required">Activity</label>
            <select class="select" id="${FORM_ID}-category" name="category" required aria-describedby="${describedBy(FORM_ID, 'category')}">${categoryOptions}</select>
            ${fieldError(FORM_ID, 'category')}
          </div>
          <div class="field">
            <label for="${FORM_ID}-time" class="required">Time</label>
            <input class="input" type="time" id="${FORM_ID}-time" name="time" value="${escapeHTML(defaults.time)}" required aria-describedby="${describedBy(FORM_ID, 'time')}">
            ${fieldError(FORM_ID, 'time')}
          </div>
          <div class="field">
            <label for="${FORM_ID}-repeat" class="required">Repeat</label>
            <select class="select" id="${FORM_ID}-repeat" name="repeat" required aria-describedby="${describedBy(FORM_ID, 'repeat')}">${repeatOptions}</select>
            ${fieldError(FORM_ID, 'repeat')}
          </div>
          <div class="field" data-date-field ${defaults.repeat === 'once' ? '' : 'hidden'}>
            <label for="${FORM_ID}-date" class="required">Date</label>
            <input class="input" type="date" id="${FORM_ID}-date" name="date" value="${escapeHTML(defaults.date || toDateKey())}" min="${toDateKey()}" aria-describedby="${describedBy(FORM_ID, 'date')}">
            ${fieldError(FORM_ID, 'date')}
          </div>
          <div class="field field--full">
            <label for="${FORM_ID}-note">Note <span class="muted">(optional)</span></label>
            <input class="input" id="${FORM_ID}-note" name="note" value="${escapeHTML(defaults.note || '')}" maxlength="120" placeholder="A short note to future you" aria-describedby="${describedBy(FORM_ID, 'note')}">
            ${fieldError(FORM_ID, 'note')}
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn--primary">${icon('check')} ${reminder ? 'Save changes' : 'Add reminder'}</button>
        </div>
      </form>`,
  });

  const form = modal.body.querySelector('form');
  form.elements.repeat.addEventListener('change', () => {
    form.querySelector('[data-date-field]').hidden = form.elements.repeat.value !== 'once';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readForm(form);
    const errors = validateReminderInput(input);
    if (Object.keys(errors).length) {
      const first = setFieldErrors(form, errors);
      if (first) first.focus();
      return;
    }
    const result = saveReminder(input, reminder ? reminder.id : null);
    if (!result.ok) {
      setFieldErrors(form, { ...result.errors, form: result.message });
      return;
    }
    modal.close();
    showToast({ type: 'success', title: result.message, message: `${input.title} · ${formatClock(input.time)}` });
  });
}

/* ---------------- Reminder manager ---------------- */

export function openReminderManager() {
  const render = (container) => {
    const state = getState();
    const reminders = sortReminders(getUserReminders(state, state.currentUserId));
    container.innerHTML = reminders.length
      ? `<ul class="list reminder-list" role="list">${reminders.map((r) => reminderRow(r, { manage: true })).join('')}</ul>`
      : `<div class="empty-state empty-state--compact">
           <img src="static/assets/images/backgrounds/empty-state.webp" alt="" width="480" height="389" loading="lazy" decoding="async">
           <h3>No reminders yet</h3>
           <p>Add a gentle nudge for water, stretching or a mindful minute.</p>
         </div>`;
  };

  const modal = openModal({
    title: 'Manage reminders',
    description: 'Mark reminders as done, pause them, or create new ones.',
    size: 'lg',
    content: `
      <div class="split reminder-manager__bar">
        <p class="small muted">Done reminders reset automatically the next day.</p>
        <button type="button" class="btn btn--primary btn--sm" data-new-reminder>${icon('plus')} Add reminder</button>
      </div>
      <div data-reminder-list></div>`,
    onClose: () => unsubscribe(),
  });

  const listContainer = modal.body.querySelector('[data-reminder-list]');
  render(listContainer);
  const unsubscribe = onStateChange(() => render(listContainer));

  modal.body.addEventListener('click', (event) => {
    if (event.target.closest('[data-new-reminder]')) {
      openReminderForm();
      return;
    }
    handleReminderAction(event);
  });
}
