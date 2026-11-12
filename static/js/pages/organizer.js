/**
 * organizer.js — Organizer workspace (simulated role).
 *   Overview     : key numbers, participation trend, items needing attention
 *   Challenges   : create / edit / activate / pause / archive / delete drafts
 *   Participants : searchable table + detailed inspection dialog
 *   Analytics    : SVG/CSS charts built from real application data
 */
import { initApp, getState, onStateChange } from '../app.js';
import { saveChallenge, setChallengeStatus, deleteChallenge, validateChallengeInput } from '../actions.js';
import {
  ACTIVITY_TYPES, CATEGORIES, UNIT_LABELS, STATUS_LABELS,
  getParticipants, getUser, getUserStats, getUserActivities, getChallenge, getChallengeStatus, getChallengeEnrollments,
  getChallengeProgress, getTimeRemaining, getCategoryDistribution, getBadgeProgress, describeTarget, daysAgoKey,
} from '../engine.js';
import { lineChart, barChart, donutChart, horizontalBars, progressBar } from '../components/charts.js';
import { statTile, emptyState, categoryPill, statusBadge, activityItem, challengeUrl, trend, coverImage } from '../components/templates.js';
import { openModal, confirmDialog } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { sessionGet, sessionSet } from '../storage.js';
import {
  $, $$, escapeHTML, icon, formatNumber, formatValue, formatDate, formatShortDate, formatWeekday, percent, pluralize,
  toDateKey, addDays, startOfToday, debounce, fieldError, describedBy, setFieldErrors, readForm, announce, formatRelativeDay,
} from '../utils.js';

const TABS = ['overview', 'challenges', 'participants', 'analytics'];
const COVERS = [
  ['movement', 'Rolling hills'], ['steps', 'Footsteps'], ['hydration', 'Water drop'], ['mindfulness', 'Lotus dusk'],
  ['stretch', 'Stretch arcs'], ['screen-free', 'Quiet night'], ['running', 'Running track'], ['healthy-plate', 'Healthy plate'],
  ['journal', 'Journal'], ['cycling', 'Cycling'], ['sunrise', 'Sunrise path'], ['winter', 'Winter pines'],
];
const view = { tab: 'overview', challengeQuery: '', challengeStatus: 'all', participantQuery: '', engagement: 'all' };
const panel = (name) => $(`[data-org="${name}"]`);

/* =====================================================================
   Overview
   ===================================================================== */

