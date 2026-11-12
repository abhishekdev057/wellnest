/**
 * leaderboard.js — Weekly, overall and challenge-specific rankings.
 * Participants who turned off "leaderboard visibility" are excluded from the
 * public ranking; if that is the current user they see a private note.
 */
import { initApp, getState, onStateChange } from '../app.js';
import { buildLeaderboard, getChallenge, getChallengeStatus, getChallengeEnrollments, UNIT_LABELS } from '../engine.js';
import { personBlock, movementBadge, emptyState, challengeUrl } from '../components/templates.js';
import { sessionGet, sessionSet } from '../storage.js';
import { $, $$, escapeHTML, icon, formatNumber, formatValue, getQueryParam, debounce, announce } from '../utils.js';

const SCOPE_LABELS = { weekly: 'Last 7 days', overall: 'All time', challenge: 'Challenge progress' };

const view = {
  scope: 'weekly',
  challengeId: '',
  query: '',
  sortKey: 'score',
  sortDir: 'desc',
};

function getChallengeOptions(state) {
  return state.challenges
    .filter((c) => c.status !== 'draft' && getChallengeEnrollments(state, c.id).length > 0)
    .sort((a, b) => {
      const order = { active: 0, upcoming: 1, paused: 2, completed: 3, archived: 4 };
      return order[getChallengeStatus(a)] - order[getChallengeStatus(b)] || a.title.localeCompare(b.title);
    });
}

function scoreLabel(row) {
  if (view.scope === 'challenge') {
    return `${row.progress.percent}% <span class="muted small">(${formatValue(row.progress.current)} ${escapeHTML(row.progress.unit)})</span>`;
  }
  return `${formatNumber(row.score)} <span class="muted small">pts</span>`;
}

/* ---------------- Rendering ---------------- */

function renderPodium(rows) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return '';
  // Visual order: 2nd, 1st, 3rd
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return `
    <section class="podium" aria-label="Top three participants">
      ${order.map((row) => `
        <article class="podium__place" data-place="${row.rank}">
          <div class="podium__avatar">
            <img class="avatar" src="${escapeHTML(row.user.avatar)}" alt="" width="88" height="88">
            <span class="podium__medal" aria-hidden="true">${row.rank}</span>
          </div>
          <h3 class="podium__name">${escapeHTML(row.user.name)}</h3>
          <p class="podium__team">${escapeHTML(row.user.team || '')}</p>
          <p class="podium__score">${scoreLabel(row)}</p>
          <div class="podium__meta">
            <span>${icon('activity')} ${formatNumber(row.activityCount)}</span>
            <span>${icon('flame')} ${row.streak}d</span>
            ${movementBadge(row.movement)}
          </div>
          <div class="podium__block"><span class="visually-hidden">Rank</span>${row.rank}</div>
        </article>`).join('')}
    </section>`;
}

function sortRows(rows) {
  const factor = view.sortDir === 'asc' ? 1 : -1;
  const keyFns = {
    score: (r) => r.score,
    points: (r) => r.points,
    activities: (r) => r.activityCount,
    streak: (r) => r.streak,
    name: (r) => r.user.name,
  };
  const getKey = keyFns[view.sortKey] || keyFns.score;
  return [...rows].sort((a, b) => {
    const av = getKey(a);
    const bv = getKey(b);
    if (typeof av === 'string') return av.localeCompare(bv) * factor;
    return (av - bv) * factor || a.rank - b.rank;
  });
}

