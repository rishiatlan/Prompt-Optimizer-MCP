/* ═══════════════════════════════════════════════════════════════════════════
   Prompt Optimizer — Shared JS
   Theme toggle (dark/light), mobile nav toggle
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Theme Toggle ─────────────────────────────────────────────────────
  const THEME_KEY = 'po-theme';

  function getPreferred() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  // Apply immediately (before paint)
  applyTheme(getPreferred());

  document.addEventListener('DOMContentLoaded', function () {
    // Re-apply in case of race
    applyTheme(getPreferred());

    // Bind toggle button(s)
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme') || 'dark';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
    });

    // ─── Mobile Nav Toggle ────────────────────────────────────────────
    var toggle = document.querySelector('.nav-toggle');
    var links = document.querySelector('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', function () {
        links.classList.toggle('open');
      });
      // Close on link click
      links.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          links.classList.remove('open');
        });
      });
    }
  });
})();
