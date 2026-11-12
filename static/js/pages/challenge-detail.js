/**
 * challenge-detail.js — Dynamic challenge page: challenge.html?id=<challenge-id>
 * Shows the challenge, the participant's progress and community information,
 * and handles join / leave with confirmation dialogs.
 */
import { initApp, getState, onStateChange } from '../app.js';
import { joinChallenge, leaveChallenge } from '../actions.js';
import {
  ACTIVITY_TYPES, UNIT_LABELS, getChallenge, getChallengeStatus, getEnrollment, getChallengeProgress,
  getChallengeEnrollments, getTimeRemaining, describeTarget, canJoinChallenge, isChallengeLoggable, buildLeaderboard,
  getActivityIcon,
} from '../engine.js';
import { progressRing, progressBar } from '../components/charts.js';
import { activityItem, categoryPill, statusBadge, emptyState, personBlock, movementBadge } from '../components/templates.js';
import { confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { $, escapeHTML, icon, formatNumber, formatValue, formatDate, getQueryParam, percent, pluralize } from '../utils.js';

const root = () => $('[data-detail-root]');

/* ---------------- Not found ---------------- */

function renderNotFound(id) {
  document.title = 'Challenge not found · Wellnest';
  root().innerHTML = `
    <section class="not-found" aria-labelledby="nf-title">
      <img src="static/assets/images/backgrounds/not-found.svg" alt="" width="320" height="220">
      <p class="eyebrow">404 · Challenge not found</p>
      <h1 id="nf-title">This trail doesn't lead anywhere</h1>
      <p class="lead">${id ? `We couldn't find a challenge with the ID “${escapeHTML(id)}”. It may have been removed or the link is incorrect.` : 'No challenge was specified in the link.'}</p>
      <div class="cluster">
        <a class="btn btn--primary" href="challenges.html">Browse all challenges</a>
        <a class="btn" href="dashboard.html">Go to dashboard</a>
      </div>
    </section>`;
}

/* ---------------- Sections ---------------- */

function heroActions(state, challenge, enrollment) {
  const status = getChallengeStatus(challenge);
  const joinable = canJoinChallenge(challenge);
  const actions = [];
  if (enrollment && enrollment.status === 'active') {
    if (isChallengeLoggable(challenge)) {
      actions.push(`<button type="button" class="btn btn--accent btn--lg" data-action="log-activity" data-challenge-id="${escapeHTML(challenge.id)}">${icon('plus')} Log activity</button>`);
    }
    actions.push(`<a class="btn btn--lg btn--on-dark" href="#progress">${icon('target')} View progress</a>`);
    actions.push(`<button type="button" class="btn btn--lg btn--ghost-light" data-detail-action="leave">${icon('log-out')} Leave</button>`);
  } else if (enrollment && enrollment.status === 'completed') {
    actions.push(`<span class="hero-complete">${icon('check')} You completed this challenge on ${formatDate(enrollment.completedAt)}</span>`);
  } else if (joinable.ok) {
    actions.push(`<button type="button" class="btn btn--accent btn--lg" data-detail-action="join">${icon('plus')} Join challenge</button>`);
  } else {
    actions.push(`<span class="hero-note">${icon('lock')} ${escapeHTML(joinable.reason)}</span>`);
  }
  if (status === 'upcoming' && enrollment && enrollment.status === 'active') {
    actions.unshift(`<span class="hero-note">${icon('calendar')} Logging opens on ${formatDate(challenge.startDate)}</span>`);
  }
  return actions.join('');
}

function renderHero(state, challenge, enrollment) {
  const status = getChallengeStatus(challenge);
  const participants = getChallengeEnrollments(state, challenge.id).length;
  return `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <ol role="list">
        <li><a href="challenges.html">Challenges</a></li>
        <li><a href="challenge.html?id=${encodeURIComponent(challenge.id)}" aria-current="page">${escapeHTML(challenge.title)}</a></li>
      </ol>
    </nav>
    ${status === 'draft' ? `<p class="banner banner--warning">${icon('eye')} Draft preview — this challenge is not visible to participants yet.</p>` : ''}
    ${status === 'paused' ? `<p class="banner banner--warning">${icon('pause')} This challenge is paused by the organizer. New entries do not count until it resumes.</p>` : ''}
    ${status === 'archived' ? `<p class="banner">${icon('archive')} This challenge is archived. It is kept for reference and is closed to new participants.</p>` : ''}
    <section class="detail-hero" aria-labelledby="challenge-title">
      <img class="detail-hero__cover" src="${escapeHTML(challenge.image)}" alt="" width="800" height="480">
      <div class="detail-hero__content">
        <div class="cluster">${categoryPill(challenge.category)} ${statusBadge(status)} <span class="pill">${escapeHTML(challenge.difficulty || 'Beginner')}</span></div>
        <h1 id="challenge-title">${escapeHTML(challenge.title)}</h1>
        <p class="detail-hero__tagline">${escapeHTML(challenge.tagline || '')}</p>
        <ul class="detail-hero__meta" role="list">
          <li>${icon('calendar')} ${formatDate(challenge.startDate)} – ${formatDate(challenge.endDate)}</li>
          <li>${icon('clock')} ${challenge.durationDays} days · ${escapeHTML(getTimeRemaining(challenge).label)}</li>
          <li>${icon('users')} ${pluralize(participants, 'participant')}</li>
          <li>${icon('star')} ${formatNumber(challenge.rewardPoints)} bonus points</li>
        </ul>
        <div class="detail-hero__actions">${heroActions(state, challenge, enrollment)}</div>
      </div>
    </section>`;
}

function renderAbout(challenge) {
  const accepted = challenge.activityTypes
    .map((type) => `<li class="pill" data-category="${ACTIVITY_TYPES[type] ? ACTIVITY_TYPES[type].category : ''}">${icon(getActivityIcon(type))}${escapeHTML(ACTIVITY_TYPES[type] ? ACTIVITY_TYPES[type].label : type)}</li>`)
    .join('');
  const isDays = challenge.metric === 'days';
  return `
    <section class="panel detail-section" aria-labelledby="about-title">
      <h2 id="about-title" class="section-title">About this challenge</h2>
      <p>${escapeHTML(challenge.description)}</p>
      <div class="objective">
        <span class="objective__icon">${icon('target', 'icon--lg')}</span>
        <div>
          <h3>Objective</h3>
          <p>${escapeHTML(challenge.objective || challenge.description)}</p>
        </div>
      </div>
    </section>

    <section class="panel detail-section" aria-labelledby="targets-title">
      <h2 id="targets-title" class="section-title">Target metrics</h2>
      <dl class="metric-grid">
        <div><dt>Target</dt><dd>${escapeHTML(describeTarget(challenge))}</dd></div>
        <div><dt>Measured as</dt><dd>${isDays ? 'Qualifying days' : `Total ${UNIT_LABELS[challenge.targetUnit]}`}</dd></div>
        ${isDays ? `<div><dt>Daily minimum</dt><dd>${formatValue(challenge.dailyMinimum)} ${UNIT_LABELS[challenge.dailyUnit]}</dd></div>` : ''}
        <div><dt>Duration</dt><dd>${challenge.durationDays} days</dd></div>
        <div><dt>Completion reward</dt><dd>${formatNumber(challenge.rewardPoints)} points</dd></div>
      </dl>
      <h3 class="subheading">Accepted activities</h3>
      <ul class="cluster" role="list">${accepted}</ul>
    </section>

    <section class="panel detail-section" aria-labelledby="guidelines-title">
      <h2 id="guidelines-title" class="section-title">Guidelines</h2>
      <ol class="guideline-list" role="list">${challenge.guidelines.map((g) => `<li>${escapeHTML(g)}</li>`).join('')}</ol>
      <h3 class="subheading">Completion requirements</h3>
      <ul class="requirement-list" role="list">${(challenge.requirements || []).map((r) => `<li>${icon('check')}<span>${escapeHTML(r)}</span></li>`).join('')}</ul>
      <p class="small muted">Wellnest challenges are non-clinical. Listen to your body and choose an intensity that feels comfortable.</p>
    </section>`;
}

function renderCommunityActivity(state, challenge) {
  const visibleUserIds = new Set(state.users.filter((u) => u.id === state.currentUserId || (u.privacy && u.privacy.activityVisible !== false)).map((u) => u.id));
  const recent = state.activities
    .filter((a) => a.challengeId === challenge.id && visibleUserIds.has(a.userId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  return `
    <section class="panel detail-section" aria-labelledby="community-activity-title">
      <div class="panel__header">
        <div>
          <h2 id="community-activity-title" class="section-title">Recent community activity</h2>
          <p>Members who share their activity publicly</p>
        </div>
      </div>
      ${recent.length
        ? `<ol class="timeline" role="list">${recent.map((a) => activityItem(state, a, { showUser: true })).join('')}</ol>`
        : emptyState({ title: 'No public activity yet', text: 'Be the first to log progress for this challenge.', compact: true })}
    </section>`;
}

function renderProgressPanel(state, challenge, enrollment) {
  const userId = state.currentUserId;
  if (!enrollment || enrollment.status === 'left') {
    const joinable = canJoinChallenge(challenge);
    return `
      <section class="panel progress-panel" id="progress" aria-labelledby="progress-title">
        <h2 id="progress-title" class="panel-title-sm">Your progress</h2>
        <div class="progress-panel__empty">
          ${progressRing(0, { size: 120, label: '0%', sublabel: 'not joined' })}
          <p class="muted small">${joinable.ok ? 'Join this challenge to start tracking your progress and earn the completion bonus.' : escapeHTML(joinable.reason)}</p>
          ${joinable.ok ? `<button type="button" class="btn btn--primary btn--block" data-detail-action="join">${icon('plus')} Join challenge</button>` : ''}
          ${enrollment && enrollment.status === 'left' ? '<p class="small muted">You left this challenge earlier. Activities you logged are kept if you re-join.</p>' : ''}
        </div>
      </section>`;
  }

  const progress = getChallengeProgress(state, userId, challenge);
  const remaining = getTimeRemaining(challenge);
  const completed = enrollment.status === 'completed';
  return `
    <section class="panel progress-panel ${completed ? 'progress-panel--complete' : ''}" id="progress" aria-labelledby="progress-title" tabindex="-1">
      <div class="split">
        <h2 id="progress-title" class="panel-title-sm">Your progress</h2>
        ${completed ? '<span class="status" data-status="completed">Completed</span>' : '<span class="status" data-status="joined">Enrolled</span>'}
      </div>
      <div class="progress-panel__ring">
        ${progressRing(progress.percent, { size: 150, stroke: 12, sublabel: 'complete', category: challenge.category })}
      </div>
      ${progressBar(progress.current, progress.target, 'Challenge progress', { large: true })}
      <dl class="kv progress-panel__facts">
        <div><dt>Progress</dt><dd>${formatValue(progress.current)} / ${formatValue(progress.target)} ${escapeHTML(progress.unit)}</dd></div>
        <div><dt>Remaining</dt><dd>${completed ? 'Target reached' : `${formatValue(progress.remaining)} ${escapeHTML(progress.unit)}`}</dd></div>
        <div><dt>Time</dt><dd>${escapeHTML(remaining.label)}</dd></div>
        <div><dt>Activities counted</dt><dd>${formatNumber(progress.activityCount)}</dd></div>
        <div><dt>Enrolled since</dt><dd>${formatDate(enrollment.enrolledAt)}</dd></div>
      </dl>
      ${completed
        ? `<p class="celebrate">${icon('award')} Brilliant work! You earned ${formatNumber(challenge.rewardPoints)} bonus points.</p>`
        : isChallengeLoggable(challenge)
          ? `<button type="button" class="btn btn--primary btn--block" data-action="log-activity" data-challenge-id="${escapeHTML(challenge.id)}">${icon('plus')} Log activity</button>`
          : `<p class="small muted">${getChallengeStatus(challenge) === 'upcoming' ? `Logging opens on ${formatDate(challenge.startDate)}.` : 'Activities cannot be logged right now.'}</p>`}
    </section>`;
}

function renderStatsPanel(state, challenge) {
  const enrollments = getChallengeEnrollments(state, challenge.id);
  const completed = enrollments.filter((e) => e.status === 'completed').length;
  const activities = state.activities.filter((a) => a.challengeId === challenge.id);
  const averageProgress = enrollments.length
    ? Math.round(enrollments.reduce((sum, e) => sum + getChallengeProgress(state, e.userId, challenge).percent, 0) / enrollments.length)
    : 0;
  return `
    <section class="panel" aria-labelledby="participation-title">
      <h2 id="participation-title" class="panel-title-sm">Participation</h2>
      <dl class="mini-stats">
        <div><dt>Participants</dt><dd>${formatNumber(enrollments.length)}</dd></div>
        <div><dt>Completed</dt><dd>${formatNumber(completed)} <small>(${percent(completed, enrollments.length)}%)</small></dd></div>
        <div><dt>Activities</dt><dd>${formatNumber(activities.length)}</dd></div>
        <div><dt>Avg. progress</dt><dd>${averageProgress}%</dd></div>
      </dl>
    </section>`;
}

function renderLeaderboardPanel(state, challenge) {
  const rows = buildLeaderboard(state, { scope: 'challenge', challengeId: challenge.id }).slice(0, 5);
  return `
    <section class="panel" aria-labelledby="challenge-ranks-title">
      <div class="split">
        <h2 id="challenge-ranks-title" class="panel-title-sm">Top participants</h2>
        <a class="link-btn" href="leaderboard.html?challenge=${encodeURIComponent(challenge.id)}">Full ranking</a>
      </div>
      ${rows.length
        ? `<ol class="mini-ranking" role="list">${rows.map((row) => `
            <li class="${row.user.id === state.currentUserId ? 'is-current' : ''}">
              <span class="mini-ranking__rank">${row.rank}</span>
              ${personBlock(row.user, { size: 'sm', meta: `${row.progress.percent}% · ${formatValue(row.progress.current)} ${escapeHTML(row.progress.unit)}`, isCurrent: row.user.id === state.currentUserId })}
              ${movementBadge(row.movement)}
            </li>`).join('')}</ol>`
        : '<p class="small muted">No public rankings yet.</p>'}
    </section>`;
}

function renderParticipantsPanel(state, challenge) {
  const enrollments = getChallengeEnrollments(state, challenge.id);
  const people = enrollments
    .map((e) => state.users.find((u) => u.id === e.userId))
    .filter(Boolean);
  return `
    <section class="panel" aria-labelledby="participants-title">
      <div class="split">
        <h2 id="participants-title" class="panel-title-sm">Enrolled participants</h2>
        <span class="pill">${people.length}</span>
      </div>
      ${people.length
        ? `<ul class="participant-grid" role="list">${people.slice(0, 12).map((user) => {
          const hidden = user.id !== state.currentUserId && user.privacy.profileVisible === false;
          return `<li title="${escapeHTML(hidden ? 'Private member' : user.name)}">
              <img class="avatar" src="${escapeHTML(hidden ? 'static/assets/images/avatars/avatar-private.svg' : user.avatar)}" alt="" width="40" height="40" loading="lazy">
              <span>${escapeHTML(hidden ? 'Private' : user.name.split(' ')[0])}</span>
            </li>`;
        }).join('')}</ul>${people.length > 12 ? `<p class="small muted">and ${people.length - 12} more</p>` : ''}`
        : '<p class="small muted">No one has joined yet — be the first!</p>'}
    </section>`;
}

/* ---------------- Page ---------------- */

let challengeId = null;

function render() {
  const state = getState();
  const challenge = getChallenge(state, challengeId);
  if (!challenge) {
    renderNotFound(challengeId);
    return;
  }
  const enrollment = getEnrollment(state, state.currentUserId, challenge.id);
  document.title = `${challenge.title} · Wellnest`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', `${challenge.title}: ${challenge.tagline || challenge.description}`);

  root().innerHTML = `
    ${renderHero(state, challenge, enrollment)}
    <div class="detail-grid">
      <div class="detail-grid__main">
        ${renderAbout(challenge)}
        ${renderCommunityActivity(state, challenge)}
      </div>
      <aside class="detail-grid__aside" aria-label="Progress and participants">
        ${renderProgressPanel(state, challenge, enrollment)}
        ${renderStatsPanel(state, challenge)}
        ${renderLeaderboardPanel(state, challenge)}
        ${renderParticipantsPanel(state, challenge)}
      </aside>
    </div>`;
}

async function handleAction(event) {
  const button = event.target.closest('[data-detail-action]');
  if (!button) return;
  const state = getState();
  const challenge = getChallenge(state, challengeId);
  if (!challenge) return;

  if (button.dataset.detailAction === 'join') {
    const confirmed = await confirmDialog({
      title: `Join ${challenge.title}?`,
      message: `Target: ${describeTarget(challenge)} by ${formatDate(challenge.endDate)}. Complete it to earn ${formatNumber(challenge.rewardPoints)} bonus points.`,
      confirmText: 'Join challenge',
      iconName: 'flag',
    });
    if (!confirmed) return;
    const result = joinChallenge(challenge.id);
    showToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Challenge joined' : 'Could not join', message: result.message });
  }

  if (button.dataset.detailAction === 'leave') {
    const confirmed = await confirmDialog({
      title: `Leave ${challenge.title}?`,
      message: 'You will stop appearing in this challenge’s ranking. Activities you already logged are kept and will count again if you re-join.',
      confirmText: 'Leave challenge',
      tone: 'danger',
    });
    if (!confirmed) return;
    const result = leaveChallenge(challenge.id);
    showToast({ type: result.ok ? 'info' : 'error', title: result.ok ? 'You left the challenge' : 'Could not leave', message: result.message });
  }
}

async function init() {
  const state = await initApp('challenge-detail');
  if (!state) return;
  challengeId = (getQueryParam('id') || '').trim();
  render();
  onStateChange(render);
  root().addEventListener('click', handleAction);
  if (window.location.hash === '#progress') {
    const panel = document.getElementById('progress');
    if (panel) panel.scrollIntoView();
  }
}

init();