function renderOverview(state) {
  const participants = getParticipants(state);
  const statuses = state.challenges.map((c) => getChallengeStatus(c));
  const count = (status) => statuses.filter((s) => s === status).length;
  const enrolledActive = participants.filter((u) => state.enrollments.some((e) => e.userId === u.id && e.status === 'active')).length;
  const weekActivities = state.activities.filter((a) => a.date.slice(0, 10) >= daysAgoKey(6)).length;
  const prevWeekActivities = state.activities.filter((a) => a.date.slice(0, 10) >= daysAgoKey(13) && a.date.slice(0, 10) <= daysAgoKey(7)).length;
  const completions = state.enrollments.filter((e) => e.status === 'completed').length;

  panel('stats').innerHTML = [
    statTile({ iconName: 'users', label: 'Total participants', value: formatNumber(participants.length), meta: `${enrolledActive} currently enrolled`, feature: true }),
    statTile({ iconName: 'flag', label: 'Active challenges', value: formatNumber(count('active')), meta: `${count('upcoming')} upcoming · ${count('draft')} draft · ${count('paused')} paused` }),
    statTile({ iconName: 'check', label: 'Completed challenges', value: formatNumber(count('completed') + count('archived')), meta: `${pluralize(completions, 'participant completion')}` }),
    statTile({ iconName: 'activity', label: 'Activities logged', value: formatNumber(state.activities.length), meta: `${formatNumber(weekActivities)} this week · ${trend(weekActivities, prevWeekActivities)}` }),
  ].join('');

  // 30-day trend
  const today = startOfToday();
  const series = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const key = toDateKey(date);
    series.push({ label: formatShortDate(date), value: state.activities.filter((a) => a.date.slice(0, 10) === key).length });
  }
  const total = series.reduce((sum, d) => sum + d.value, 0);
  panel('trend-total').textContent = `${formatNumber(total)} activities`;
  panel('trend').innerHTML = total
    ? lineChart(series, { title: 'Activities logged per day over the last 30 days', labelEvery: 5, height: 230, width: 1100 })
    : emptyState({ title: 'No activity yet', text: 'The trend appears once participants log activities.', compact: true });

  // Needs attention
  const items = [];
  state.challenges.forEach((c) => {
    const status = getChallengeStatus(c);
    if (status === 'draft') items.push({ c, iconName: 'edit', text: 'Draft awaiting publication', actions: `<button type="button" class="btn btn--sm" data-org-action="edit" data-id="${c.id}">Edit</button><button type="button" class="btn btn--sm btn--primary" data-org-action="activate" data-id="${c.id}">Publish</button>` });
    if (status === 'paused') items.push({ c, iconName: 'pause', text: 'Paused — participants cannot make progress', actions: `<button type="button" class="btn btn--sm btn--primary" data-org-action="activate" data-id="${c.id}">Resume</button>` });
    if (status === 'active' && getTimeRemaining(c).days <= 3) items.push({ c, iconName: 'clock', text: `Ending soon · ${getTimeRemaining(c).label}`, actions: `<a class="btn btn--sm" href="${challengeUrl(c.id)}">View</a>` });
    if (status === 'completed') items.push({ c, iconName: 'archive', text: 'Ended — consider archiving', actions: `<button type="button" class="btn btn--sm" data-org-action="archive" data-id="${c.id}">Archive</button>` });
  });
  panel('attention').innerHTML = items.length
    ? `<ul class="list attention-list" role="list">${items.map(({ c, iconName, text, actions }) => `
        <li class="list-row">
          <span class="activity-icon" data-category="${c.category}">${icon(iconName)}</span>
          <div class="list-row__main"><p class="list-row__title">${escapeHTML(c.title)}</p><p class="list-row__meta">${escapeHTML(text)}</p></div>
          <div class="cluster">${actions}</div>
        </li>`).join('')}</ul>`
    : emptyState({ title: 'All clear', text: 'No challenges need your attention right now.', compact: true });

  // Popular
  const popular = state.challenges
    .filter((c) => c.status !== 'draft')
    .map((c) => ({ c, n: getChallengeEnrollments(state, c.id).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  panel('popular').innerHTML = popular.length
    ? horizontalBars(popular.map(({ c, n }) => ({ label: c.title, value: n, max: participants.length, display: pluralize(n, 'participant') })))
    : emptyState({ title: 'No challenges yet', compact: true });
}

/* =====================================================================
   Challenge management
   ===================================================================== */

function statusActions(challenge) {
  const status = getChallengeStatus(challenge);
  const id = escapeHTML(challenge.id);
  const btn = (action, label, iconName, extra = '') => `<button type="button" class="icon-btn icon-btn--sm" data-org-action="${action}" data-id="${id}" aria-label="${label} ${escapeHTML(challenge.title)}" title="${label}" ${extra}>${icon(iconName)}</button>`;
  const actions = [
    `<a class="icon-btn icon-btn--sm" href="${challengeUrl(challenge.id)}" aria-label="View ${escapeHTML(challenge.title)}" title="View">${icon('eye')}</a>`,
    btn('edit', 'Edit', 'edit'),
  ];
  if (status === 'draft' || status === 'paused') actions.push(btn('activate', status === 'draft' ? 'Activate' : 'Resume', 'play'));
  if (status === 'active' || status === 'upcoming') actions.push(btn('pause', 'Pause', 'pause'));
  if (status !== 'archived' && status !== 'draft') actions.push(btn('archive', 'Archive', 'archive'));
  if (status === 'draft') actions.push(btn('delete', 'Delete draft', 'trash'));
  return `<div class="row-actions">${actions.join('')}</div>`;
}

function renderChallenges(state) {
  const query = view.challengeQuery.trim().toLowerCase();
  const rows = state.challenges
    .filter((c) => view.challengeStatus === 'all' || getChallengeStatus(c) === view.challengeStatus)
    .filter((c) => !query || `${c.title} ${c.description} ${CATEGORIES[c.category] ? CATEGORIES[c.category].label : ''}`.toLowerCase().includes(query))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (!rows.length) {
    panel('challenges').innerHTML = emptyState({
      title: state.challenges.length ? 'No challenges match' : 'No challenges yet',
      text: state.challenges.length ? 'Try another search or status filter.' : 'Create your first challenge to get started.',
      action: '<button type="button" class="btn btn--primary" data-action="new-challenge">Create challenge</button>',
    });
    return;
  }

  panel('challenges').innerHTML = `
    <div class="table-wrap">
      <table class="data-table org-table">
        <caption class="visually-hidden">All challenges with status and participation</caption>
        <thead><tr>
          <th scope="col">Challenge</th><th scope="col">Status</th><th scope="col">Dates</th>
          <th scope="col" class="num">Participants</th><th scope="col">Completion</th><th scope="col"><span class="visually-hidden">Actions</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((c) => {
            const enrollments = getChallengeEnrollments(state, c.id);
            const completed = enrollments.filter((e) => e.status === 'completed').length;
            return `
              <tr>
                <th scope="row">
                  <div class="org-challenge">
                    ${coverImage(c.image, { sizes: '64px', width: 64, height: 40 })}
                    <div>
                      <a class="table-link" href="${challengeUrl(c.id)}">${escapeHTML(c.title)}</a>
                      <div class="small muted">${categoryPill(c.category)} ${escapeHTML(describeTarget(c))}${c.featured ? ` · ${icon('star')} Featured` : ''}</div>
                    </div>
                  </div>
                </th>
                <td>${statusBadge(getChallengeStatus(c))}</td>
                <td class="small">${formatShortDate(c.startDate)} – ${formatShortDate(c.endDate)}<div class="muted">${c.durationDays} days</div></td>
                <td class="num">${formatNumber(enrollments.length)}</td>
                <td class="table-progress">${progressBar(completed, Math.max(enrollments.length, 1), `${c.title} completion`)}<span class="small muted">${completed}/${enrollments.length} · ${percent(completed, enrollments.length)}%</span></td>
                <td>${statusActions(c)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Units supported by every selected activity type. */
function getCommonUnits(types) {
  if (!types.length) return [];
  return types
    .map((t) => Object.keys(ACTIVITY_TYPES[t].units))
    .reduce((common, units) => common.filter((u) => units.includes(u)));
}

const FORM_ID = 'challenge-form';

function openChallengeForm(existingId = null) {
  const state = getState();
  const existing = existingId ? getChallenge(state, existingId) : null;
  const today = toDateKey();
  const c = existing || {
    title: '', tagline: '', description: '', objective: '', category: 'movement', image: 'static/assets/images/challenges/movement.webp',
    startDate: today, endDate: toDateKey(addDays(startOfToday(), 13)), activityTypes: ['walking'], metric: 'total', targetValue: '',
    targetUnit: 'minutes', dailyMinimum: '', dailyUnit: 'minutes', rewardPoints: 150, status: 'draft', featured: false, difficulty: 'Beginner', guidelines: [],
  };
  const storedStatus = ['draft', 'active', 'paused', 'archived'].includes(c.status) ? c.status : 'active';

  const typeChecks = Object.entries(ACTIVITY_TYPES).map(([key, t]) => `
    <label class="option-card">
      <input type="checkbox" name="activityTypes" value="${key}" ${c.activityTypes.includes(key) ? 'checked' : ''} aria-describedby="${describedBy(FORM_ID, 'activityTypes')}">
      <span class="option-card__body" data-category="${t.category}">${icon(t.icon)}${escapeHTML(t.label)}</span>
    </label>`).join('');

  const coverOptions = COVERS.map(([name, label]) => {
    const src = `static/assets/images/challenges/${name}.webp`;
    return `
      <label class="option-card option-card--image">
        <input type="radio" name="image" value="${src}" ${src === c.image ? 'checked' : ''} aria-label="${label}" aria-describedby="${describedBy(FORM_ID, 'image')}">
        <span class="option-card__body">${coverImage(src, { sizes: '160px', width: 160, height: 90 })}${label}</span>
      </label>`;
  }).join('');

  const modal = openModal({
    title: existing ? `Edit ${existing.title}` : 'Create a challenge',
    description: 'Challenges are non-clinical. Avoid collecting medical or sensitive health information.',
    size: 'lg',
    content: `
      <form id="${FORM_ID}" class="form" novalidate>
        <p class="form-alert" data-form-alert role="alert" hidden></p>

        <fieldset>
          <legend>Basics</legend>
          <div class="form-grid">
            <div class="field field--full">
              <label for="${FORM_ID}-title" class="required">Challenge name</label>
              <input class="input" id="${FORM_ID}-title" name="title" value="${escapeHTML(c.title)}" required minlength="4" maxlength="60" placeholder="e.g. Spring Step Sprint" aria-describedby="${describedBy(FORM_ID, 'title')}" data-autofocus>
              ${fieldError(FORM_ID, 'title')}
            </div>
            <div class="field field--full">
              <label for="${FORM_ID}-tagline">Tagline</label>
              <input class="input" id="${FORM_ID}-tagline" name="tagline" value="${escapeHTML(c.tagline || '')}" maxlength="80" placeholder="A short, motivating summary" aria-describedby="${describedBy(FORM_ID, 'tagline')}">
              ${fieldError(FORM_ID, 'tagline')}
            </div>
            <div class="field field--full">
              <label for="${FORM_ID}-description" class="required">Description</label>
              <textarea class="textarea" id="${FORM_ID}-description" name="description" required minlength="20" maxlength="400" rows="3" aria-describedby="${describedBy(FORM_ID, 'description')}">${escapeHTML(c.description)}</textarea>
              ${fieldError(FORM_ID, 'description')}
            </div>
            <div class="field field--full">
              <label for="${FORM_ID}-objective">Objective</label>
              <input class="input" id="${FORM_ID}-objective" name="objective" value="${escapeHTML(c.objective || '')}" maxlength="160" placeholder="What participants should achieve">
            </div>
            <div class="field">
              <label for="${FORM_ID}-category" class="required">Category</label>
              <select class="select" id="${FORM_ID}-category" name="category" required aria-describedby="${describedBy(FORM_ID, 'category')}">
                ${Object.entries(CATEGORIES).map(([key, cat]) => `<option value="${key}" ${key === c.category ? 'selected' : ''}>${cat.label}</option>`).join('')}
              </select>
              ${fieldError(FORM_ID, 'category')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-difficulty">Difficulty</label>
              <select class="select" id="${FORM_ID}-difficulty" name="difficulty">
                ${['Beginner', 'Intermediate', 'Advanced'].map((d) => `<option ${d === c.difficulty ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend class="required">Cover image</legend>
          <div class="option-grid option-grid--covers">${coverOptions}</div>
          ${fieldError(FORM_ID, 'image')}
        </fieldset>

        <fieldset>
          <legend>Schedule</legend>
          <div class="form-grid">
            <div class="field">
              <label for="${FORM_ID}-start" class="required">Start date</label>
              <input class="input" type="date" id="${FORM_ID}-start" name="startDate" value="${escapeHTML(c.startDate)}" required aria-describedby="${describedBy(FORM_ID, 'startDate')}">
              ${fieldError(FORM_ID, 'startDate')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-end" class="required">End date</label>
              <input class="input" type="date" id="${FORM_ID}-end" name="endDate" value="${escapeHTML(c.endDate)}" required aria-describedby="${describedBy(FORM_ID, 'endDate', true)}">
              <p class="hint" id="${FORM_ID}-endDate-hint" data-duration-hint></p>
              ${fieldError(FORM_ID, 'endDate')}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend class="required">Accepted activities</legend>
          <div class="option-grid">${typeChecks}</div>
          ${fieldError(FORM_ID, 'activityTypes')}
        </fieldset>

        <fieldset>
          <legend>Target &amp; reward</legend>
          <div class="form-grid">
            <div class="field field--full">
              <span class="field-label" id="${FORM_ID}-metric-label">Progress is measured by</span>
              <div class="segmented segmented--radio" role="radiogroup" aria-labelledby="${FORM_ID}-metric-label">
                <label><input type="radio" name="metric" value="total" ${c.metric !== 'days' ? 'checked' : ''}> Total amount</label>
                <label><input type="radio" name="metric" value="days" ${c.metric === 'days' ? 'checked' : ''}> Qualifying days</label>
              </div>
              ${fieldError(FORM_ID, 'metric')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-target" class="required" data-target-label>Target value</label>
              <input class="input" type="number" inputmode="decimal" id="${FORM_ID}-target" name="targetValue" value="${escapeHTML(c.targetValue)}" min="1" step="any" required aria-describedby="${describedBy(FORM_ID, 'targetValue')}">
              ${fieldError(FORM_ID, 'targetValue')}
            </div>
            <div class="field" data-total-only>
              <label for="${FORM_ID}-unit" class="required">Target unit</label>
              <select class="select" id="${FORM_ID}-unit" name="targetUnit" aria-describedby="${describedBy(FORM_ID, 'targetUnit')}"></select>
              ${fieldError(FORM_ID, 'targetUnit')}
            </div>
            <div class="field" data-days-only>
              <label for="${FORM_ID}-daily-min" class="required">Daily minimum</label>
              <input class="input" type="number" inputmode="decimal" id="${FORM_ID}-daily-min" name="dailyMinimum" value="${escapeHTML(c.dailyMinimum || '')}" min="1" step="any" aria-describedby="${describedBy(FORM_ID, 'dailyMinimum')}">
              ${fieldError(FORM_ID, 'dailyMinimum')}
            </div>
            <div class="field" data-days-only>
              <label for="${FORM_ID}-daily-unit" class="required">Daily unit</label>
              <select class="select" id="${FORM_ID}-daily-unit" name="dailyUnit" aria-describedby="${describedBy(FORM_ID, 'dailyUnit')}"></select>
              ${fieldError(FORM_ID, 'dailyUnit')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-reward" class="required">Reward points</label>
              <input class="input" type="number" id="${FORM_ID}-reward" name="rewardPoints" value="${escapeHTML(c.rewardPoints)}" min="10" max="1000" step="1" required aria-describedby="${describedBy(FORM_ID, 'rewardPoints')}">
              ${fieldError(FORM_ID, 'rewardPoints')}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Participation</legend>
          <div class="form-grid">
            <div class="field field--full">
              <label for="${FORM_ID}-guidelines" class="required">Participation guidelines</label>
              <textarea class="textarea" id="${FORM_ID}-guidelines" name="guidelines" rows="4" maxlength="800" required placeholder="One guideline per line" aria-describedby="${describedBy(FORM_ID, 'guidelines', true)}">${escapeHTML((c.guidelines || []).join('\n'))}</textarea>
              <p class="hint" id="${FORM_ID}-guidelines-hint">Write one guideline per line. Completion requirements are generated from the target.</p>
              ${fieldError(FORM_ID, 'guidelines')}
            </div>
            <div class="field">
              <label for="${FORM_ID}-status" class="required">Status</label>
              <select class="select" id="${FORM_ID}-status" name="status" required aria-describedby="${describedBy(FORM_ID, 'status')}">
                ${['draft', 'active', 'paused', 'archived'].map((s) => `<option value="${s}" ${s === storedStatus ? 'selected' : ''}>${STATUS_LABELS[s] === 'Active' ? 'Active (published)' : STATUS_LABELS[s]}</option>`).join('')}
              </select>
              ${fieldError(FORM_ID, 'status')}
            </div>
            <div class="field field--checkbox">
              <label class="check"><input type="checkbox" name="featured" value="true" ${c.featured ? 'checked' : ''}> Feature on the landing &amp; challenges pages</label>
            </div>
          </div>
        </fieldset>

        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn--primary">${icon('check')} ${existing ? 'Save changes' : 'Create challenge'}</button>
        </div>
      </form>`,
  });

  const form = modal.body.querySelector('form');
  const initialUnits = { targetUnit: c.targetUnit, dailyUnit: c.dailyUnit };

  function syncForm() {
    const data = readForm(form, ['activityTypes']);
    const isDays = data.metric === 'days';
    $$('[data-days-only]', form).forEach((el) => { el.hidden = !isDays; });
    $$('[data-total-only]', form).forEach((el) => { el.hidden = isDays; });
    form.querySelector('[data-target-label]').textContent = isDays ? 'Number of qualifying days' : 'Target value';

    const units = getCommonUnits(data.activityTypes);
    ['targetUnit', 'dailyUnit'].forEach((name) => {
      const select = form.elements[name];
      const previous = select.value || initialUnits[name];
      select.innerHTML = units.length
        ? units.map((u) => `<option value="${u}">${UNIT_LABELS[u]}</option>`).join('')
        : '<option value="">No shared unit</option>';
      if (units.includes(previous)) select.value = previous;
    });

    const hint = form.querySelector('[data-duration-hint]');
    const start = data.startDate;
    const end = data.endDate;
    if (start && end && end >= start) {
      const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
      hint.textContent = `${days} ${days === 1 ? 'day' : 'days'} long`;
    } else hint.textContent = '';
  }

  form.addEventListener('change', syncForm);
  syncForm();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readForm(form, ['activityTypes']);
    input.featured = input.featured === 'true';
    const errors = validateChallengeInput(getState(), input, existingId);
    if (Object.keys(errors).length) {
      const first = setFieldErrors(form, errors);
      if (first) first.focus();
      announce('Please fix the highlighted fields.');
      return;
    }
    const result = saveChallenge(input, existingId);
    if (!result.ok) {
      setFieldErrors(form, { ...result.errors, form: result.message });
      return;
    }
    modal.close();
    showToast({ type: 'success', title: existingId ? 'Challenge updated' : 'Challenge created', message: result.message });
    if (!existingId) {
      view.challengeStatus = 'all';
      $('#org-challenge-status').value = 'all';
      selectTab('challenges');
    }
  });
}

async function handleChallengeAction(event) {
  const button = event.target.closest('[data-org-action]');
  if (!button) return;
  const { orgAction: action, id } = button.dataset;
  const challenge = getChallenge(getState(), id);
  if (!challenge) return;

  if (action === 'edit') {
    openChallengeForm(id);
    return;
  }
  let result = null;
  if (action === 'activate') {
    result = setChallengeStatus(id, 'active');
  } else if (action === 'pause') {
    const ok = await confirmDialog({ title: `Pause ${challenge.title}?`, message: 'Participants will not be able to log progress toward it until you resume it.', confirmText: 'Pause challenge', iconName: 'pause' });
    if (!ok) return;
    result = setChallengeStatus(id, 'paused');
  } else if (action === 'archive') {
    const ok = await confirmDialog({ title: `Archive ${challenge.title}?`, message: 'Archived challenges stay visible for reference but are closed to new participants and new progress.', confirmText: 'Archive', tone: 'danger' });
    if (!ok) return;
    result = setChallengeStatus(id, 'archived');
  } else if (action === 'delete') {
    const ok = await confirmDialog({ title: `Delete ${challenge.title}?`, message: 'This draft will be permanently removed. This cannot be undone.', confirmText: 'Delete draft', tone: 'danger' });
    if (!ok) return;
    result = deleteChallenge(id);
  }
  if (result) showToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Challenge updated' : 'Action not allowed', message: result.message });
}

/* =====================================================================
   Participants
   ===================================================================== */

function getParticipantRows(state) {
  const weekStart = daysAgoKey(6);
  return getParticipants(state).map((user) => {
    const stats = getUserStats(state, user.id);
    const activities = getUserActivities(state, user.id);
    const enrollments = state.enrollments.filter((e) => e.userId === user.id && e.status !== 'left');
    const active = enrollments.filter((e) => e.status === 'active').length;
    return {
      user,
      stats,
      active,
      joined: enrollments.length,
      lastActive: activities[0] ? activities[0].date : null,
      activeThisWeek: activities.some((a) => a.date.slice(0, 10) >= weekStart),
    };
  });
}

function renderParticipants(state) {
  const query = view.participantQuery.trim().toLowerCase();
  const rows = getParticipantRows(state)
    .filter((r) => !query || `${r.user.name} ${r.user.team || ''}`.toLowerCase().includes(query))
    .filter((r) => {
      if (view.engagement === 'active') return r.activeThisWeek;
      if (view.engagement === 'inactive') return !r.activeThisWeek;
      if (view.engagement === 'unenrolled') return r.active === 0;
      return true;
    })
    .sort((a, b) => b.stats.totalPoints - a.stats.totalPoints);

  if (!rows.length) {
    panel('participants').innerHTML = emptyState({ title: 'No participants found', text: 'Try a different search or filter.', compact: true });
    return;
  }
  panel('participants').innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <caption class="visually-hidden">Participants and their participation</caption>
        <thead><tr>
          <th scope="col">Participant</th><th scope="col">Enrollment status</th><th scope="col" class="num">Challenges joined</th>
          <th scope="col" class="num">Points</th><th scope="col" class="num">Activities</th><th scope="col">Last active</th><th scope="col"><span class="visually-hidden">Inspect</span></th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <th scope="row">
                <div class="person">
                  <img class="avatar" src="${escapeHTML(r.user.avatar)}" alt="" width="40" height="40" loading="lazy">
                  <div><p class="person__name">${escapeHTML(r.user.name)}</p><p class="person__meta">${escapeHTML(r.user.team || '')}${r.user.privacy.leaderboardVisible === false ? ` · ${icon('eye-off')} hidden from rankings` : ''}</p></div>
                </div>
              </th>
              <td>${r.active ? `<span class="status" data-status="active">Active in ${r.active}</span>` : '<span class="status" data-status="archived">Not enrolled</span>'}</td>
              <td class="num">${r.joined} <span class="muted small">(${r.stats.completedChallenges} done)</span></td>
              <td class="num">${formatNumber(r.stats.totalPoints)}</td>
              <td class="num">${formatNumber(r.stats.totalActivities)}</td>
              <td>${r.lastActive ? formatRelativeDay(r.lastActive) : '<span class="muted">Never</span>'}</td>
              <td><button type="button" class="btn btn--sm" data-inspect="${r.user.id}">Inspect</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function openParticipantInspector(userId) {
  const state = getState();
  const user = getUser(state, userId);
  if (!user) return;
  const stats = getUserStats(state, userId);
  const enrollments = state.enrollments.filter((e) => e.userId === userId).sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  const badges = getBadgeProgress(state, userId).filter((b) => b.unlocked);
  const recent = getUserActivities(state, userId).slice(0, 5);

  openModal({
    title: user.name,
    description: `${user.headline || 'Participant'} · ${user.team || ''} · joined ${formatDate(user.joinDate)}`,
    size: 'lg',
    content: `
      <div class="inspector">
        <div class="inspector__head">
          <img class="avatar avatar--lg" src="${escapeHTML(user.avatar)}" alt="" width="56" height="56">
          <dl class="mini-stats">
            <div><dt>Points</dt><dd>${formatNumber(stats.totalPoints)}</dd></div>
            <div><dt>Activities</dt><dd>${formatNumber(stats.totalActivities)}</dd></div>
            <div><dt>Streak</dt><dd>${stats.currentStreak}d</dd></div>
            <div><dt>Badges</dt><dd>${badges.length}</dd></div>
          </dl>
        </div>
        <p class="small muted">${icon('shield')} Privacy: profile ${user.privacy.profileVisible ? 'public' : 'private'} · leaderboard ${user.privacy.leaderboardVisible ? 'visible' : 'hidden'} · activity ${user.privacy.activityVisible ? 'shared' : 'private'}</p>
        <h3 class="subheading">Enrollments</h3>
        ${enrollments.length ? `<ul class="list" role="list">${enrollments.map((e) => {
          const c = getChallenge(state, e.challengeId);
          if (!c) return '';
          const p = getChallengeProgress(state, userId, c);
          return `<li class="list-row">
              <div class="list-row__main">
                <p class="list-row__title"><a href="${challengeUrl(c.id)}">${escapeHTML(c.title)}</a> <span class="status" data-status="${e.status === 'active' ? 'joined' : e.status}">${e.status === 'active' ? 'Enrolled' : e.status === 'completed' ? 'Completed' : 'Left'}</span></p>
                <p class="list-row__meta">Joined ${formatDate(e.enrolledAt)} · ${formatValue(p.current)} / ${formatValue(p.target)} ${escapeHTML(p.unit)}</p>
                ${progressBar(p.current, p.target, `${c.title} progress`)}
              </div>
              <strong class="tabular">${p.percent}%</strong>
            </li>`;
        }).join('')}</ul>` : '<p class="small muted">Not enrolled in any challenge.</p>'}
        <h3 class="subheading">Recent activities</h3>
        ${recent.length ? `<ol class="timeline" role="list">${recent.map((a) => activityItem(state, a)).join('')}</ol>` : '<p class="small muted">No activities logged yet.</p>'}
      </div>`,
  });
}

/* =====================================================================
   Analytics
   ===================================================================== */

function renderAnalytics(state) {
  const participants = getParticipants(state);
  const publicChallenges = state.challenges.filter((c) => c.status !== 'draft');

  if (!state.activities.length && !state.enrollments.length) {
    panel('analytics').innerHTML = emptyState({ title: 'No data to analyse yet', text: 'Analytics appear once participants join challenges and log activities.' });
    return;
  }

  // Engagement: unique active participants per day (last 14 days).
  const today = startOfToday();
  const engagement = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const key = toDateKey(date);
    const users = new Set(state.activities.filter((a) => a.date.slice(0, 10) === key).map((a) => a.userId));
    engagement.push({ label: offset % 2 === 0 ? formatWeekday(date).slice(0, 2) : '', value: users.size, highlight: offset === 0, title: `${formatShortDate(date)}: ${users.size} active participants` });
  }

  // Segments by active days in the last 7 days.
  const weekStart = daysAgoKey(6);
  const segments = { 'Highly engaged (5–7 days)': 0, 'Regular (2–4 days)': 0, 'Occasional (1 day)': 0, 'Inactive (0 days)': 0 };
  participants.forEach((u) => {
    const days = new Set(state.activities.filter((a) => a.userId === u.id && a.date.slice(0, 10) >= weekStart).map((a) => a.date.slice(0, 10))).size;
    if (days >= 5) segments['Highly engaged (5–7 days)'] += 1;
    else if (days >= 2) segments['Regular (2–4 days)'] += 1;
    else if (days === 1) segments['Occasional (1 day)'] += 1;
    else segments['Inactive (0 days)'] += 1;
  });

  const participation = publicChallenges
    .map((c) => ({ c, n: getChallengeEnrollments(state, c.id).length }))
    .sort((a, b) => b.n - a.n);

  const completion = publicChallenges
    .map((c) => {
      const enrollments = getChallengeEnrollments(state, c.id);
      const done = enrollments.filter((e) => e.status === 'completed').length;
      const avg = enrollments.length ? Math.round(enrollments.reduce((s, e) => s + getChallengeProgress(state, e.userId, c).percent, 0) / enrollments.length) : 0;
      return { c, done, total: enrollments.length, avg };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.avg - a.avg);

  panel('analytics').innerHTML = `
    <section class="panel" aria-labelledby="an-participation">
      <div class="panel__header"><div><h3 id="an-participation">Challenge participation</h3><p>Participants enrolled per challenge</p></div></div>
      ${participation.length ? horizontalBars(participation.map(({ c, n }) => ({ label: c.title, value: n, max: participants.length, display: `${n} of ${participants.length}` }))) : emptyState({ title: 'No challenges', compact: true })}
    </section>
    <section class="panel" aria-labelledby="an-distribution">
      <div class="panel__header"><div><h3 id="an-distribution">Activity distribution</h3><p>All logged activities by wellness category</p></div></div>
      ${donutChart(getCategoryDistribution(state.activities), { title: 'Activity distribution by category', centerLabel: 'activities' })}
    </section>
    <section class="panel" aria-labelledby="an-engagement">
      <div class="panel__header"><div><h3 id="an-engagement">Participant engagement</h3><p>Unique active participants per day · last 14 days</p></div></div>
      ${barChart(engagement, { height: 190, title: 'Unique active participants per day over the last 14 days' })}
      <h4 class="subheading">Engagement this week</h4>
      ${horizontalBars(Object.entries(segments).map(([label, value]) => ({ label, value, max: participants.length, display: pluralize(value, 'participant') })))}
    </section>
    <section class="panel" aria-labelledby="an-completion">
      <div class="panel__header"><div><h3 id="an-completion">Challenge completion</h3><p>Average progress and completion rate</p></div></div>
      ${completion.length ? `<ul class="hbar-list" role="list">${completion.map(({ c, done, total, avg }) => `
        <li>
          <div class="split"><span>${escapeHTML(c.title)} ${statusBadge(getChallengeStatus(c))}</span><strong>${avg}% avg</strong></div>
          ${progressBar(avg, 100, `${c.title} average progress`)}
          <span class="small muted">${done} of ${total} completed (${percent(done, total)}%)</span>
        </li>`).join('')}</ul>` : emptyState({ title: 'No enrollments yet', compact: true })}
    </section>`;
}

/* =====================================================================
   Tabs & page
   ===================================================================== */

function selectTab(tab) {
  if (!TABS.includes(tab)) tab = 'overview';
  view.tab = tab;
  sessionSet('organizer_tab', tab);
  $$('[data-tab]').forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  TABS.forEach((name) => {
    document.getElementById(`panel-${name}`).hidden = name !== tab;
  });
}

function renderIdentity(state) {
  const organizer = getUser(state, state.organizerId);
  if (!organizer) return;
  $('[data-organizer-org]').textContent = organizer.organization || 'Organizer';
  $('[data-organizer-identity]').innerHTML = `
    <img class="avatar avatar--lg" src="${escapeHTML(organizer.avatar)}" alt="" width="56" height="56">
    <div><p class="person__name">${escapeHTML(organizer.name)}</p><p class="person__meta">${escapeHTML(organizer.headline || 'Organizer')}</p></div>`;
}

function render() {
  const state = getState();
  renderIdentity(state);
  renderOverview(state);
  renderChallenges(state);
  renderParticipants(state);
  renderAnalytics(state);
}

async function init() {
  const state = await initApp('organizer');
  if (!state) return;
  selectTab(sessionGet('organizer_tab', 'overview'));
  render();
  onStateChange(render);

  const tabList = $('[data-organizer-tabs]');
  tabList.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) selectTab(tab.dataset.tab);
  });
  tabList.addEventListener('keydown', (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in keys)) return;
    const index = TABS.indexOf(view.tab);
    const next = TABS[(index + keys[event.key] + TABS.length) % TABS.length];
    selectTab(next);
    $(`[data-tab="${next}"]`).focus();
  });

  // One delegated listener for the whole page.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="new-challenge"]')) {
      openChallengeForm();
      return;
    }
    const inspect = event.target.closest('[data-inspect]');
    if (inspect) {
      openParticipantInspector(inspect.dataset.inspect);
      return;
    }
    if (event.target.closest('#main')) handleChallengeAction(event);
  });

  const challengeFilters = $('[data-org-challenge-filters]');
  challengeFilters.addEventListener('submit', (event) => event.preventDefault());
  challengeFilters.elements.q.addEventListener('input', debounce((event) => {
    view.challengeQuery = event.target.value;
    renderChallenges(getState());
  }, 200));
  challengeFilters.elements.status.addEventListener('change', (event) => {
    view.challengeStatus = event.target.value;
    renderChallenges(getState());
  });

  const participantFilters = $('[data-org-participant-filters]');
  participantFilters.addEventListener('submit', (event) => event.preventDefault());
  participantFilters.elements.q.addEventListener('input', debounce((event) => {
    view.participantQuery = event.target.value;
    renderParticipants(getState());
  }, 200));
  participantFilters.elements.engagement.addEventListener('change', (event) => {
    view.engagement = event.target.value;
    renderParticipants(getState());
  });
}

init();
