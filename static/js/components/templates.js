/**
 * templates.js
 * Shared markup builders used by several pages so that the same piece of
 * UI (a challenge card, an activity entry, a badge…) always looks identical.
 */
import {
  CATEGORIES, ACTIVITY_TYPES, STATUS_LABELS,
  getChallengeStatus, getEnrollment, getChallengeProgress, getParticipantCount, getTimeRemaining,
  describeTarget, describeAmount, getActivityIcon, getActivityCategory, getChallenge, canJoinChallenge,
} from '../engine.js';
import { progressBar } from './charts.js';
import { escapeHTML, icon, formatNumber, formatValue, formatRelativeDay, formatTime, formatDate } from '../utils.js';

/** Built-in covers ship in three widths: name-320.webp, name-640.webp and name.webp (1280px). */
const COVER_PATTERN = /^(static\/assets\/images\/challenges\/[a-z-]+)\.webp$/;

/**
 * Responsive <img> for a challenge cover. The browser picks the smallest file that
 * is still sharp for the slot (`sizes`), so a 96px thumbnail never downloads the
 * 1280px original. Covers below the fold load lazily; the main cover of a page
 * should pass `eager: true` so it is fetched first.
 */
export function coverImage(src, { sizes = '100vw', eager = false, className = '', width = 1280, height = 720 } = {}) {
  const match = String(src || '').match(COVER_PATTERN);
  const srcset = match
    ? ` srcset="${match[1]}-320.webp 320w, ${match[1]}-640.webp 640w, ${match[1]}.webp 1280w" sizes="${escapeHTML(sizes)}"`
    : '';
  const loading = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  const cls = className ? ` class="${escapeHTML(className)}"` : '';
  return `<img${cls} src="${escapeHTML(src)}"${srcset} alt="" width="${width}" height="${height}" ${loading} decoding="async">`;
}

export const challengeUrl = (id) => `challenge.html?id=${encodeURIComponent(id)}`;

export const categoryPill = (category) =>
  `<span class="pill" data-category="${escapeHTML(category)}">${icon(CATEGORIES[category] ? CATEGORIES[category].icon : 'leaf')}${escapeHTML(CATEGORIES[category] ? CATEGORIES[category].label : category)}</span>`;

export const statusBadge = (status) => `<span class="status" data-status="${status}">${STATUS_LABELS[status] || status}</span>`;

/** Action button for a challenge depending on the user's enrollment. */
export function challengeAction(state, challenge, userId, { size = 'sm' } = {}) {
  const enrollment = getEnrollment(state, userId, challenge.id);
  const sizeClass = size === 'sm' ? 'btn--sm' : '';
  if (enrollment && enrollment.status === 'completed') {
    return `<span class="status" data-status="completed">${icon('check')} Completed</span>`;
  }
  if (enrollment && enrollment.status === 'active') {
    return `<a class="btn btn--primary ${sizeClass}" href="${challengeUrl(challenge.id)}">Continue ${icon('arrow-right')}</a>`;
  }
  if (canJoinChallenge(challenge).ok) {
    return `<button type="button" class="btn btn--accent ${sizeClass}" data-action="join" data-challenge-id="${escapeHTML(challenge.id)}">${icon('plus')} Join challenge</button>`;
  }
  return `<a class="btn ${sizeClass}" href="${challengeUrl(challenge.id)}">View details</a>`;
}

/** Challenge card used on the landing page, challenges page and dashboard. */
export function challengeCard(state, challenge, userId, { index = 0 } = {}) {
  const status = getChallengeStatus(challenge);
  const enrollment = getEnrollment(state, userId, challenge.id);
  const enrolled = enrollment && enrollment.status !== 'left';
  const progress = enrolled ? getChallengeProgress(state, userId, challenge) : null;
  const participants = getParticipantCount(state, challenge.id);
  const remaining = getTimeRemaining(challenge);

  return `
    <article class="challenge-card" data-index="${index}">
      <div class="challenge-card__media">
        ${coverImage(challenge.image, { sizes: '(max-width: 640px) 92vw, (max-width: 1100px) 46vw, 310px' })}
        <div class="challenge-card__badges">
          ${categoryPill(challenge.category)}
          ${enrolled ? `<span class="status" data-status="joined">${icon('check')} Joined</span>` : statusBadge(status)}
        </div>
      </div>
      <div class="challenge-card__body">
        <h3 class="challenge-card__title"><a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a></h3>
        <p class="challenge-card__desc">${escapeHTML(challenge.description)}</p>
        <dl class="meta-list">
          <div><dt>${icon('calendar')}<span class="visually-hidden">Duration</span></dt><dd><strong>${challenge.durationDays}</strong> days</dd></div>
          <div><dt>${icon('target')}<span class="visually-hidden">Target</span></dt><dd title="${escapeHTML(describeTarget(challenge))}"><strong>${escapeHTML(describeTarget(challenge))}</strong></dd></div>
          <div><dt>${icon('users')}<span class="visually-hidden">Participants</span></dt><dd><strong>${formatNumber(participants)}</strong> ${participants === 1 ? 'participant' : 'participants'}</dd></div>
          <div><dt>${icon('clock')}<span class="visually-hidden">Timing</span></dt><dd>${escapeHTML(remaining.label)}</dd></div>
        </dl>
        ${progress ? `
          <div class="card-progress">
            ${progressBar(progress.current, progress.target, `${challenge.title} progress`)}
            <div class="progress-meta"><span>${progress.percent}% complete</span><span>${formatValue(progress.current)} / ${formatValue(progress.target)} ${escapeHTML(progress.unit)}</span></div>
          </div>` : ''}
        <div class="challenge-card__footer">
          <span class="reward">${icon('star')} ${formatNumber(challenge.rewardPoints)} pts</span>
          ${challengeAction(state, challenge, userId)}
        </div>
      </div>
    </article>`;
}

