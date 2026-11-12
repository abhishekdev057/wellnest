/**
 * activity-form.js
 * Reusable "Log activity" form displayed in a modal.
 * Can be opened from any page (header button, dashboard, challenge page…).
 *
 * Flow on submit:
 *   validate (HTML attributes + JavaScript rules) -> logActivity() ->
 *   state commit (progress, completion, badges, streaks, leaderboard all
 *   recalculate automatically) -> success toasts.
 */
import { getState } from '../app.js';
import { logActivity, validateActivityInput, previewActivityPoints } from '../actions.js';
import {
  ACTIVITY_TYPES, UNIT_LABELS, MAX_BACKDATE_DAYS, DAILY_POINT_CAP,
  getChallenge, getEligibleChallengesForActivity, getChallengeUnit, describeTarget,
} from '../engine.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';
import {
  escapeHTML, icon, toDateKey, toDateTimeString, addDays, startOfToday, formatNumber,
  fieldError, describedBy, setFieldErrors, readForm, announce,
} from '../utils.js';

const FORM_ID = 'activity-form';

function typeOptionsMarkup(selectedType) {
  return Object.entries(ACTIVITY_TYPES)
    .map(([key, type]) => `
      <label class="option-card">
        <input type="radio" name="type" value="${key}" ${key === selectedType ? 'checked' : ''} required aria-describedby="${describedBy(FORM_ID, 'type')}">
        <span class="option-card__body" data-category="${type.category}">${icon(type.icon)}${escapeHTML(type.label)}</span>
      </label>`)
    .join('');
}

function buildFormMarkup(selectedType) {
  const today = toDateKey();
  const minDate = toDateKey(addDays(startOfToday(), -MAX_BACKDATE_DAYS));
  const now = toDateTimeString().slice(11);
  return `
    <form id="${FORM_ID}" class="form" novalidate>
      <p class="form-alert" data-form-alert role="alert" hidden></p>

      <fieldset>
        <legend class="required">Activity type</legend>
        <div class="option-grid">${typeOptionsMarkup(selectedType)}</div>
        ${fieldError(FORM_ID, 'type')}
      </fieldset>

      <div class="form-grid">
        <div class="field">
          <label for="${FORM_ID}-date" class="required">Date</label>
          <input class="input" type="date" id="${FORM_ID}-date" name="date" value="${today}" min="${minDate}" max="${today}" required aria-describedby="${describedBy(FORM_ID, 'date')}">
          ${fieldError(FORM_ID, 'date')}
        </div>
        <div class="field">
          <label for="${FORM_ID}-time" class="required">Time</label>
          <input class="input" type="time" id="${FORM_ID}-time" name="time" value="${now}" required aria-describedby="${describedBy(FORM_ID, 'time')}">
          ${fieldError(FORM_ID, 'time')}
        </div>

        <div class="field field--full">
          <label for="${FORM_ID}-value" class="required">Duration or quantity</label>
          <div class="input-group">
            <input class="input" type="number" inputmode="decimal" id="${FORM_ID}-value" name="value" required aria-describedby="${describedBy(FORM_ID, 'value', true)}">
            <label for="${FORM_ID}-unit" class="visually-hidden">Unit</label>
            <select class="select" id="${FORM_ID}-unit" name="unit" required aria-describedby="${describedBy(FORM_ID, 'unit')}"></select>
          </div>
          <p class="hint" id="${FORM_ID}-value-hint" data-value-hint></p>
          ${fieldError(FORM_ID, 'value')}
          ${fieldError(FORM_ID, 'unit')}
        </div>

        <div class="field field--full">
          <label for="${FORM_ID}-challenge">Count toward a challenge</label>
          <select class="select" id="${FORM_ID}-challenge" name="challengeId" aria-describedby="${describedBy(FORM_ID, 'challengeId', true)}"></select>
          <p class="hint" id="${FORM_ID}-challengeId-hint" data-challenge-hint></p>
          ${fieldError(FORM_ID, 'challengeId')}
        </div>

        <div class="field field--full">
          <label for="${FORM_ID}-description">Note <span class="muted">(optional)</span></label>
          <textarea class="textarea" id="${FORM_ID}-description" name="description" maxlength="200" rows="2" placeholder="e.g. Morning loop around the lake" aria-describedby="${describedBy(FORM_ID, 'description', true)}"></textarea>
          <p class="hint" id="${FORM_ID}-description-hint"><span data-char-count>0</span>/200 characters · No health or medical details, please.</p>
          ${fieldError(FORM_ID, 'description')}
        </div>
      </div>

      <div class="points-preview" aria-live="polite">
        ${icon('star', 'icon--lg')}
        <div><strong data-points-value>0</strong> <span data-points-text>points for this activity</span></div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-close-modal>Cancel</button>
        <button type="submit" class="btn btn--primary">${icon('check')} Save activity</button>
      </div>
    </form>`;
}

