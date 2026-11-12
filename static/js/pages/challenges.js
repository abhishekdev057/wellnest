/**
 * challenges.js — Challenge discovery: featured spotlight, search,
 * category & status filters and sorting. Filter choices are kept in
 * SessionStorage so they survive navigating to a challenge and back.
 */
import { initApp, getState, onStateChange } from '../app.js';
import { joinChallenge } from '../actions.js';
import {
  CATEGORIES, ACTIVITY_TYPES, getChallengeStatus, getParticipantCount, isEnrolled, getChallengeEnrollments,
  getTimeRemaining, describeTarget,
} from '../engine.js';
import { challengeCard, emptyState, categoryPill, challengeAction, challengeUrl, coverImage } from '../components/templates.js';
import { showToast } from '../components/toast.js';
import { sessionGet, sessionSet } from '../storage.js';
import { $, $$, escapeHTML, icon, formatNumber, debounce, getQueryParam, announce, sumBy } from '../utils.js';

const DEFAULT_FILTERS = { q: '', category: 'all', status: 'all', sort: 'popularity' };
let filters = { ...DEFAULT_FILTERS };

/** Public challenges = everything except drafts. */
const getPublicChallenges = (state) => state.challenges.filter((c) => c.status !== 'draft');

/* ---------------- Filtering & sorting ---------------- */

function matchesSearch(challenge, query) {
  if (!query) return true;
  const haystack = [
    challenge.title,
    challenge.tagline,
    challenge.description,
    CATEGORIES[challenge.category] ? CATEGORIES[challenge.category].label : '',
    ...challenge.activityTypes.map((t) => (ACTIVITY_TYPES[t] ? ACTIVITY_TYPES[t].label : t)),
  ].join(' ').toLowerCase();
  // Every word in the query must appear somewhere.
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

function matchesStatus(state, challenge, status) {
  if (status === 'all') return true;
  if (status === 'joined') return isEnrolled(state, state.currentUserId, challenge.id);
  return getChallengeStatus(challenge) === status;
}

const SORTERS = {
  popularity: (state) => (a, b) => getParticipantCount(state, b.id) - getParticipantCount(state, a.id),
  points: () => (a, b) => b.rewardPoints - a.rewardPoints,
  duration: () => (a, b) => a.durationDays - b.durationDays,
  ending: () => (a, b) => a.endDate.localeCompare(b.endDate),
  newest: () => (a, b) => b.startDate.localeCompare(a.startDate),
};

/** Status order keeps open challenges ahead of ended / archived ones. */
const STATUS_ORDER = { active: 0, upcoming: 1, paused: 2, completed: 3, archived: 4 };

function getFilteredChallenges(state) {
  const sorter = (SORTERS[filters.sort] || SORTERS.popularity)(state);
  return getPublicChallenges(state)
    .filter((c) => filters.category === 'all' || c.category === filters.category)
    .filter((c) => matchesStatus(state, c, filters.status))
    .filter((c) => matchesSearch(c, filters.q.trim()))
    .sort((a, b) => STATUS_ORDER[getChallengeStatus(a)] - STATUS_ORDER[getChallengeStatus(b)] || sorter(a, b));
}

/* ---------------- Rendering ---------------- */

function renderIntro(state) {
  const open = getPublicChallenges(state).filter((c) => ['active', 'upcoming'].includes(getChallengeStatus(c)));
  $('[data-intro-stat="open"]').textContent = open.length;
  $('[data-intro-stat="joined"]').textContent = getPublicChallenges(state).filter((c) => isEnrolled(state, state.currentUserId, c.id)).length;
  $('[data-intro-stat="points"]').textContent = formatNumber(sumBy(open, (c) => c.rewardPoints));
}

function renderSpotlight(state) {
  const container = $('[data-spotlight]');
  const candidates = getPublicChallenges(state)
    .filter((c) => c.featured && getChallengeStatus(c) === 'active')
    .sort((a, b) => getParticipantCount(state, b.id) - getParticipantCount(state, a.id));
  const challenge = candidates[0];
  if (!challenge) {
    container.innerHTML = '';
    return;
  }
  const enrollments = getChallengeEnrollments(state, challenge.id);
  const avatars = enrollments
    .slice(0, 5)
    .map((e) => state.users.find((u) => u.id === e.userId))
    .filter(Boolean)
    .map((u) => `<img class="avatar avatar--sm" src="${escapeHTML(u.privacy.profileVisible ? u.avatar : 'static/assets/images/avatars/avatar-private.svg')}" alt="" width="32" height="32">`)
    .join('');

  container.innerHTML = `
    <article class="spotlight">
      <div class="spotlight__media">
        ${coverImage(challenge.image, { sizes: '(max-width: 900px) 92vw, 660px', eager: true })}
        <span class="spotlight__flag">${icon('star')} Featured challenge</span>
      </div>
      <div class="spotlight__body">
        <div class="cluster">${categoryPill(challenge.category)}<span class="small muted">${icon('clock')} ${escapeHTML(getTimeRemaining(challenge).label)}</span></div>
        <h3 class="spotlight__title"><a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a></h3>
        <p class="spotlight__tagline">${escapeHTML(challenge.tagline || '')}</p>
        <p class="muted">${escapeHTML(challenge.description)}</p>
        <dl class="spotlight__facts">
          <div><dt>Target</dt><dd>${escapeHTML(describeTarget(challenge))}</dd></div>
          <div><dt>Duration</dt><dd>${challenge.durationDays} days</dd></div>
          <div><dt>Reward</dt><dd>${formatNumber(challenge.rewardPoints)} pts</dd></div>
        </dl>
        <div class="spotlight__footer">
          <div class="cluster">
            <div class="avatar-stack">${avatars}${enrollments.length > 5 ? `<span class="avatar-stack__more">+${enrollments.length - 5}</span>` : ''}</div>
            <span class="small muted">${formatNumber(enrollments.length)} participants</span>
          </div>
          <div class="cluster">
            <a class="btn" href="${challengeUrl(challenge.id)}">View details</a>
            ${challengeAction(state, challenge, state.currentUserId, { size: 'md' })}
          </div>
        </div>
      </div>
    </article>`;
}

function renderCategoryChips(state) {
  const counts = getPublicChallenges(state).reduce((acc, c) => ({ ...acc, [c.category]: (acc[c.category] || 0) + 1 }), {});
  const chips = [{ key: 'all', label: 'All categories', count: getPublicChallenges(state).length }, ...Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label, count: counts[key] || 0 }))];
  $('[data-category-chips]').innerHTML = chips
    .map((chip) => `
      <button type="button" class="chip" data-category-filter="${chip.key}" ${chip.key !== 'all' ? `data-category="${chip.key}"` : ''} aria-pressed="${filters.category === chip.key}">
        ${chip.key !== 'all' ? '<span class="chip__dot" aria-hidden="true"></span>' : ''}${escapeHTML(chip.label)} <span class="muted">${chip.count}</span>
      </button>`)
    .join('');
}

