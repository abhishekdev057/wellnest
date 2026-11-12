/**
 * profile.js — Participant profile with editable details (saved to LocalStorage),
 * statistics, participation history, achievements and activity history.
 */
import { initApp, getState, getCurrentUser, onStateChange } from '../app.js';
import { updateProfile, validateProfileInput } from '../actions.js';
import {
  ACTIVITY_TYPES, STATUS_LABELS, getUserStats, getUserActivities, getBadgeProgress, getChallenge,
  getChallengeProgress, getChallengeStatus, getCategoryDistribution, describeAmount, daysAgoKey,
} from '../engine.js';
import { donutChart, progressBar } from '../components/charts.js';
import { badgeTile, statTile, emptyState, categoryPill, challengeUrl } from '../components/templates.js';
import { openModal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import {
  $, escapeHTML, icon, formatNumber, formatDate, formatTime, formatValue, pluralize, percent, debounce,
  fieldError, describedBy, setFieldErrors, readForm, groupBy,
} from '../utils.js';

const PAGE_SIZE = 12;
const historyView = { type: 'all', range: 'all', q: '', limit: PAGE_SIZE };
const view = (name) => $(`[data-profile="${name}"]`);

/* ---------------- Sections ---------------- */

function renderHero(user, stats) {
  view('hero').innerHTML = `
    <div class="profile-hero__cover" aria-hidden="true"></div>
    <div class="profile-hero__body">
      <img class="avatar avatar--xl profile-hero__avatar" src="${escapeHTML(user.avatar)}" alt="${escapeHTML(user.name)}" width="112" height="112">
      <div class="profile-hero__text">
        <h1 id="profile-name">${escapeHTML(user.name)}</h1>
        <p class="profile-hero__headline">${escapeHTML(user.headline || 'Wellnest member')}</p>
        <ul class="profile-hero__meta" role="list">
          ${user.location ? `<li>${icon('compass')} ${escapeHTML(user.location)}</li>` : ''}
          ${user.team ? `<li>${icon('users')} ${escapeHTML(user.team)}</li>` : ''}
          <li>${icon('calendar')} Member since ${formatDate(user.joinDate)}</li>
          <li>${icon('flame')} ${pluralize(stats.currentStreak, 'day')} streak</li>
        </ul>
      </div>
      <div class="profile-hero__actions">
        <button type="button" class="btn btn--primary" data-edit-profile>${icon('edit')} Edit profile</button>
        <a class="btn" href="settings.html#privacy">${icon('shield')} Privacy</a>
      </div>
    </div>
    ${user.bio ? `<p class="profile-hero__bio">${escapeHTML(user.bio)}</p>` : '<p class="profile-hero__bio muted">Add a short bio so teammates know what motivates you.</p>'}
    ${user.privacy.profileVisible === false ? `<p class="banner banner--info">${icon('eye-off')} Your profile is private. Other members see you as “Private member”.</p>` : ''}`;
}

function renderStats(stats, badgeCount) {
  view('stats').innerHTML = [
    statTile({ iconName: 'star', label: 'Total points', value: formatNumber(stats.totalPoints), meta: `${formatNumber(stats.rewardPoints)} from challenge bonuses`, feature: true }),
    statTile({ iconName: 'flag', label: 'Active challenges', value: formatNumber(stats.activeChallenges), meta: `${pluralize(stats.joinedChallenges, 'challenge')} joined overall` }),
    statTile({ iconName: 'check', label: 'Completed challenges', value: formatNumber(stats.completedChallenges), meta: stats.completedChallenges ? 'Bonus points earned' : 'Your first finish awaits' }),
    statTile({ iconName: 'award', label: 'Achievements', value: formatNumber(badgeCount.unlocked), meta: `of ${badgeCount.total} badges unlocked` }),
  ].join('');
}

function renderPersonal(state, user, stats) {
  const activities = getUserActivities(state, user.id);
  if (!activities.length) {
    view('personal').innerHTML = emptyState({ title: 'No statistics yet', text: 'Log an activity to start building your personal statistics.', compact: true });
    return;
  }
  const byType = groupBy(activities, (a) => a.type);
  const favourite = Object.entries(byType).sort((a, b) => b[1].length - a[1].length)[0];
  const averagePoints = Math.round(stats.activityPoints / activities.length);
  const first = activities[activities.length - 1];

  view('personal').innerHTML = `
    <div class="personal-stats">
      <dl class="mini-stats mini-stats--grid">
        <div><dt>Activities logged</dt><dd>${formatNumber(stats.totalActivities)}</dd></div>
        <div><dt>Active days</dt><dd>${formatNumber(stats.activeDays)}</dd></div>
        <div><dt>Longest streak</dt><dd>${pluralize(stats.longestStreak, 'day')}</dd></div>
        <div><dt>Minutes of activity</dt><dd>${formatNumber(stats.totalMinutes)}</dd></div>
        <div><dt>Favourite activity</dt><dd>${escapeHTML(ACTIVITY_TYPES[favourite[0]] ? ACTIVITY_TYPES[favourite[0]].label : favourite[0])}</dd></div>
        <div><dt>Average points</dt><dd>${formatNumber(averagePoints)} <small>per activity</small></dd></div>
        <div><dt>First activity</dt><dd>${formatDate(first.date)}</dd></div>
        <div><dt>Points this week</dt><dd>${formatNumber(stats.weekPoints)}</dd></div>
      </dl>
      <div class="personal-stats__chart">
        <h3 class="subheading">Activities by category</h3>
        ${donutChart(getCategoryDistribution(activities), { title: 'Activities by category', centerLabel: 'activities' })}
      </div>
    </div>`;
}

function renderParticipation(state, userId) {
  const enrollments = state.enrollments
    .filter((e) => e.userId === userId)
    .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  if (!enrollments.length) {
    view('participation').innerHTML = emptyState({ title: 'No challenges yet', text: 'Join a challenge to see it here.', action: '<a class="btn btn--primary" href="challenges.html">Browse challenges</a>', compact: true });
    return;
  }
  const statusText = { active: 'In progress', completed: 'Completed', left: 'Left' };
  view('participation').innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <caption class="visually-hidden">Challenges you have participated in</caption>
        <thead><tr><th scope="col">Challenge</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col">Progress</th><th scope="col" class="num">Reward</th></tr></thead>
        <tbody>
          ${enrollments.map((e) => {
            const challenge = getChallenge(state, e.challengeId);
            if (!challenge) return '';
            const progress = getChallengeProgress(state, userId, challenge);
            const challengeStatus = getChallengeStatus(challenge);
            return `
              <tr>
                <th scope="row">
                  <a class="table-link" href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a>
                  <div class="small muted">${categoryPill(challenge.category)} <span>${STATUS_LABELS[challengeStatus]}</span></div>
                </th>
                <td><span class="status" data-status="${e.status === 'active' ? 'joined' : e.status}">${statusText[e.status]}</span></td>
                <td>${formatDate(e.enrolledAt)}</td>
                <td class="table-progress">${progressBar(progress.current, progress.target, `${challenge.title} progress`)}<span class="small muted">${progress.percent}% · ${formatValue(progress.current)}/${formatValue(progress.target)} ${escapeHTML(progress.unit)}</span></td>
                <td class="num">${e.status === 'completed' ? `<strong>+${formatNumber(challenge.rewardPoints)}</strong>` : `<span class="muted">${formatNumber(challenge.rewardPoints)}</span>`}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderHistory(state, userId) {
  const all = getUserActivities(state, userId);
  const since = historyView.range === 'all' ? null : daysAgoKey(Number(historyView.range) - 1);
  const query = historyView.q.trim().toLowerCase();
  const filtered = all
    .filter((a) => historyView.type === 'all' || a.type === historyView.type)
    .filter((a) => !since || a.date.slice(0, 10) >= since)
    .filter((a) => !query || (a.description || '').toLowerCase().includes(query));
  const visible = filtered.slice(0, historyView.limit);

  $('[data-history-count]').textContent = `${pluralize(filtered.length, 'activity', 'activities')} · ${formatNumber(filtered.reduce((s, a) => s + a.points, 0))} points`;

  if (!filtered.length) {
    view('history').innerHTML = emptyState({ title: 'No matching activities', text: 'Try another filter or log something new.', compact: true });
    return;
  }
  view('history').innerHTML = `
    <div class="table-wrap">
      <table class="data-table history-table">
        <caption class="visually-hidden">Activity history</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Amount</th><th scope="col">Challenge</th><th scope="col" class="num">Points</th></tr></thead>
        <tbody>
          ${visible.map((a) => {
            const challenge = a.challengeId ? getChallenge(state, a.challengeId) : null;
            const type = ACTIVITY_TYPES[a.type];
            return `
              <tr>
                <td><time datetime="${escapeHTML(a.date)}">${formatDate(a.date)}</time><div class="small muted">${formatTime(a.date)}</div></td>
                <th scope="row">
                  <span class="cluster history-activity"><span class="activity-icon activity-icon--sm" data-category="${type ? type.category : ''}">${icon(type ? type.icon : 'activity')}</span>
                  <span>${escapeHTML(type ? type.label : a.type)}${a.description ? `<span class="small muted history-note">${escapeHTML(a.description)}</span>` : ''}</span></span>
                </th>
                <td>${escapeHTML(describeAmount(a.value, a.unit))}</td>
                <td>${challenge ? `<a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a>` : '<span class="muted">—</span>'}</td>
                <td class="num"><span class="points-tag" data-zero="${a.points === 0}">+${formatNumber(a.points)}</span></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${filtered.length > visible.length
      ? `<div class="load-more"><button type="button" class="btn" data-load-more>Show more <span class="muted">(${filtered.length - visible.length} remaining)</span></button></div>`
      : ''}`;
}

function renderGoals(user, stats) {
  const goals = user.weeklyGoals;
  view('goals').innerHTML = `
    <ul class="goal-list" role="list">
      <li>
        <div class="split"><span>${icon('calendar')} Active days</span><strong>${stats.weekActiveDays} / ${goals.activeDays}</strong></div>
        ${progressBar(stats.weekActiveDays, goals.activeDays, 'Active days goal')}
      </li>
      <li>
        <div class="split"><span>${icon('star')} Points</span><strong>${formatNumber(stats.weekPoints)} / ${formatNumber(goals.points)}</strong></div>
        ${progressBar(stats.weekPoints, goals.points, 'Weekly points goal')}
      </li>
    </ul>
    <p class="small muted">${percent(stats.weekPoints, goals.points) >= 100 ? 'Weekly points goal reached — amazing!' : `${formatNumber(Math.max(0, goals.points - stats.weekPoints))} points to reach your weekly goal.`}</p>`;
}

function renderBadges(state, userId) {
  const progress = getBadgeProgress(state, userId).sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.percent - a.percent);
  const unlocked = progress.filter((p) => p.unlocked).length;
  $('[data-badge-summary]').textContent = `${unlocked} of ${progress.length} unlocked`;
  view('badges').innerHTML = progress.map(badgeTile).join('');
  return { unlocked, total: progress.length };
}

function renderTypeFilter(state, userId) {
  const select = $('#history-type');
  const used = new Set(getUserActivities(state, userId).map((a) => a.type));
  select.innerHTML = `<option value="all">All activities</option>${Object.entries(ACTIVITY_TYPES)
    .filter(([key]) => used.has(key))
    .map(([key, t]) => `<option value="${key}">${escapeHTML(t.label)}</option>`)
    .join('')}`;
  select.value = used.has(historyView.type) ? historyView.type : 'all';
  historyView.type = select.value;
}

function render() {
  const state = getState();
  const user = getCurrentUser();
  const stats = getUserStats(state, user.id);
  renderHero(user, stats);
  const badgeCount = renderBadges(state, user.id);
  renderStats(stats, badgeCount);
  renderPersonal(state, user, stats);
  renderParticipation(state, user.id);
  renderTypeFilter(state, user.id);
  renderHistory(state, user.id);
  renderGoals(user, stats);
}

/* ---------------- Edit profile ---------------- */

const FORM_ID = 'profile-form';
const AVATARS = Array.from({ length: 16 }, (_, i) => `static/assets/images/avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

function openEditProfile() {
  const user = getCurrentUser();
  const avatarOptions = AVATARS.map((src, i) => `
    <label class="option-card option-card--avatar">
      <input type="radio" name="avatar" value="${src}" ${src === user.avatar ? 'checked' : ''} aria-label="Avatar ${i + 1}" aria-describedby="${describedBy(FORM_ID, 'avatar')}">
      <span class="option-card__body"><img src="${src}" alt="" width="56" height="56" loading="lazy"></span>
    </label>`).join('');

  const modal = openModal({
    title: 'Edit profile',
    description: 'Changes are saved in this browser and appear across Wellnest immediately.',
    size: 'lg',
    content: `
      <form id="${FORM_ID}" class="form" novalidate>
        <p class="form-alert" data-form-alert role="alert" hidden></p>
        <fieldset>
          <legend>Avatar</legend>
          <div class="option-grid option-grid--avatars">${avatarOptions}</div>
          ${fieldError(FORM_ID, 'avatar')}
        </fieldset>
        <fieldset>
          <legend>About you</legend>
          <div class="form-grid">
            <div class="field">
              <label for="${FORM_ID}-name" class="required">Full name</label>
              <input class="input" id="${FORM_ID}-name" name="name" value="${escapeHTML(user.name)}" required minlength="2" maxlength="50" autocomplete="name" pattern="[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F .'\\-]{1,49}" aria-describedby="${describedBy(FORM_ID, 'name')}">
              ${fieldError(FORM_ID, 'name')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-email" class="required">Email</label>
              <input class="input" type="email" id="${FORM_ID}-email" name="email" value="${escapeHTML(user.email)}" required autocomplete="email" aria-describedby="${describedBy(FORM_ID, 'email')}">
              ${fieldError(FORM_ID, 'email')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-headline">Headline</label>
              <input class="input" id="${FORM_ID}-headline" name="headline" value="${escapeHTML(user.headline || '')}" maxlength="70" placeholder="e.g. Designer · Sunrise walker" aria-describedby="${describedBy(FORM_ID, 'headline')}">
              ${fieldError(FORM_ID, 'headline')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-location">Location</label>
              <input class="input" id="${FORM_ID}-location" name="location" value="${escapeHTML(user.location || '')}" maxlength="40" autocomplete="address-level2" aria-describedby="${describedBy(FORM_ID, 'location')}">
              ${fieldError(FORM_ID, 'location')}
            </div>
            <div class="field field--full">
              <label for="${FORM_ID}-bio">Short biography</label>
              <textarea class="textarea" id="${FORM_ID}-bio" name="bio" maxlength="280" rows="3" aria-describedby="${describedBy(FORM_ID, 'bio', true)}">${escapeHTML(user.bio || '')}</textarea>
              <p class="hint" id="${FORM_ID}-bio-hint"><span data-bio-count>${(user.bio || '').length}</span>/280 characters</p>
              ${fieldError(FORM_ID, 'bio')}
            </div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Weekly goals</legend>
          <div class="form-grid">
            <div class="field">
              <label for="${FORM_ID}-days" class="required">Active days per week</label>
              <input class="input" type="number" id="${FORM_ID}-days" name="activeDays" value="${user.weeklyGoals.activeDays}" min="1" max="7" step="1" required aria-describedby="${describedBy(FORM_ID, 'activeDays')}">
              ${fieldError(FORM_ID, 'activeDays')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-points" class="required">Points per week</label>
              <input class="input" type="number" id="${FORM_ID}-points" name="weeklyPoints" value="${user.weeklyGoals.points}" min="50" max="3000" step="10" required aria-describedby="${describedBy(FORM_ID, 'weeklyPoints')}">
              ${fieldError(FORM_ID, 'weeklyPoints')}
            </div>
          </div>
        </fieldset>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn--primary">${icon('check')} Save profile</button>
        </div>
      </form>`,
  });

  const form = modal.body.querySelector('form');
  form.elements.bio.addEventListener('input', (event) => {
    form.querySelector('[data-bio-count]').textContent = event.target.value.length;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readForm(form);
    const errors = validateProfileInput(input);
    if (Object.keys(errors).length) {
      const first = setFieldErrors(form, errors);
      if (first) first.focus();
      return;
    }
    const result = updateProfile(input);
    if (!result.ok) {
      setFieldErrors(form, { ...result.errors, form: result.message });
      return;
    }
    modal.close();
    showToast({ type: 'success', title: 'Profile saved', message: 'Your changes are stored in this browser.' });
  });
}

/* ---------------- Init ---------------- */

async function init() {
  const state = await initApp('profile');
  if (!state) return;
  render();
  onStateChange(render);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-profile]')) openEditProfile();
    if (event.target.closest('[data-load-more]')) {
      historyView.limit += PAGE_SIZE;
      renderHistory(getState(), getState().currentUserId);
    }
  });

  const filters = $('[data-history-filters]');
  filters.addEventListener('submit', (event) => event.preventDefault());
  filters.addEventListener('change', (event) => {
    if (event.target.name === 'type' || event.target.name === 'range') {
      historyView[event.target.name] = event.target.value;
      historyView.limit = PAGE_SIZE;
      renderHistory(getState(), getState().currentUserId);
    }
  });
  filters.elements.q.addEventListener('input', debounce((event) => {
    historyView.q = event.target.value;
    historyView.limit = PAGE_SIZE;
    renderHistory(getState(), getState().currentUserId);
  }, 200));

  // Jump to a section when arriving with a hash such as #history.
  if (window.location.hash) {
    const target = document.querySelector(window.location.hash);
    if (target) target.scrollIntoView();
  }
}

init();
