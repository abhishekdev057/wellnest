/**
 * utils.js
 * Small, reusable helpers shared by every page:
 * DOM shortcuts, safe HTML escaping, date handling, number formatting,
 * validation patterns (regular expressions) and misc helpers.
 */

/* ---------------- DOM helpers ---------------- */

/** Select a single element (defaults to document). */
export const $ = (selector, scope = document) => scope.querySelector(selector);

/** Select all matching elements as a real array (so we can use array methods). */
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/**
 * Escape text before inserting it into an HTML string.
 * Every piece of user-provided data passes through this to prevent HTML injection.
 */
export function escapeHTML(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/** Returns the markup for an icon from the local SVG sprite. */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="static/assets/icons/sprite.svg#${name}"></use></svg>`;
}

/** Create an element from an HTML string (first element only). */
export function htmlToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/** Calls `callback` at most once every `wait` ms after the last call. */
export function debounce(callback, wait = 250) {
  let timerId;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => callback(...args), wait);
  };
}

/** Announce a message to screen readers through the shared live region. */
export function announce(message) {
  const region = document.getElementById('sr-announcer');
  if (!region) return;
  region.textContent = '';
  // Small delay so repeated identical messages are still announced.
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}

/* ---------------- Date helpers ----------------
 * Dates are stored as local "YYYY-MM-DD" strings and date-times as
 * "YYYY-MM-DDTHH:mm". Parsing them manually avoids UTC off-by-one bugs. */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad = (number) => String(number).padStart(2, '0');

/** Convert a Date into a "YYYY-MM-DD" key using local time. */
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Convert a Date into a "YYYY-MM-DDTHH:mm" local date-time string. */
export function toDateTimeString(date = new Date()) {
  return `${toDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as a local Date. Returns null when invalid. */
export function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hours = '0', minutes = '0'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
  // Reject impossible dates such as 2026-02-31 (JS would roll them over).
  if (date.getMonth() !== Number(month) - 1) return null;
  return date;
}

/** Today's date at local midnight. */
export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Return a new Date shifted by a number of days. */
export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Whole calendar days from `from` to `to` (both treated as dates). */
export function daysBetween(from, to) {
  const a = typeof from === 'string' ? parseDate(from) : from;
  const b = typeof to === 'string' ? parseDate(to) : to;
  if (!a || !b) return 0;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / MS_PER_DAY);
}

/** Shift a stored date or date-time string by `days`, keeping its format. */
export function shiftDateString(value, days) {
  const date = parseDate(value);
  if (!date) return value;
  const shifted = addDays(date, days);
  return value.includes('T') ? toDateTimeString(shifted) : toDateKey(shifted);
}

const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const longDateFormatter = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const weekdayFormatter = new Intl.DateTimeFormat('en-IN', { weekday: 'short' });

export const formatDate = (value) => {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return date ? dateFormatter.format(date) : '—';
};
export const formatShortDate = (value) => {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return date ? shortDateFormatter.format(date) : '—';
};
export const formatLongDate = (date = new Date()) => longDateFormatter.format(date);
export const formatTime = (value) => {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return date ? timeFormatter.format(date) : '';
};
export const formatWeekday = (date) => weekdayFormatter.format(date);

/** "Today", "Yesterday", "3 days ago" or a formatted date. */
export function formatRelativeDay(value) {
  const diff = daysBetween(value.slice(0, 10), toDateKey());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  if (diff === -1) return 'Tomorrow';
  return formatDate(value);
}

/** Converts "21:30" into "9:30 pm". */
export function formatClock(time) {
  if (!PATTERNS.time.test(time || '')) return time || '';
  const [hours, minutes] = time.split(':').map(Number);
  return timeFormatter.format(new Date(2000, 0, 1, hours, minutes));
}

/** Morning / afternoon / evening greeting based on the current hour. */
export function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---------------- Number & text formatting ---------------- */

const numberFormatter = new Intl.NumberFormat('en-IN');
export const formatNumber = (value) => numberFormatter.format(Math.round(Number(value) || 0));

/** Formats a value with up to one decimal place (e.g. kilometres). */
export function formatValue(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? formatNumber(number) : number.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export const pluralize = (count, singular, plural = `${singular}s`) => `${formatNumber(count)} ${count === 1 ? singular : plural}`;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const percent = (part, whole) => (whole > 0 ? clamp(Math.round((part / whole) * 100), 0, 100) : 0);

export const firstName = (fullName = '') => fullName.trim().split(/\s+/)[0] || 'there';

/** "movement-week" -> "Movement Week" */
export const titleCase = (text = '') => text.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

/** Turn a title into a URL-friendly id: "Step Up Sprint!" -> "step-up-sprint" */
export function slugify(text = '') {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Generate a reasonably unique id with a readable prefix. */
export function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${Date.now().toString(36)}${random}`;
}

/* ---------------- Validation patterns ----------------
 * Regular expressions used by the forms across the application. */
export const PATTERNS = {
  personName: /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]{1,49}$/,
  email: /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/,
  dateKey: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  positiveNumber: /^\d+(\.\d{1,2})?$/,
  integer: /^\d+$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  // Plain text: letters, numbers, spaces and common punctuation — no angle brackets.
  safeText: /^[^<>{}\\]*$/,
};

/** Reads URL query parameters, e.g. getQueryParam('id'). */
export const getQueryParam = (name) => new URLSearchParams(window.location.search).get(name);

/** Group an array into an object keyed by the result of `getKey`. */
export function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  }, {});
}

/** Sum a numeric property (or the result of a function) over an array. */
export function sumBy(items, getValue) {
  return items.reduce((total, item) => total + (Number(getValue(item)) || 0), 0);
}

/* ---------------- Form helpers ----------------
 * Convention used by every form:
 *   <input name="title" aria-describedby="x-title-error">
 *   <p class="field-error" id="x-title-error" data-error-for="title"></p>
 */

/** Markup for an error message slot linked to a field. */
export const fieldError = (formId, name) =>
  `<p class="field-error" id="${formId}-${name}-error" data-error-for="${name}"></p>`;

/** aria-describedby value for a field's error (and optional hint). */
export const describedBy = (formId, name, withHint = false) =>
  `${formId}-${name}-error${withHint ? ` ${formId}-${name}-hint` : ''}`;

/**
 * Display validation errors next to their fields.
 * @returns {HTMLElement|null} the first invalid control (to move focus to)
 */
export function setFieldErrors(form, errors = {}) {
  let firstInvalid = null;
  form.querySelectorAll('[data-error-for]').forEach((slot) => {
    const name = slot.dataset.errorFor;
    const message = errors[name] || '';
    slot.textContent = message;
    form.querySelectorAll(`[name="${name}"]`).forEach((control) => {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
      if (message && !firstInvalid) firstInvalid = control;
    });
  });
  const alertBox = form.querySelector('[data-form-alert]');
  if (alertBox) {
    alertBox.textContent = errors.form || '';
    alertBox.hidden = !errors.form;
  }
  return firstInvalid;
}

/** Read a form into a plain object. Checkbox groups become arrays when listed in `arrayFields`. */
export function readForm(form, arrayFields = []) {
  const data = new FormData(form);
  const result = {};
  data.forEach((value, key) => {
    if (arrayFields.includes(key)) (result[key] = result[key] || []).push(value);
    else result[key] = typeof value === 'string' ? value : '';
  });
  arrayFields.forEach((key) => {
    result[key] = result[key] || [];
  });
  return result;
}
