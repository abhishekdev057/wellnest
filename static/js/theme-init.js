/*
 * theme-init.js
 * Loaded synchronously in <head> (not as a module) so the saved theme is
 * applied before the first paint, preventing a flash of the wrong theme.
 */
(function () {
  var preference = 'system';
  try {
    preference = localStorage.getItem('wellnest_app_v1:theme') || 'system';
  } catch (error) {
    preference = 'system';
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = preference === 'dark' || (preference === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-preference', preference);
})();
