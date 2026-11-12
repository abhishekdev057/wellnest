/**
 * settings.js — Privacy, reminder preferences, theme, demo account,
 * data export and resetting the demonstration data.
 */
import { initApp, getState, getCurrentUser, onStateChange, setThemePreference, replaceState } from '../app.js';
import { updatePrivacy, updateReminderPreferences, switchDemoUser } from '../actions.js';
import { resetToSeed } from '../data-service.js';
import { getParticipants, getUserReminders, getReminderStatus } from '../engine.js';
import { STORAGE_KEY, getStoredSizeKB, sessionRemove } from '../storage.js';
import { confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { $, escapeHTML, formatDate, toDateKey, PATTERNS, setFieldErrors } from '../utils.js';

const PRIVACY_LABELS = {
  profileVisible: ['Profile is now public', 'Profile is now private'],
  leaderboardVisible: ['You are visible on leaderboards', 'You are hidden from leaderboards'],
  activityVisible: ['Your activity is shared', 'Your activity is now private'],
};

function render() {
  const state = getState();
  const user = getCurrentUser();

  // Privacy
  const privacyForm = $('[data-privacy-form]');
  Object.keys(PRIVACY_LABELS).forEach((key) => {
    privacyForm.elements[key].checked = user.privacy[key] !== false;
  });

  // Reminders
  const prefs = state.settings.reminders;
  const reminderForm = $('[data-reminder-form]');
  reminderForm.elements.showOnDashboard.checked = prefs.showOnDashboard !== false;
  reminderForm.elements.inAppAlerts.checked = prefs.inAppAlerts !== false;
  if (document.activeElement !== reminderForm.elements.defaultTime) reminderForm.elements.defaultTime.value = prefs.defaultTime || '08:00';
  const reminders = getUserReminders(state, user.id);
  const enabled = reminders.filter((r) => r.enabled).length;
  const doneToday = reminders.filter((r) => getReminderStatus(r) === 'completed').length;
  $('[data-reminder-summary]').textContent = `You have ${reminders.length} reminders: ${enabled} enabled, ${doneToday} done today.`;

  // Theme
  const themeForm = $('[data-theme-form]');
  const current = themeForm.querySelector(`input[value="${state.settings.theme}"]`);
  if (current) current.checked = true;

  // Demo account
  const select = $('#demo-user');
  select.innerHTML = getParticipants(state)
    .map((p) => `<option value="${p.id}" ${p.id === user.id ? 'selected' : ''}>${escapeHTML(p.name)} — ${escapeHTML(p.team || '')}</option>`)
    .join('');

  // Storage information
  $('[data-storage-info]').innerHTML = `
    <div><dt>Storage key</dt><dd><code>${STORAGE_KEY}</code></dd></div>
    <div><dt>Saved data size</dt><dd>${getStoredSizeKB()} KB</dd></div>
    <div><dt>Records</dt><dd>${state.activities.length} activities · ${state.enrollments.length} enrollments · ${state.challenges.length} challenges · ${state.reminders.length} reminders</dd></div>
    <div><dt>Demo data loaded</dt><dd>${formatDate(toDateKey(new Date(state.seededAt)))}</dd></div>
    <div><dt>Last saved</dt><dd>${state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleString('en-IN') : '—'}</dd></div>`;
}

/** Download the state as a JSON file using a Blob URL. */
function exportData() {
  try {
    const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wellnest-data-${toDateKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast({ type: 'success', title: 'Export ready', message: 'Your Wellnest data was downloaded as JSON.' });
  } catch (error) {
    console.error('[Wellnest] Export failed:', error);
    showToast({ type: 'error', title: 'Export failed', message: 'Your browser could not create the download.' });
  }
}

async function resetData(button) {
  const confirmed = await confirmDialog({
    title: 'Reset demonstration data?',
    message: 'All activities, enrollments, reminders, challenges and profile changes made in this browser will be replaced with the original demo data. This cannot be undone.',
    confirmText: 'Reset data',
    tone: 'danger',
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const state = await resetToSeed();
    ['challenge_filters', 'leaderboard_view', 'organizer_tab', 'alerted_reminders'].forEach(sessionRemove);
    replaceState(state);
    showToast({ type: 'success', title: 'Demo data restored', message: 'Wellnest has been reset to the original seed data.' });
  } catch (error) {
    console.error('[Wellnest] Reset failed:', error);
    showToast({ type: 'error', title: 'Reset failed', message: error.message || 'The seed data could not be loaded. Your current data was kept.' });
  } finally {
    button.disabled = false;
  }
}

async function init() {
  const state = await initApp('settings');
  if (!state) return;
  render();
  onStateChange(render);

  $('[data-privacy-form]').addEventListener('change', (event) => {
    const key = event.target.name;
    if (!PRIVACY_LABELS[key]) return;
    updatePrivacy({ [key]: event.target.checked });
    showToast({ type: 'info', title: PRIVACY_LABELS[key][event.target.checked ? 0 : 1], duration: 3000 });
  });

  const reminderForm = $('[data-reminder-form]');
  reminderForm.addEventListener('submit', (event) => event.preventDefault());
  reminderForm.addEventListener('change', (event) => {
    const { name } = event.target;
    if (name === 'defaultTime') {
      if (!PATTERNS.time.test(event.target.value)) {
        setFieldErrors(reminderForm, { defaultTime: 'Enter a valid time.' });
        return;
      }
      setFieldErrors(reminderForm, {});
      updateReminderPreferences({ defaultTime: event.target.value });
    } else if (name === 'showOnDashboard' || name === 'inAppAlerts') {
      updateReminderPreferences({ [name]: event.target.checked });
    } else return;
    showToast({ type: 'success', title: 'Reminder preferences saved', duration: 2500 });
  });

  $('[data-theme-form]').addEventListener('change', (event) => {
    if (event.target.name !== 'theme') return;
    setThemePreference(event.target.value);
    showToast({ type: 'info', title: `Theme set to ${event.target.value}`, duration: 2500 });
  });

  $('[data-demo-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    const userId = event.target.elements.userId.value;
    if (userId === getState().currentUserId) {
      showToast({ type: 'info', title: 'Already signed in as this participant', duration: 2500 });
      return;
    }
    const result = switchDemoUser(userId);
    showToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Participant switched' : 'Could not switch', message: result.message });
  });

  $('[data-export]').addEventListener('click', exportData);
  $('[data-reset]').addEventListener('click', (event) => resetData(event.currentTarget));
}

init();
