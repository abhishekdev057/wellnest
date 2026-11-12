/**
 * notifications.js
 * Header notification centre (bell icon) and in-app reminder alerts.
 * Shows due / upcoming reminders, recently unlocked badges and challenges
 * that start soon. A timer checks every minute whether a reminder became due.
 */
import { getState, getCurrentUser } from '../app.js';
import {
  getUserReminders, getReminderStatus, getNextOccurrence, getActivityIcon, getActivityCategory,
  getChallenge, getChallengeStatus, getTimeRemaining, daysAgoKey,
} from '../engine.js';
import { openReminderManager, handleReminderAction } from './reminders.js';
import { showToast } from './toast.js';
import { sessionGet, sessionSet } from '../storage.js';
import { escapeHTML, icon, formatClock, toDateKey, formatRelativeDay } from '../utils.js';

let container = null;
let panel = null;
let toggle = null;

/** Collect everything worth showing in the panel. */
function getNotificationItems() {
  const state = getState();
  const user = getCurrentUser();
  if (!state || !user) return { items: [], dueCount: 0 };
  const now = new Date();
  const today = toDateKey(now);

  const reminders = getUserReminders(state, user.id);
  const reminderItems = reminders
    .map((reminder) => ({ reminder, status: getReminderStatus(reminder, now), next: getNextOccurrence(reminder, now) }))
    .filter(({ status, next }) => status === 'due' || (status === 'upcoming' && next && toDateKey(next) === today))
    .sort((a, b) => a.reminder.time.localeCompare(b.reminder.time))
    .map(({ reminder, status }) => `
      <li class="notice" data-due="${status === 'due'}" data-reminder-id="${reminder.id}">
        <span class="activity-icon" data-category="${getActivityCategory(reminder.category)}">${icon(getActivityIcon(reminder.category))}</span>
        <div>
          <p class="notice__title">${escapeHTML(reminder.title)}</p>
          <p class="notice__meta">${status === 'due' ? 'Due' : 'Today'} at ${formatClock(reminder.time)}</p>
          <button type="button" class="link-btn" data-reminder-action="complete">${icon('check')} Mark as done</button>
        </div>
      </li>`);

  const badgeItems = Object.entries(user.badgeUnlocks || {})
    .filter(([, date]) => date >= daysAgoKey(6))
    .map(([badgeId, date]) => {
      const badge = state.badges.find((b) => b.id === badgeId);
      return badge
        ? `<li class="notice">
             <img src="${escapeHTML(badge.icon)}" alt="" width="34" height="34" loading="lazy" decoding="async">
             <div><p class="notice__title">Badge unlocked: ${escapeHTML(badge.name)}</p><p class="notice__meta">${formatRelativeDay(date)}</p></div>
           </li>`
        : '';
    });

  const upcomingItems = state.enrollments
    .filter((e) => e.userId === user.id && e.status === 'active')
    .map((e) => getChallenge(state, e.challengeId))
    .filter((c) => c && getChallengeStatus(c) === 'upcoming')
    .map((c) => `
      <li class="notice">
        <span class="activity-icon" data-category="${c.category}">${icon('calendar')}</span>
        <div><p class="notice__title"><a href="challenge.html?id=${encodeURIComponent(c.id)}">${escapeHTML(c.title)}</a></p><p class="notice__meta">${getTimeRemaining(c).label}</p></div>
      </li>`);

  const dueCount = reminders.filter((r) => getReminderStatus(r, now) === 'due').length;
  return { items: [...reminderItems, ...upcomingItems, ...badgeItems].filter(Boolean), dueCount };
}

export function refreshNotifications() {
  if (!container || !panel) return;
  const { items, dueCount } = getNotificationItems();
  const dot = toggle.querySelector('.count-dot');
  dot.hidden = dueCount === 0;
  dot.textContent = dueCount;
  toggle.setAttribute('aria-label', dueCount ? `Notifications, ${dueCount} reminders due` : 'Notifications');
  panel.querySelector('.popover__list').innerHTML = items.length
    ? items.join('')
    : '<li class="notice"><span class="activity-icon">' + icon('check') + '</span><div><p class="notice__title">You are all caught up</p><p class="notice__meta">No reminders due right now.</p></div></li>';
}

function setOpen(open) {
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) refreshNotifications();
}

/** Show a toast when a reminder becomes due (once per reminder per day per tab session). */
function checkDueReminders() {
  const state = getState();
  const user = getCurrentUser();
  if (!state || !user || state.settings.reminders.inAppAlerts === false) {
    refreshNotifications();
    return;
  }
  const alerted = sessionGet('alerted_reminders', []);
  const today = toDateKey();
  const fresh = getUserReminders(state, user.id)
    .filter((r) => getReminderStatus(r) === 'due')
    .filter((r) => !alerted.includes(`${r.id}:${today}`));
  fresh.forEach((r) => alerted.push(`${r.id}:${today}`));

  // One reminder gets its own toast; several due at once are grouped into a
  // single summary so the page never opens under a stack of notifications.
  if (fresh.length === 1) {
    const [reminder] = fresh;
    showToast({ type: 'info', title: `Reminder: ${reminder.title}`, message: reminder.note || `Scheduled for ${formatClock(reminder.time)}.`, duration: 7000 });
  } else if (fresh.length > 1) {
    const names = fresh.map((r) => r.title);
    const list = names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    showToast({ type: 'info', title: `${fresh.length} reminders due`, message: `${list}. Open the bell to review them.`, duration: 8000 });
  }
  sessionSet('alerted_reminders', alerted.slice(-50));
  refreshNotifications();
}

export function initNotifications() {
  // Global shortcut: any [data-action="manage-reminders"] opens the manager.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="manage-reminders"]')) {
      event.preventDefault();
      if (panel) setOpen(false);
      openReminderManager();
    }
  });

  container = document.querySelector('[data-notifications]');
  if (!container) return;
  container.innerHTML = `
    <button type="button" class="icon-btn" aria-expanded="false" aria-controls="notifications-panel" aria-label="Notifications">
      ${icon('bell')}<span class="count-dot" hidden></span>
    </button>
    <div class="popover" id="notifications-panel" role="region" aria-label="Notifications" hidden>
      <div class="popover__header">
        <h2>Notifications</h2>
        <button type="button" class="link-btn" data-action="manage-reminders">Manage reminders</button>
      </div>
      <ul class="popover__list" role="list"></ul>
    </div>`;
  toggle = container.querySelector('button');
  panel = container.querySelector('.popover');

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('click', (event) => {
    handleReminderAction(event);
  });
  document.addEventListener('click', (event) => {
    // isConnected: ignore clicks on elements that were just re-rendered away.
    if (!panel.hidden && event.target.isConnected && !container.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  checkDueReminders();
  setInterval(checkDueReminders, 60 * 1000);
}
