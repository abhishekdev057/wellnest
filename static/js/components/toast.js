/**
 * toast.js
 * Non-blocking notifications shown in the bottom-right corner.
 * The container is an ARIA live region so screen readers announce messages.
 */
import { escapeHTML, icon } from '../utils.js';

const ICONS = { success: 'check', error: 'alert', warning: 'alert', info: 'info', badge: 'award' };
let region = null;

function getRegion() {
  if (region && document.body.contains(region)) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-relevant', 'additions');
  document.body.appendChild(region);
  return region;
}

function dismiss(toast) {
  if (!toast || toast.classList.contains('is-leaving')) return;
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), 260);
}

/**
 * Show a toast.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {'success'|'error'|'warning'|'info'|'badge'} [options.type]
 * @param {number} [options.duration] milliseconds before auto-dismiss (0 = stay)
 * @param {string} [options.image] optional image path (used for badges)
 */
export function showToast({ title, message = '', type = 'success', duration = 4500, image = '' }) {
  const container = getRegion();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.type = type;
  // Errors interrupt the screen reader; everything else is polite.
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const iconMarkup = image
    ? `<img src="${escapeHTML(image)}" alt="" width="30" height="30">`
    : icon(ICONS[type] || 'info');

  toast.innerHTML = `
    <span class="toast__icon">${iconMarkup}</span>
    <div>
      <p class="toast__title">${escapeHTML(title)}</p>
      ${message ? `<p class="toast__message">${escapeHTML(message)}</p>` : ''}
    </div>
    <button type="button" class="icon-btn icon-btn--sm" aria-label="Dismiss notification">${icon('x')}</button>`;

  toast.querySelector('button').addEventListener('click', () => dismiss(toast));
  container.appendChild(toast);

  // Keep at most four toasts on screen.
  const toasts = container.querySelectorAll('.toast:not(.is-leaving)');
  if (toasts.length > 4) dismiss(toasts[0]);

  if (duration > 0) {
    let timerId = setTimeout(() => dismiss(toast), duration);
    // Pause auto-dismiss while the pointer is over the toast.
    toast.addEventListener('mouseenter', () => clearTimeout(timerId));
    toast.addEventListener('mouseleave', () => {
      timerId = setTimeout(() => dismiss(toast), 2000);
    });
  }
  return toast;
}
