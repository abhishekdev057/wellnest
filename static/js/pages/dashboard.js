/**
 * dashboard.js — Participant dashboard.
 * Every number on this page is calculated from the state by engine.js.
 */
import { initApp, getState, getCurrentUser, onStateChange } from '../app.js';
import {
  getUserStats, getUserActivities, getDailySeries, getActivityLevel, getBadgeProgress,
  getChallenge, getChallengeStatus, getChallengeProgress, getTimeRemaining, isChallengeLoggable,
  getUserReminders, UNIT_LABELS,
} from '../engine.js';
import { progressRing, progressBar, barChart } from '../components/charts.js';
import { activityItem, statTile, trend, emptyState, categoryPill, challengeUrl, coverImage } from '../components/templates.js';
import { reminderRow, sortReminders, handleReminderAction } from '../components/reminders.js';
import {
  $, escapeHTML, icon, formatNumber, formatValue, formatLongDate, formatWeekday, formatShortDate, getGreeting, firstName,
  percent, pluralize, toDateKey, addDays, startOfToday, daysBetween, clamp,
} from '../utils.js';

const view = (name) => $(`[data-dash="${name}"]`);

/* ---------------- Welcome ---------------- */

function weeklySummary(stats) {
  const streakText = stats.activeToday
    ? `You've already been active today — ${pluralize(stats.currentStreak, 'day')} in a row and counting.`
    : stats.currentStreak > 0
      ? `Log an activity today to keep your ${stats.currentStreak}-day streak alive.`
      : 'Log an activity today to start a fresh streak.';
  const weekText = stats.weekActivities
    ? ` This week: ${pluralize(stats.weekActivities, 'activity', 'activities')} across ${pluralize(stats.weekActiveDays, 'day')}, ${formatNumber(stats.weekPoints)} points.`
    : ' Nothing logged in the last 7 days yet.';
  return streakText + weekText;
}

function renderWelcome(user, stats) {
  const today = new Date();
  view('welcome').innerHTML = `
    <div class="welcome__identity">
      <img class="avatar avatar--xl welcome__avatar" src="${escapeHTML(user.avatar)}" alt="${escapeHTML(user.name)}" width="96" height="96">
      <div>
        <p class="welcome__date"><time datetime="${toDateKey(today)}">${formatLongDate(today)}</time></p>
        <h1 id="welcome-title">${getGreeting(today)}, ${escapeHTML(firstName(user.name))}</h1>
        <p class="welcome__summary">${escapeHTML(weeklySummary(stats))}</p>
      </div>
    </div>
    <div class="welcome__actions">
      <button type="button" class="btn btn--primary btn--lg" data-action="log-activity">${icon('plus')} Log activity</button>
      <a class="btn btn--lg" href="challenges.html">Browse challenges</a>
    </div>`;
}

/* ---------------- Statistics ---------------- */

function renderStats(stats) {
  view('stats').innerHTML = [
    statTile({ iconName: 'star', label: 'Total points', value: formatNumber(stats.totalPoints), meta: trend(stats.weekPoints, stats.previousWeekPoints), feature: true }),
    statTile({ iconName: 'flag', label: 'Active challenges', value: formatNumber(stats.activeChallenges), meta: `${pluralize(stats.completedChallenges, 'challenge')} completed` }),
    statTile({ iconName: 'flame', label: 'Current streak', value: `${stats.currentStreak}<small> ${stats.currentStreak === 1 ? 'day' : 'days'}</small>`, meta: `Longest streak: ${pluralize(stats.longestStreak, 'day')}` }),
    statTile({ iconName: 'activity', label: 'Activities completed', value: formatNumber(stats.totalActivities), meta: `${formatNumber(stats.weekActivities)} in the last 7 days` }),
  ].join('');
}

/* ---------------- Weekly progress ---------------- */

/** A challenge is "on track" when its progress keeps pace with elapsed time. */
function isOnTrack(challenge, progress) {
  const elapsed = clamp(daysBetween(challenge.startDate, toDateKey()) + 1, 1, challenge.durationDays);
  return progress.percent >= Math.round((elapsed / challenge.durationDays) * 100) - 5;
}