/**
 * Open the activity form.
 * @param {object} [options]
 * @param {string} [options.challengeId] pre-select a challenge
 * @param {string} [options.type] pre-select an activity type
 */
export function openActivityForm({ challengeId = '', type = '' } = {}) {
  const state = getState();
  if (!state) return;
  const presetChallenge = challengeId ? getChallenge(state, challengeId) : null;
  const initialType = ACTIVITY_TYPES[type] ? type : presetChallenge ? presetChallenge.activityTypes[0] : 'walking';

  const modal = openModal({
    title: 'Log an activity',
    description: 'Record what you did today. Points, streaks and challenge progress update instantly.',
    content: buildFormMarkup(initialType),
    size: 'lg',
  });

  const form = modal.body.querySelector('form');
  const valueInput = form.elements.value;
  const unitSelect = form.elements.unit;
  const challengeSelect = form.elements.challengeId;
  const valueHint = form.querySelector('[data-value-hint]');
  const challengeHint = form.querySelector('[data-challenge-hint]');

  const getSelectedType = () => (form.querySelector('input[name="type"]:checked') || {}).value || '';

  /** Apply min / max / step attributes for the selected type + unit. */
  function syncValueConstraints() {
    const typeConfig = ACTIVITY_TYPES[getSelectedType()];
    const rule = typeConfig && typeConfig.units[unitSelect.value];
    if (!rule) return;
    valueInput.min = rule.min;
    valueInput.max = rule.max;
    valueInput.step = rule.step;
    valueInput.placeholder = `${formatNumber(rule.min)}–${formatNumber(rule.max)}`;
    valueHint.textContent = `Between ${formatNumber(rule.min)} and ${formatNumber(rule.max)} ${UNIT_LABELS[unitSelect.value]} per entry.`;
  }

  /** Rebuild unit and challenge options when the activity type changes. */
  function syncTypeDependentFields(preferredChallengeId = '') {
    const currentState = getState();
    const selectedType = getSelectedType();
    const typeConfig = ACTIVITY_TYPES[selectedType];
    if (!typeConfig) return;

    const previousUnit = unitSelect.value;
    unitSelect.innerHTML = Object.keys(typeConfig.units)
      .map((unit) => `<option value="${unit}">${UNIT_LABELS[unit]}</option>`)
      .join('');
    if (typeConfig.units[previousUnit]) unitSelect.value = previousUnit;

    const eligible = getEligibleChallengesForActivity(currentState, currentState.currentUserId, selectedType);
    challengeSelect.innerHTML = `<option value="">No challenge — points only</option>${eligible
      .map((c) => `<option value="${c.id}">${escapeHTML(c.title)} · ${escapeHTML(describeTarget(c))}</option>`)
      .join('')}`;

    const keep = eligible.find((c) => c.id === (preferredChallengeId || challengeSelect.dataset.lastValue));
    challengeSelect.value = keep ? keep.id : eligible[0] ? eligible[0].id : '';
    challengeHint.textContent = eligible.length
      ? `${eligible.length} of your active challenges accept ${typeConfig.label.toLowerCase()}.`
      : `None of your active challenges accept ${typeConfig.label.toLowerCase()} — you will still earn points.`;
    syncUnitWithChallenge();
  }

  /** When a challenge is chosen, switch to the unit it counts. */
  function syncUnitWithChallenge() {
    const selected = getChallenge(getState(), challengeSelect.value);
    challengeSelect.dataset.lastValue = challengeSelect.value;
    if (selected) {
      const unit = getChallengeUnit(selected);
      if ([...unitSelect.options].some((option) => option.value === unit)) unitSelect.value = unit;
    }
    syncValueConstraints();
    updatePointsPreview();
  }

  function updatePointsPreview() {
    const input = readForm(form);
    const { base, awarded, capped } = previewActivityPoints(getState(), input);
    form.querySelector('[data-points-value]').textContent = formatNumber(awarded);
    form.querySelector('[data-points-text]').textContent = capped
      ? `points (daily limit of ${DAILY_POINT_CAP} for this activity type reached; ${formatNumber(base)} without the cap)`
      : 'points for this activity';
  }

  // Event delegation for all input changes inside the form.
  form.addEventListener('change', (event) => {
    if (event.target.name === 'type') syncTypeDependentFields();
    else if (event.target.name === 'challengeId') syncUnitWithChallenge();
    else if (event.target.name === 'unit') {
      syncValueConstraints();
      updatePointsPreview();
    } else updatePointsPreview();
  });

  form.addEventListener('input', (event) => {
    if (event.target.name === 'value') updatePointsPreview();
    if (event.target.name === 'description') {
      form.querySelector('[data-char-count]').textContent = event.target.value.length;
    }
    // Clear a field's error as soon as the user edits it.
    if (event.target.getAttribute('aria-invalid') === 'true') {
      event.target.removeAttribute('aria-invalid');
      const slot = form.querySelector(`[data-error-for="${event.target.name}"]`);
      if (slot) slot.textContent = '';
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readForm(form);
    const errors = validateActivityInput(getState(), input);
    // Also respect the browser's built-in constraint validation for the value field.
    if (!errors.value && valueInput.validity.rangeOverflow) errors.value = `The maximum is ${valueInput.max}.`;
    if (!errors.value && valueInput.validity.rangeUnderflow) errors.value = `The minimum is ${valueInput.min}.`;

    if (Object.keys(errors).length) {
      const firstInvalid = setFieldErrors(form, errors);
      if (firstInvalid) firstInvalid.focus();
      announce('The activity could not be saved. Please review the highlighted fields.');
      return;
    }

    const result = logActivity(input);
    if (!result.ok) {
      const firstInvalid = setFieldErrors(form, { ...result.errors, form: result.message });
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    modal.close();
    const typeLabel = ACTIVITY_TYPES[input.type].label;
    showToast({
      type: 'success',
      title: `${typeLabel} logged · +${formatNumber(result.points)} points`,
      message: result.capped
        ? `You reached today's ${DAILY_POINT_CAP}-point limit for ${typeLabel.toLowerCase()}, so only part of this entry earned points.`
        : result.activity.challengeId
          ? `Progress added to ${getChallenge(getState(), result.activity.challengeId).title}.`
          : 'Keep the momentum going!',
    });
    if (result.completedChallenge) {
      showToast({
        type: 'badge',
        title: `Challenge complete: ${result.completedChallenge.title}!`,
        message: `You earned a ${formatNumber(result.completedChallenge.rewardPoints)}-point completion bonus.`,
        image: 'static/assets/images/badges/challenge-finisher.webp',
        duration: 8000,
      });
    }
  });

  syncTypeDependentFields(presetChallenge ? presetChallenge.id : '');
}