/** One entry in an activity timeline. */
export function activityItem(state, activity, { showUser = false } = {}) {
  const type = ACTIVITY_TYPES[activity.type];
  const challenge = activity.challengeId ? getChallenge(state, activity.challengeId) : null;
  const user = showUser ? state.users.find((u) => u.id === activity.userId) : null;
  const title = user ? `${user.name} · ${type ? type.label : activity.type}` : type ? type.label : activity.type;
  return `
    <li class="timeline__item">
      <span class="activity-icon" data-category="${getActivityCategory(activity.type)}">${icon(getActivityIcon(activity.type))}</span>
      <div>
        <p class="timeline__title">${escapeHTML(title)} · ${escapeHTML(describeAmount(activity.value, activity.unit))}</p>
        <p class="timeline__meta">
          <span>${escapeHTML(CATEGORIES[getActivityCategory(activity.type)].label)}</span>
          <span><time datetime="${escapeHTML(activity.date)}">${formatRelativeDay(activity.date)}, ${formatTime(activity.date)}</time></span>
          ${challenge ? `<span><a href="${challengeUrl(challenge.id)}">${escapeHTML(challenge.title)}</a></span>` : ''}
          ${activity.description ? `<span>${escapeHTML(activity.description)}</span>` : ''}
        </p>
      </div>
      <span class="points-tag" data-zero="${activity.points === 0}">+${formatNumber(activity.points)} pts</span>
    </li>`;
}

/** Badge tile (locked or unlocked). */
export function badgeTile(item) {
  const { badge, unlocked, unlockedAt, current, target } = item;
  return `
    <article class="badge-tile" data-locked="${!unlocked}">
      ${unlocked ? '' : `<span class="badge-tile__lock" aria-hidden="true">${icon('lock')}</span>`}
      <img src="${escapeHTML(badge.icon)}" alt="" width="72" height="72" loading="lazy" decoding="async">
      <h3>${escapeHTML(badge.name)}</h3>
      <p>${escapeHTML(badge.description)}</p>
      ${unlocked
        ? `<p class="badge-tile__date">${icon('check')} Unlocked${unlockedAt ? ` ${formatDate(unlockedAt)}` : ''}</p>`
        : `${progressBar(current, target, `${badge.name} progress`)}<p class="small muted tabular">${formatNumber(current)} / ${formatNumber(target)}</p>`}
      <span class="visually-hidden">${unlocked ? 'Unlocked' : 'Locked'}</span>
    </article>`;
}

/** Friendly empty state with optional action. */
export function emptyState({ title, text = '', action = '', compact = false, image = 'static/assets/images/backgrounds/empty-state.webp' }) {
  return `
    <div class="empty-state ${compact ? 'empty-state--compact' : ''}">
      <img src="${image}" alt="" width="140" height="113" loading="lazy" decoding="async">
      <h3>${escapeHTML(title)}</h3>
      ${text ? `<p>${escapeHTML(text)}</p>` : ''}
      ${action}
    </div>`;
}

/** Statistic tile. */
export function statTile({ iconName, label, value, meta = '', feature = false }) {
  return `
    <article class="stat ${feature ? 'stat--feature' : ''}">
      <span class="stat__icon">${icon(iconName)}</span>
      <p class="stat__value">${value}</p>
      <h3 class="stat__label">${escapeHTML(label)}</h3>
      ${meta ? `<p class="stat__meta">${meta}</p>` : ''}
    </article>`;
}

/** Trend indicator comparing two values. */
export function trend(current, previous, suffix = 'vs last week') {
  if (!previous && !current) return `<span class="trend trend--flat">No change ${suffix}</span>`;
  if (!previous) return `<span class="trend trend--up">${icon('arrow-up')} New ${suffix}</span>`;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return `<span class="trend trend--flat">Same as last week</span>`;
  const dir = change > 0 ? 'up' : 'down';
  return `<span class="trend trend--${dir}">${icon(dir === 'up' ? 'arrow-up' : 'arrow-down')} ${Math.abs(change)}% ${suffix}</span>`;
}

/** Avatar + name block. Respects the profile visibility setting when `respectPrivacy` is true. */
export function personBlock(user, { meta = '', size = '', respectPrivacy = false, isCurrent = false } = {}) {
  const hidden = respectPrivacy && !isCurrent && user.privacy && user.privacy.profileVisible === false;
  const name = hidden ? 'Private member' : user.name;
  const avatar = hidden ? 'static/assets/images/avatars/avatar-private.svg' : user.avatar;
  return `
    <div class="person">
      <img class="avatar ${size ? `avatar--${size}` : ''}" src="${escapeHTML(avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async">
      <div>
        <p class="person__name">${escapeHTML(name)}${isCurrent ? ' <span class="pill">You</span>' : ''}</p>
        ${meta ? `<p class="person__meta">${meta}</p>` : ''}
      </div>
    </div>`;
}

/** Rank movement indicator for leaderboards. */
export function movementBadge(movement) {
  const labels = { up: `Up ${movement.change}`, down: `Down ${movement.change}`, same: 'No change', new: 'New' };
  const iconName = { up: 'arrow-up', down: 'arrow-down', same: 'minus', new: 'sparkle' }[movement.dir];
  return `<span class="movement" data-dir="${movement.dir}" title="Rank change since last week">${icon(iconName)}<span>${movement.dir === 'up' || movement.dir === 'down' ? movement.change : movement.dir === 'new' ? 'New' : ''}</span><span class="visually-hidden">${labels[movement.dir]}</span></span>`;
}
