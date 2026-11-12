/**
 * home.js — Landing page.
 * Static marketing copy lives in index.html; everything numeric (statistics,
 * featured challenges, category counts, leaderboard preview, hero cards) is
 * generated from the application data.
 */
import { initApp, getState, onStateChange } from '../app.js';
import { joinChallenge } from '../actions.js';
import {
  CATEGORIES, getChallengeStatus, getParticipants, getUserStats, getBadgeProgress, buildLeaderboard,
  getChallengeProgress, getChallenge,
} from '../engine.js';
import { challengeCard, emptyState } from '../components/templates.js';
import { progressRing } from '../components/charts.js';
import { showToast } from '../components/toast.js';
import { $, escapeHTML, icon, formatNumber, sumBy } from '../utils.js';

function renderHero(state) {
  const participants = getParticipants(state);
  $('[data-hero-members]').textContent = formatNumber(participants.length);
  $('[data-hero-avatars]').innerHTML = participants
    .slice(0, 5)
    .map((u) => `<img class="avatar avatar--sm" src="${escapeHTML(u.avatar)}" alt="" width="32" height="32">`)
    .join('') + `<span class="avatar-stack__more">+${Math.max(0, participants.length - 5)}</span>`;

  // Floating cards reflect the demo participant's real progress.
  const userId = state.currentUserId;
  const stats = getUserStats(state, userId);
  $('[data-hero-streak]').textContent = stats.currentStreak;

  const activeEnrollment = state.enrollments.find((e) => e.userId === userId && e.status === 'active' && getChallenge(state, e.challengeId) && getChallengeStatus(getChallenge(state, e.challengeId)) === 'active');
  if (activeEnrollment) {
    const challenge = getChallenge(state, activeEnrollment.challengeId);
    const progress = getChallengeProgress(state, userId, challenge);
    $('[data-hero-challenge]').textContent = challenge.title;
    $('[data-hero-ring]').innerHTML = progressRing(progress.percent, { size: 64, stroke: 7, className: 'ring--sm', sublabel: challenge.title });
  } else {
    $('[data-hero-ring]').innerHTML = progressRing(0, { size: 64, stroke: 7, className: 'ring--sm' });
  }

  const latestBadge = getBadgeProgress(state, userId)
    .map((item, index) => ({ ...item, index }))
    .filter((b) => b.unlocked)
    .sort((a, b) => (b.unlockedAt || '').localeCompare(a.unlockedAt || '') || b.index - a.index)[0];
  if (latestBadge) {
    $('[data-hero-badge]').textContent = latestBadge.badge.name;
    $('[data-hero-badge-img]').src = latestBadge.badge.icon;
  }
}

function renderStats(state) {
  const values = {
    challenges: state.challenges.filter((c) => getChallengeStatus(c) === 'active').length,
    participants: getParticipants(state).length,
    activities: state.activities.length,
    points: sumBy(getParticipants(state), (u) => getUserStats(state, u.id).totalPoints),
  };
  Object.entries(values).forEach(([key, value]) => {
    $(`[data-stat="${key}"]`).textContent = formatNumber(value);
  });
}

function renderFeatured(state) {
  const container = $('[data-featured-challenges]');
  const featured = state.challenges
    .filter((c) => c.featured && ['active', 'upcoming'].includes(getChallengeStatus(c)))
    .slice(0, 3);
  container.innerHTML = featured.length
    ? featured.map((c, i) => challengeCard(state, c, state.currentUserId, { index: i })).join('')
    : emptyState({ title: 'No featured challenges right now', text: 'Check back soon or browse every challenge.', action: '<a class="btn btn--primary" href="challenges.html">Browse challenges</a>' });
}

function renderCategories(state) {
  $('[data-categories]').innerHTML = Object.entries(CATEGORIES)
    .map(([key, category]) => {
      const count = state.challenges.filter((c) => c.category === key && ['active', 'upcoming'].includes(getChallengeStatus(c))).length;
      return `
        <li>
          <a class="category-tile" data-category="${key}" href="challenges.html?category=${key}">
            <span class="category-tile__icon">${icon(category.icon, 'icon--lg')}</span>
            <h3>${escapeHTML(category.label)}</h3>
            <p>${escapeHTML(category.description)}</p>
            <span class="category-tile__count">${count} open ${count === 1 ? 'challenge' : 'challenges'} ${icon('arrow-right')}</span>
          </a>
        </li>`;
    })
    .join('');
}

function renderCommunity(state) {
  $('[data-badge-showcase]').innerHTML = state.badges
    .slice(0, 6)
    .map((b) => `<figure class="badge-showcase__item"><img src="${escapeHTML(b.icon)}" alt="" width="56" height="56" loading="lazy"><figcaption>${escapeHTML(b.name)}</figcaption></figure>`)
    .join('');

  const rows = buildLeaderboard(state, { scope: 'weekly' }).slice(0, 5);
  $('[data-leader-preview]').innerHTML = rows.length
    ? rows
      .map((row) => `
        <li class="leader-preview__row">
          <span class="leader-preview__rank">${row.rank}</span>
          <img class="avatar avatar--sm" src="${escapeHTML(row.user.avatar)}" alt="" width="32" height="32">
          <span class="leader-preview__name">${escapeHTML(row.user.name)}</span>
          <span class="leader-preview__points">${formatNumber(row.score)} pts</span>
        </li>`)
      .join('')
    : '<li class="muted">No activity logged this week yet.</li>';
}

function render() {
  const state = getState();
  renderHero(state);
  renderStats(state);
  renderFeatured(state);
  renderCategories(state);
  renderCommunity(state);
}

async function init() {
  const state = await initApp('home');
  if (!state) return;
  render();
  onStateChange(render);

  // Join buttons on featured cards (event delegation).
  $('[data-featured-challenges]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="join"]');
    if (!button) return;
    const result = joinChallenge(button.dataset.challengeId);
    showToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Challenge joined' : 'Could not join', message: result.message });
  });
}

init();
