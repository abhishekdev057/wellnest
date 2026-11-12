/**
 * navigation.js
 * Renders the shared header, mobile drawer, bottom tab bar and footer
 * from configuration arrays, so every page has identical navigation.
 */
import { escapeHTML, icon, $ } from './utils.js';

const APP_LINKS = [
  { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' },
  { id: 'challenges', label: 'Challenges', href: 'challenges.html', icon: 'flag' },
  { id: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html', icon: 'trophy' },
  { id: 'profile', label: 'Profile', href: 'profile.html', icon: 'user' },
  { id: 'organizer', label: 'Organizer', href: 'organizer.html', icon: 'clipboard' },
];

const LANDING_LINKS = [
  { id: 'challenges', label: 'Challenges', href: 'challenges.html', icon: 'flag' },
  { id: 'how', label: 'How it works', href: 'index.html#how-it-works', icon: 'info' },
  { id: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html', icon: 'trophy' },
  { id: 'organizer', label: 'For organizers', href: 'organizer.html', icon: 'clipboard' },
];

const DRAWER_EXTRA = [{ id: 'settings', label: 'Settings', href: 'settings.html', icon: 'settings' }];

const TAB_BAR = [
  { id: 'dashboard', label: 'Home', href: 'dashboard.html', icon: 'grid' },
  { id: 'challenges', label: 'Challenges', href: 'challenges.html', icon: 'flag' },
  { id: 'log', label: 'Log', icon: 'plus' },
  { id: 'leaderboard', label: 'Ranks', href: 'leaderboard.html', icon: 'trophy' },
  { id: 'profile', label: 'Profile', href: 'profile.html', icon: 'user' },
];

/** Challenge detail pages belong to the "Challenges" section. */
const SECTION_FOR_PAGE = { 'challenge-detail': 'challenges' };

const navLink = (link, activeId) => `
  <li>
    <a class="nav-link" href="${link.href}" ${link.id === activeId ? 'aria-current="page"' : ''}>
      ${icon(link.icon)}<span>${escapeHTML(link.label)}</span>
    </a>
  </li>`;

/* ---------------- Mobile drawer ---------------- */

let drawerReturnFocus = null;

function openDrawer() {
  const drawer = $('#mobile-drawer');
  const toggle = $('.menu-toggle');
  if (!drawer) return;
  drawerReturnFocus = document.activeElement;
  drawer.classList.add('is-open');
  drawer.removeAttribute('hidden');
  toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('has-modal');
  drawer.querySelector('.mobile-drawer__panel a, .mobile-drawer__panel button').focus();
}

function closeDrawer() {
  const drawer = $('#mobile-drawer');
  const toggle = $('.menu-toggle');
  if (!drawer || !drawer.classList.contains('is-open')) return;
  drawer.classList.remove('is-open');
  drawer.setAttribute('hidden', '');
  toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('has-modal');
  if (drawerReturnFocus) drawerReturnFocus.focus();
}

/* ---------------- Header ---------------- */

export function renderHeader(pageId) {
  const header = document.getElementById('site-header');
  if (!header) return;
  const isLanding = pageId === 'home';
  const activeId = SECTION_FOR_PAGE[pageId] || pageId;
  const links = isLanding ? LANDING_LINKS : APP_LINKS;

  const primaryAction = isLanding
    ? `<a class="btn btn--primary btn--sm header-cta" href="dashboard.html">Open dashboard</a>`
    : pageId === 'organizer'
      ? `<button type="button" class="btn btn--accent btn--sm header-cta" data-action="new-challenge">${icon('plus')}<span>New challenge</span></button>`
      : `<button type="button" class="btn btn--accent btn--sm header-cta" data-action="log-activity">${icon('plus')}<span>Log activity</span></button>`;

  header.innerHTML = `
    <div class="container header-inner">
      <a class="brand" href="index.html" aria-label="Wellnest home">
        <img src="static/assets/images/logo-mark.webp" alt="" width="34" height="34">
        <span>Wellnest</span>
      </a>
      <nav class="primary-nav" aria-label="Main">
        <ul class="nav-list" role="list">${links.map((link) => navLink(link, activeId)).join('')}</ul>
      </nav>
      <div class="header-actions">
        ${primaryAction}
        ${isLanding || pageId === 'organizer' ? '' : '<div class="notifications" data-notifications></div>'}
        <button type="button" class="icon-btn" data-theme-toggle aria-label="Switch to dark theme">${icon('moon')}</button>
        ${isLanding ? '' : `<a class="header-avatar" href="${pageId === 'organizer' ? 'organizer.html' : 'profile.html'}" data-header-avatar aria-label="Your profile"><img src="static/assets/images/avatars/avatar-01.svg" alt="" width="34" height="34"></a>`}
        <button type="button" class="icon-btn menu-toggle" aria-expanded="false" aria-controls="mobile-drawer" aria-label="Open menu">${icon('menu')}</button>
      </div>
    </div>`;

  // Mobile drawer (all links + settings)
  const drawerLinks = [...(isLanding ? [{ id: 'home', label: 'Home', href: 'index.html', icon: 'home' }, ...LANDING_LINKS, { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'grid' }] : APP_LINKS), ...DRAWER_EXTRA];
  const drawer = document.createElement('div');
  drawer.className = 'mobile-drawer';
  drawer.id = 'mobile-drawer';
  drawer.setAttribute('hidden', '');
  drawer.innerHTML = `
    <div class="mobile-drawer__backdrop" data-close-drawer></div>
    <div class="mobile-drawer__panel" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="split">
        <a class="brand" href="index.html"><img src="static/assets/images/logo-mark.webp" alt="" width="30" height="30"><span>Wellnest</span></a>
        <button type="button" class="icon-btn" data-close-drawer aria-label="Close menu">${icon('x')}</button>
      </div>
      <nav aria-label="Mobile">
        <ul class="mobile-drawer__list" role="list">${drawerLinks.map((link) => navLink(link, activeId)).join('')}</ul>
      </nav>
      <div class="drawer-footer">
        <p class="small muted">Demo roles</p>
        <div class="role-switch" role="group" aria-label="Switch interface">
          <a href="dashboard.html" ${pageId !== 'organizer' ? 'aria-current="true"' : ''}>Participant</a>
          <a href="organizer.html" ${pageId === 'organizer' ? 'aria-current="true"' : ''}>Organizer</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(drawer);

  // Bottom tab bar on small screens (participant pages only)
  if (!isLanding && pageId !== 'organizer') {
    const tabBar = document.createElement('nav');
    tabBar.className = 'tab-bar';
    tabBar.setAttribute('aria-label', 'Quick navigation');
    tabBar.innerHTML = `<ul role="list">${TAB_BAR.map((tab) =>
      tab.id === 'log'
        ? `<li><button type="button" class="tab-bar__log" data-action="log-activity" aria-label="Log activity">${icon('plus')}</button></li>`
        : `<li><a href="${tab.href}" ${tab.id === activeId ? 'aria-current="page"' : ''}>${icon(tab.icon)}<span>${tab.label}</span></a></li>`,
    ).join('')}</ul>`;
    document.body.appendChild(tabBar);
    document.body.classList.add('has-tab-bar');
  }

  // Events
  header.querySelector('.menu-toggle').addEventListener('click', openDrawer);
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-drawer]')) closeDrawer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });

  // Subtle border once the page scrolls.
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/** Show the current user's avatar in the header. */
export function updateHeaderUser(user) {
  const link = document.querySelector('[data-header-avatar]');
  if (!link || !user) return;
  const img = link.querySelector('img');
  img.src = user.avatar;
  link.setAttribute('aria-label', user.role === 'organizer' ? `Organizer: ${user.name}` : `Your profile: ${user.name}`);
}

/** Update the theme toggle icon & label. */
export function updateThemeToggle(isDark) {
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    button.innerHTML = icon(isDark ? 'sun' : 'moon');
  });
}

/* ---------------- Footer ---------------- */

export function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  const year = new Date().getFullYear();
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a class="brand" href="index.html"><img src="static/assets/images/logo-mark.webp" alt="" width="32" height="32"><span>Wellnest</span></a>
          <p>Wellness challenges that make healthy habits social, simple and genuinely fun — for teams, campuses and communities.</p>
        </div>
        <div class="footer-col">
          <h2>Participate</h2>
          <ul>
            <li><a href="challenges.html">Browse challenges</a></li>
            <li><a href="dashboard.html">Dashboard</a></li>
            <li><a href="leaderboard.html">Leaderboard</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h2>Account</h2>
          <ul>
            <li><a href="profile.html">Profile</a></li>
            <li><a href="settings.html">Settings &amp; privacy</a></li>
            <li><a href="organizer.html">Organizer workspace</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h2>Learn</h2>
          <ul>
            <li><a href="index.html#how-it-works">How it works</a></li>
            <li><a href="index.html#categories">Wellness categories</a></li>
            <li><a href="settings.html#about">About this project</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; ${year} Wellnest. A CSE326 Internet Programming project built with HTML5, CSS3 and vanilla JavaScript.</p>
        <p>Wellnest offers non-clinical wellness challenges and does not provide medical advice.</p>
      </div>
    </div>`;
}
