/**
 * modal.js
 * Accessible dialog component.
 *  - role="dialog" + aria-modal + aria-labelledby
 *  - focus moves into the dialog and is trapped while it is open
 *  - Escape, the close button or a backdrop click closes it
 *  - focus returns to the element that opened it
 *  - supports stacking (e.g. a confirmation on top of a form)
 */
import { escapeHTML, icon } from '../utils.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openModals = [];
let modalCounter = 0;

function getFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** Single keyboard handler that always acts on the top-most modal. */
function handleKeydown(event) {
  const top = openModals[openModals.length - 1];
  if (!top) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    top.close();
    return;
  }

  if (event.key === 'Tab') {
    const focusable = getFocusable(top.dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/**
 * Open a modal dialog.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string|Node} options.content HTML string or DOM node for the body
 * @param {'sm'|'md'|'lg'} [options.size]
 * @param {Function} [options.onClose]
 * @returns {{ dialog: HTMLElement, body: HTMLElement, close: Function }}
 */
export function openModal({ title, description = '', content = '', size = 'md', onClose = null }) {
  modalCounter += 1;
  const titleId = `modal-title-${modalCounter}`;
  const descriptionId = `modal-desc-${modalCounter}`;
  const previouslyFocused = document.activeElement;

  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `
    <div class="modal-backdrop" data-close-modal></div>
    <div class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" ${description ? `aria-describedby="${descriptionId}"` : ''}>
      <header class="modal__header">
        <div>
          <h2 id="${titleId}">${escapeHTML(title)}</h2>
          ${description ? `<p id="${descriptionId}">${escapeHTML(description)}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close-modal aria-label="Close dialog">${icon('x')}</button>
      </header>
      <div class="modal__body"></div>
    </div>`;

  const dialog = root.querySelector('.modal');
  const body = root.querySelector('.modal__body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (content instanceof Node) body.appendChild(content);

  let closed = false;
  const instance = {
    dialog,
    body,
    root,
    close(result) {
      if (closed) return;
      closed = true;
      const index = openModals.indexOf(instance);
      if (index !== -1) openModals.splice(index, 1);
      dialog.classList.add('is-closing');
      setTimeout(() => {
        root.remove();
        if (openModals.length === 0) {
          document.body.classList.remove('has-modal');
          document.removeEventListener('keydown', handleKeydown);
        }
        if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
        if (typeof onClose === 'function') onClose(result);
      }, 120);
    },
  };

  // Close on backdrop / close button using event delegation.
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]')) instance.close();
  });

  if (openModals.length === 0) {
    document.addEventListener('keydown', handleKeydown);
    document.body.classList.add('has-modal');
  }
  openModals.push(instance);
  document.body.appendChild(root);

  // Move focus inside: prefer an element marked data-autofocus.
  requestAnimationFrame(() => {
    const preferred = dialog.querySelector('[data-autofocus]');
    const focusable = getFocusable(body);
    (preferred || focusable[0] || dialog.querySelector('[data-close-modal].icon-btn')).focus();
  });

  return instance;
}

/**
 * Promise-based confirmation dialog.
 * @returns {Promise<boolean>} resolves true when confirmed.
 */
export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', tone = 'default', iconName = 'info' }) {
  return new Promise((resolve) => {
    let answered = false;
    const content = `
      <div class="confirm-icon" data-tone="${tone}">${icon(tone === 'danger' ? 'alert' : iconName, 'icon--lg')}</div>
      <p class="muted">${escapeHTML(message)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-answer="no">${escapeHTML(cancelText)}</button>
        <button type="button" class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" data-answer="yes" data-autofocus>${escapeHTML(confirmText)}</button>
      </div>`;

    const modal = openModal({
      title,
      content,
      size: 'sm',
      onClose: () => {
        if (!answered) resolve(false);
      },
    });

    modal.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-answer]');
      if (!button) return;
      answered = true;
      resolve(button.dataset.answer === 'yes');
      modal.close();
    });
  });
}