function renderWeek(state, user, stats, activeItems) {
  const goals = user.weeklyGoals || { activeDays: 5, points: 400 };
  const series = getDailySeries(getUserActivities(state, user.id), 7);
  const chartData = series.map((day, index) => ({
    label: formatWeekday(day.date),
    value: day.points,
    highlight: index === series.length - 1,
    title: `${formatShortDate(day.date)}: ${formatNumber(day.points)} points from ${pluralize(day.count, 'activity', 'activities')}`,
  }));
  const loggable = activeItems.filter((item) => isChallengeLoggable(item.challenge));
  const onTrack = loggable.filter((item) => isOnTrack(item.challenge, item.progress)).length;

  view('week').innerHTML = `
    <div class="week">
      <div class="week__rings">
        <div class="week__ring">
          ${progressRing(percent(stats.weekActiveDays, goals.activeDays), { size: 112, label: `${stats.weekActiveDays}/${goals.activeDays}`, sublabel: 'active days' })}
        </div>
        <div class="week__ring">
          ${progressRing(percent(stats.weekPoints, goals.points), { size: 112, label: formatNumber(stats.weekPoints), sublabel: `of ${formatNumber(goals.points)} pts`, category: 'hydration' })}
        </div>
      </div>
      <div class="week__chart">
        <p class="week__chart-title">Daily points</p>
        ${barChart(chartData, { height: 170, title: 'Points earned per day over the last 7 days', valueSuffix: ' pts' })}
      </div>
    </div>
    <ul class="goal-list" role="list">
      <li>
        <div class="split"><span>${icon('calendar')} Active days goal</span><strong>${stats.weekActiveDays} of ${goals.activeDays} days</strong></div>
        ${progressBar(stats.weekActiveDays, goals.activeDays, 'Active days goal')}
      </li>
      <li>
        <div class="split"><span>${icon('star')} Weekly points goal</span><strong>${formatNumber(stats.weekPoints)} of ${formatNumber(goals.points)}</strong></div>
        ${progressBar(stats.weekPoints, goals.points, 'Weekly points goal')}
      </li>
      <li>
        <div class="split"><span>${icon('target')} Challenges on track</span><strong>${onTrack} of ${loggable.length}</strong></div>
        ${progressBar(onTrack, Math.max(loggable.length, 1), 'Challenges on track')}
      </li>
    </ul>`;
}

/* ---------------- Current challenges ---------------- */

function getActiveItems(state, userId) {
  return state.enrollments
    .filter((e) => e.userId === userId && e.status === 'active')
    .map((e) => getChallenge(state, e.challengeId))
    .filter((c) => c && ['active', 'upcoming', 'paused'].includes(getChallengeStatus(c)))
    .map((challenge) => ({ challenge, progress: getChallengeProgress(state, userId, challenge), remaining: getTimeRemaining(challenge) }))
    .sort((a, b) => {
      const order = { active: 0, upcoming: 1, paused: 2 };
      return order[getChallengeStatus(a.challenge)] - order[getChallengeStatus(b.challenge)] || a.remaining.days - b.remaining.days;
    });
}

function remainingText(challenge, progress) {
  if (progress.completed) return 'Target reached';
  if (challenge.metric === 'days') return `${progress.remaining} more ${progress.remaining === 1 ? 'day' : 'days'} with ${formatValue(challenge.dailyMinimum)}+ ${UNIT_LABELS[challenge.dailyUnit]}`;
  return `${formatValue(progress.remaining)} ${UNIT_LABELS[challenge.targetUnit]} to go`;
}