function sortHeader(key, label, numeric = true) {
  const ariaSort = view.sortKey === key ? (view.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th scope="col" class="${numeric ? 'num' : ''}" aria-sort="${ariaSort}"><button type="button" class="sort-btn" data-sort="${key}">${label}${icon('chevron-down')}</button></th>`;
}

function renderTable(state, rows) {
  const filtered = rows.filter((row) => row.user.name.toLowerCase().includes(view.query.trim().toLowerCase()));
  const sorted = sortRows(filtered);
  const isChallenge = view.scope === 'challenge';
  if (!sorted.length) {
    return emptyState({ title: 'No participants found', text: view.query ? `Nobody matches “${view.query.trim()}”.` : 'No public rankings to show yet.', compact: true });
  }
  return `
    <div class="table-wrap">
      <table class="data-table leaderboard-table">
        <caption class="visually-hidden">${escapeHTML(SCOPE_LABELS[view.scope])} leaderboard. Column headers are buttons that sort the table.</caption>
        <thead>
          <tr>
            <th scope="col">Rank</th>
            ${sortHeader('name', 'Participant', false)}
            ${sortHeader('score', isChallenge ? 'Progress' : 'Points')}
            ${isChallenge ? sortHeader('points', 'Points') : ''}
            ${sortHeader('activities', 'Activities')}
            ${sortHeader('streak', 'Streak')}
            <th scope="col" class="num">Change</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => {
            const isCurrent = row.user.id === state.currentUserId;
            return `
              <tr class="${isCurrent ? 'is-current' : ''}">
                <td><span class="rank-badge" data-rank="${row.rank}">${row.rank}</span></td>
                <th scope="row">${personBlock(row.user, { meta: escapeHTML(row.user.team || ''), isCurrent })}</th>
                <td class="num">${scoreLabel(row)}</td>
                ${isChallenge ? `<td class="num">${formatNumber(row.points)}</td>` : ''}
                <td class="num">${formatNumber(row.activityCount)}</td>
                <td class="num">${row.streak} ${row.streak === 1 ? 'day' : 'days'}</td>
                <td class="num">${movementBadge(row.movement)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderPrivacyNote(state) {
  const user = state.users.find((u) => u.id === state.currentUserId);
  if (user.privacy.leaderboardVisible !== false) return '';
  const privateRows = buildLeaderboard(state, { scope: view.scope, challengeId: view.challengeId, includeHidden: true });
  const myRow = privateRows.find((r) => r.user.id === user.id);
  return `
    <p class="banner banner--info" role="note">
      ${icon('eye-off')}
      <span>You are hidden from public rankings.${myRow ? ` Privately, you would be <strong>#${myRow.rank}</strong> with ${view.scope === 'challenge' ? `${myRow.progress.percent}% progress` : `${formatNumber(myRow.score)} points`}.` : ''}
      <a href="settings.html#privacy">Change visibility</a></span>
    </p>`;
}

function renderYourPosition(state, rows) {
  const myRow = rows.find((r) => r.user.id === state.currentUserId);
  if (!myRow) return '';
  const ahead = rows.find((r) => r.rank === myRow.rank - 1) || rows.filter((r) => r.rank < myRow.rank).pop();
  const gap = ahead ? ahead.score - myRow.score : 0;
  const gapText = view.scope === 'challenge' ? `${formatValue(gap)} ${escapeHTML(myRow.progress.unit)}` : `${formatNumber(gap)} points`;
  return `
    <div class="your-position">
      <span class="your-position__rank">#${myRow.rank}</span>
      <div>
        <p class="your-position__title">Your position · ${escapeHTML(SCOPE_LABELS[view.scope])}</p>
        <p class="small muted">${myRow.rank === 1 ? 'You are leading — fantastic consistency!' : ahead ? `${gapText} behind ${escapeHTML(ahead.user.name.split(' ')[0])} in #${ahead.rank}.` : ''}</p>
      </div>
      ${movementBadge(myRow.movement)}
    </div>`;
}

function render() {
  const state = getState();
  const panel = $('[data-leaderboard-panel]');
  const picker = $('[data-challenge-picker]');
  picker.hidden = view.scope !== 'challenge';

  // Tabs
  $$('[data-scope]').forEach((tab) => {
    const selected = tab.dataset.scope === view.scope;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', `tab-${view.scope}`);

  // Challenge options
  if (view.scope === 'challenge') {
    const options = getChallengeOptions(state);
    if (!options.some((c) => c.id === view.challengeId)) view.challengeId = options[0] ? options[0].id : '';
    const select = $('#leaderboard-challenge');
    select.innerHTML = options.map((c) => `<option value="${c.id}">${escapeHTML(c.title)}</option>`).join('');
    select.value = view.challengeId;
  }

  const rows = buildLeaderboard(state, { scope: view.scope, challengeId: view.challengeId });
  const challenge = view.scope === 'challenge' ? getChallenge(state, view.challengeId) : null;

  panel.innerHTML = `
    ${renderPrivacyNote(state)}
    ${challenge ? `<p class="small muted leaderboard-context">Ranking by progress toward <a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a> · target ${formatValue(challenge.targetValue)} ${UNIT_LABELS[challenge.metric === 'days' ? 'days' : challenge.targetUnit]}</p>` : ''}
    ${rows.length ? renderPodium(rows) : ''}
    ${renderYourPosition(state, rows)}
    ${rows.length ? renderTable(state, rows) : emptyState({ title: 'No rankings yet', text: 'Rankings appear once participants log activities.' })}
    <p class="small muted leaderboard-footnote">${icon('info')} Rank change compares with standings 7 days ago. Members who hide themselves in privacy settings are not listed.</p>`;
}

async function init() {
  const state = await initApp('leaderboard');
  if (!state) return;

  // Initial view: ?challenge= link > saved session tab > weekly.
  const saved = sessionGet('leaderboard_view', {});
  Object.assign(view, { scope: saved.scope || 'weekly', challengeId: saved.challengeId || '' });
  const challengeParam = getQueryParam('challenge');
  if (challengeParam && getChallenge(state, challengeParam)) Object.assign(view, { scope: 'challenge', challengeId: challengeParam });

  render();
  onStateChange(render);

  const persist = () => sessionSet('leaderboard_view', { scope: view.scope, challengeId: view.challengeId });

  // Tabs with arrow-key navigation (WAI-ARIA tabs pattern).
  const tabList = $('[data-scope-tabs]');
  tabList.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-scope]');
    if (!tab) return;
    view.scope = tab.dataset.scope;
    view.sortKey = 'score';
    view.sortDir = 'desc';
    persist();
    render();
    announce(`${tab.textContent} leaderboard`);
  });
  tabList.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = $$('[data-scope]');
    const index = tabs.findIndex((t) => t.dataset.scope === view.scope);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });

  $('#leaderboard-challenge').addEventListener('change', (event) => {
    view.challengeId = event.target.value;
    persist();
    render();
  });

  $('#leaderboard-search').addEventListener('input', debounce((event) => {
    view.query = event.target.value;
    render();
  }, 150));

  // Sorting (event delegation on the panel because the table is re-rendered).
  $('[data-leaderboard-panel]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    view.sortDir = view.sortKey === key && view.sortDir === 'desc' ? 'asc' : 'desc';
    if (key === 'name' && view.sortKey !== 'name') view.sortDir = 'asc';
    view.sortKey = key;
    render();
    const again = $(`[data-sort="${key}"]`);
    if (again) again.focus();
  });
}

init();