function renderGrid(state) {
  const results = getFilteredChallenges(state);
  const grid = $('[data-challenge-grid]');
  const countText = `${results.length} ${results.length === 1 ? 'challenge' : 'challenges'}${filters.q ? ` matching “${filters.q.trim()}”` : ''}`;
  $('[data-results-count]').textContent = `Showing ${countText}`;

  if (!results.length) {
    grid.innerHTML = emptyState({
      title: 'No challenges found',
      text: filters.q ? `Nothing matches “${filters.q.trim()}” with the current filters. Try a different word or clear the filters.` : 'No challenges match these filters yet.',
      action: '<button type="button" class="btn btn--primary" data-clear-filters>Clear filters</button>',
    });
    return;
  }
  grid.innerHTML = results.map((c, i) => challengeCard(state, c, state.currentUserId, { index: i })).join('');
}

function syncFormWithFilters() {
  const form = $('[data-filters]');
  form.elements.q.value = filters.q;
  form.elements.status.value = filters.status;
  form.elements.sort.value = filters.sort;
}

function saveFilters() {
  sessionSet('challenge_filters', filters);
}

function render() {
  const state = getState();
  renderIntro(state);
  renderSpotlight(state);
  renderCategoryChips(state);
  renderGrid(state);
}

/* ---------------- Events ---------------- */

function handleJoin(event) {
  const button = event.target.closest('[data-action="join"]');
  if (!button) return;
  const result = joinChallenge(button.dataset.challengeId);
  showToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Challenge joined' : 'Could not join challenge', message: result.message });
}

async function init() {
  const state = await initApp('challenges');
  if (!state) return;

  // Restore filters from this session, then let a ?category= link override.
  filters = { ...DEFAULT_FILTERS, ...sessionGet('challenge_filters', {}) };
  const categoryParam = getQueryParam('category');
  if (categoryParam && CATEGORIES[categoryParam]) filters = { ...filters, category: categoryParam, status: 'all', q: '' };
  if (!SORTERS[filters.sort]) filters.sort = DEFAULT_FILTERS.sort;

  syncFormWithFilters();
  render();
  onStateChange(render);

  const form = $('[data-filters]');
  form.addEventListener('submit', (event) => event.preventDefault());
  form.elements.q.addEventListener('input', debounce((event) => {
    filters.q = event.target.value;
    saveFilters();
    renderGrid(getState());
  }, 200));
  form.addEventListener('change', (event) => {
    if (event.target.name === 'status' || event.target.name === 'sort') {
      filters[event.target.name] = event.target.value;
      saveFilters();
      renderGrid(getState());
      announce($('[data-results-count]').textContent);
    }
  });

  $('[data-category-chips]').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-category-filter]');
    if (!chip) return;
    filters.category = chip.dataset.categoryFilter;
    saveFilters();
    $$('[data-category-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    renderGrid(getState());
  });

  $('[data-challenge-grid]').addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-filters]')) {
      filters = { ...DEFAULT_FILTERS };
      saveFilters();
      syncFormWithFilters();
      render();
      return;
    }
    handleJoin(event);
  });
  $('[data-spotlight]').addEventListener('click', handleJoin);
}

init();