function renderChallenges(items) {
  if (!items.length) {
    view('challenges').innerHTML = emptyState({
      title: 'No active challenges',
      text: 'Join a challenge to start tracking progress toward a goal.',
      action: '<a class="btn btn--primary" href="challenges.html">Browse challenges</a>',
      compact: true,
    });
    return;
  }
  view('challenges').innerHTML = items
    .map(({ challenge, progress, remaining }) => {
      const status = getChallengeStatus(challenge);
      return `
        <article class="challenge-row">
          ${coverImage(challenge.image, { className: 'challenge-row__thumb', sizes: '96px', width: 96, height: 72 })}
          <div class="challenge-row__body">
            <div class="cluster challenge-row__meta">
              ${categoryPill(challenge.category)}
              <span class="small muted">${icon('clock')} ${escapeHTML(remaining.label)}</span>
              ${status === 'paused' ? '<span class="status" data-status="paused">Paused</span>' : ''}
            </div>
            <h3 class="challenge-row__title"><a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a></h3>
            ${progressBar(progress.current, progress.target, `${challenge.title} progress`)}
            <div class="progress-meta">
              <span>${escapeHTML(remainingText(challenge, progress))}</span>
              <span>${formatValue(progress.current)} / ${formatValue(progress.target)} ${escapeHTML(progress.unit)}</span>
            </div>
          </div>
          <div class="challenge-row__side">
            <span class="challenge-row__percent">${progress.percent}<small>%</small></span>
            <div class="cluster">
              ${isChallengeLoggable(challenge) ? `<button type="button" class="icon-btn" data-action="log-activity" data-challenge-id="${escapeHTML(challenge.id)}" aria-label="Log activity for ${escapeHTML(challenge.title)}">${icon('plus')}</button>` : ''}
              <a class="btn btn--sm" href="${challengeUrl(challenge.id)}">Continue</a>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

/* ---------------- Recent activity ---------------- */

function renderActivity(state, userId) {
  const recent = getUserActivities(state, userId).slice(0, 6);
  view('activity').innerHTML = recent.length
    ? `<ol class="timeline" role="list">${recent.map((a) => activityItem(state, a)).join('')}</ol>`
    : emptyState({
      title: 'No activities yet',
      text: 'Your logged walks, water breaks and mindful minutes will appear here.',
      action: '<button type="button" class="btn btn--primary" data-action="log-activity">Log your first activity</button>',
      compact: true,
    });
}

/* ---------------- Streak calendar ---------------- */

function renderCalendar(state, userId, stats) {
  const activities = getUserActivities(state, userId);
  const today = startOfToday();
  // Start on the Monday four weeks before this week's Monday.
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = addDays(today, -mondayOffset - 28);
  const pointsByDay = {};
  activities.forEach((a) => {
    const key = a.date.slice(0, 10);
    pointsByDay[key] = (pointsByDay[key] || 0) + a.points;
  });

  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="heatmap__label" aria-hidden="true">${d.slice(0, 1)}</span>`).join('');
  let cells = '';
  for (let i = 0; i < 35; i += 1) {
    const date = addDays(start, i);
    const key = toDateKey(date);
    const isFuture = date > today;
    const points = pointsByDay[key] || 0;
    cells += `<span class="heatmap__cell" data-level="${isFuture ? 0 : getActivityLevel(points)}" data-today="${key === toDateKey(today)}" data-future="${isFuture}" title="${formatShortDate(date)}: ${isFuture ? 'upcoming' : `${formatNumber(points)} points`}"></span>`;
  }
  const activeDays = Object.keys(pointsByDay).filter((key) => key >= toDateKey(start)).length;

  $('[data-dash="streak-caption"]').textContent = `Current ${pluralize(stats.currentStreak, 'day')} · Longest ${pluralize(stats.longestStreak, 'day')}`;
  view('calendar').innerHTML = `
    <div class="heatmap" role="img" aria-label="Activity calendar for the last five weeks: active on ${activeDays} days. Current streak ${stats.currentStreak} days.">
      ${labels}${cells}
    </div>
    <div class="heatmap-legend" aria-hidden="true">
      <span>Less</span>
      ${[0, 1, 2, 3, 4].map((level) => `<span class="heatmap__cell" data-level="${level}"></span>`).join('')}
      <span>More</span>
    </div>`;
}

/* ---------------- Achievements ---------------- */

function renderBadges(state, userId) {
  const progress = getBadgeProgress(state, userId);
  const unlocked = progress.filter((p) => p.unlocked).sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || ''));
  const next = progress.filter((p) => !p.unlocked).sort((a, b) => b.percent - a.percent)[0];
  $('[data-dash="badge-caption"]').textContent = `${unlocked.length} of ${progress.length} unlocked`;

  view('badges').innerHTML = `
    ${next ? `
      <div class="next-badge">
        <img src="${escapeHTML(next.badge.icon)}" alt="" width="56" height="56">
        <div class="next-badge__body">
          <p class="small muted">Next up</p>
          <h3>${escapeHTML(next.badge.name)}</h3>
          <p class="small muted">${escapeHTML(next.badge.hint || next.badge.description)}</p>
          ${progressBar(next.current, next.target, `${next.badge.name} progress`)}
          <p class="progress-meta"><span>${next.percent}%</span><span>${formatNumber(next.current)} / ${formatNumber(next.target)}</span></p>
        </div>
      </div>` : '<p class="small muted">You have unlocked every badge. Incredible!</p>'}
    ${unlocked.length
      ? `<ul class="mini-badges" role="list">${unlocked.slice(0, 8).map((p) => `<li><img src="${escapeHTML(p.badge.icon)}" alt="${escapeHTML(p.badge.name)}" title="${escapeHTML(p.badge.name)}" width="44" height="44" loading="lazy" decoding="async"></li>`).join('')}</ul>`
      : '<p class="small muted">Log your first activity to unlock “First Step”.</p>'}`;
}

/* ---------------- Reminders ---------------- */

function renderReminders(state, userId) {
  if (state.settings.reminders.showOnDashboard === false) {
    view('reminders').innerHTML = '<p class="small muted">Reminders are hidden from the dashboard. You can show them again in <a href="settings.html#reminder-preferences">Settings</a>.</p>';
    return;
  }
  const reminders = sortReminders(getUserReminders(state, userId).filter((r) => r.enabled)).slice(0, 4);
  view('reminders').innerHTML = reminders.length
    ? `<ul class="list reminder-list" role="list">${reminders.map((r) => reminderRow(r)).join('')}</ul>`
    : emptyState({ title: 'No reminders', text: 'Add a reminder to stay on track.', action: '<button type="button" class="btn btn--sm" data-action="manage-reminders">Add reminder</button>', compact: true });
}

/* ---------------- Page ---------------- */

function render() {
  const state = getState();
  const user = getCurrentUser();
  const stats = getUserStats(state, user.id);
  const activeItems = getActiveItems(state, user.id);
  renderWelcome(user, stats);
  renderStats(stats);
  renderWeek(state, user, stats, activeItems);
  renderChallenges(activeItems);
  renderActivity(state, user.id);
  renderCalendar(state, user.id, stats);
  renderBadges(state, user.id);
  renderReminders(state, user.id);
}

async function init() {
  const state = await initApp('dashboard');
  if (!state) return;
  render();
  onStateChange(render);
  // Reminder checkboxes on the dashboard (event delegation).
  view('reminders').addEventListener('click', handleReminderAction);
  // Re-render once a minute so reminder states and greetings stay current.
  setInterval(render, 60 * 1000);
}

init();
