(function () {
  function getStoredTheme() {
    try {
      return localStorage.getItem('vmp-theme');
    } catch {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem('vmp-theme', theme);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function resolveTheme() {
    const stored = getStoredTheme();
    if (stored === 'light' || stored === 'dark') return stored;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  function applyThemeShots(theme) {
    document.querySelectorAll('.theme-shot').forEach((img) => {
      const nextSrc =
        theme === 'dark'
          ? img.getAttribute('data-dark-src')
          : img.getAttribute('data-light-src');
      if (nextSrc && img.getAttribute('src') !== nextSrc) {
        img.setAttribute('src', nextSrc);
      }
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    applyThemeShots(theme);

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const isDark = theme === 'dark';
      btn.setAttribute('aria-pressed', String(isDark));
      btn.setAttribute(
        'aria-label',
        isDark ? 'Switch to light mode' : 'Switch to dark mode'
      );
    });
  }

  // Script is at end of body — apply screenshot sources before paint settles.
  applyTheme(resolveTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('year');
    if (yearEl) {
      yearEl.textContent = String(new Date().getFullYear());
    }

    const scrollButtons = document.querySelectorAll('[data-scroll-target]');
    scrollButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetSelector = btn.getAttribute('data-scroll-target');
        if (!targetSelector) return;
        const target = document.querySelector(targetSelector);
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        {
          threshold: 0.2,
        }
      );

      document.querySelectorAll('.fade-on-scroll').forEach((el) => {
        observer.observe(el);
      });
    } else {
      document
        .querySelectorAll('.fade-on-scroll')
        .forEach((el) => el.classList.add('is-visible'));
    }

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const current =
          document.documentElement.getAttribute('data-theme') === 'dark'
            ? 'dark'
            : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        storeTheme(next);
        applyTheme(next);
      });
    });
  });
})();
