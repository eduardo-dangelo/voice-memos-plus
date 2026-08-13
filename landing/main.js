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

  function getStoredDevice() {
    try {
      return localStorage.getItem('vmp-device');
    } catch {
      return null;
    }
  }

  function storeDevice(device) {
    try {
      localStorage.setItem('vmp-device', device);
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

  function resolveDevice() {
    const stored = getStoredDevice();
    if (stored === 'iphone' || stored === 'ipad') return stored;
    return 'iphone';
  }

  function shotAttr(device, theme) {
    return 'data-' + device + '-' + theme + '-src';
  }

  function applyShots() {
    const theme =
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark'
        : 'light';

    document.querySelectorAll('.theme-shot').forEach((img) => {
      const device = img.closest('.ipad-frame') ? 'ipad' : 'iphone';
      const nextSrc = img.getAttribute(shotAttr(device, theme));
      if (nextSrc && img.getAttribute('src') !== nextSrc) {
        img.setAttribute('src', nextSrc);
      }
    });
  }

  function applyBrandLogos() {
    const theme =
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? 'dark'
        : 'light';

    document.querySelectorAll('.theme-logo').forEach((img) => {
      const attr = theme === 'dark' ? 'data-dark-src' : 'data-light-src';
      const nextSrc = img.getAttribute(attr);
      if (nextSrc && img.getAttribute('src') !== nextSrc) {
        img.setAttribute('src', nextSrc);
      }
    });
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    applyShots();
    applyBrandLogos();

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const isDark = theme === 'dark';
      const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-pressed', String(isDark));
      btn.setAttribute('aria-label', label);
      btn.setAttribute('data-tooltip', label);
    });
  }

  function applyDevice(device) {
    document.documentElement.setAttribute('data-device', device);
    applyShots();

    document.querySelectorAll('[data-device-toggle]').forEach((btn) => {
      const isIpad = device === 'ipad';
      const label = isIpad ? 'Switch to iPhone' : 'Switch to iPad';
      btn.setAttribute('aria-pressed', String(isIpad));
      btn.setAttribute('aria-label', label);
      btn.setAttribute('data-tooltip', label);
    });
  }

  // Script is at end of body — apply screenshot sources before paint settles.
  applyTheme(resolveTheme());
  applyDevice(resolveDevice());

  document.querySelectorAll('.theme-shot').forEach((img) => {
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });
    img.addEventListener('load', () => {
      img.style.visibility = '';
    });
  });

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

    document.querySelectorAll('[data-device-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const current =
          document.documentElement.getAttribute('data-device') === 'ipad'
            ? 'ipad'
            : 'iphone';
        const next = current === 'ipad' ? 'iphone' : 'ipad';
        storeDevice(next);
        applyDevice(next);
      });
    });

    initSlideshow();
  });

  function initSlideshow() {
    const root = document.querySelector('[data-slideshow]');
    if (!root) return;

    const slides = Array.from(root.querySelectorAll('[data-slide-id]'));
    if (!slides.length) return;

    const prevBtn = root.querySelector('[data-slideshow-prev]');
    const nextBtn = root.querySelector('[data-slideshow-next]');
    const dots = Array.from(root.querySelectorAll('[data-slideshow-dot]'));
    const cards = Array.from(
      document.querySelectorAll('[data-slide-target]')
    );
    const live = root.querySelector('[data-slideshow-live]');

    let index = 0;
    let syncingHash = false;
    let autoTimer = null;
    let autoPaused = false;

    const intervalSeconds = parseFloat(root.getAttribute('data-slideshow-interval') || '5');
    const autoIntervalMs =
      Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? intervalSeconds * 1000
        : 0;
    const autoEnabled =
      autoIntervalMs > 0 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function slideIndexById(id) {
      return slides.findIndex((slide) => slide.getAttribute('data-slide-id') === id);
    }

    function setSlide(nextIndex, options) {
      const opts = options || {};
      const total = slides.length;
      const clamped = ((nextIndex % total) + total) % total;
      index = clamped;

      slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });

      dots.forEach((dot, i) => {
        const active = i === index;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-selected', String(active));
        dot.setAttribute('tabindex', active ? '0' : '-1');
      });

      const activeId = slides[index].getAttribute('data-slide-id');
      cards.forEach((card) => {
        const match = card.getAttribute('data-slide-target') === activeId;
        card.classList.toggle('is-active', match);
        if (match) {
          card.setAttribute('aria-current', 'true');
        } else {
          card.removeAttribute('aria-current');
        }
      });

      if (live) {
        const label =
          slides[index].querySelector('.eyebrow')?.textContent?.trim() ||
          'Feature ' + (index + 1);
        live.textContent = 'Showing ' + label + ', slide ' + (index + 1) + ' of ' + total;
      }

      if (opts.updateHash !== false && activeId) {
        syncingHash = true;
        const url = new URL(window.location.href);
        url.hash = activeId;
        history.replaceState(null, '', url.pathname + url.search + '#' + activeId);
        syncingHash = false;
      }

      if (opts.scroll) {
        const target =
          document.getElementById('feature-slideshow') || root;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function go(delta, options) {
      setSlide(index + delta, { updateHash: true, ...(options || {}) });
    }

    function stopAuto() {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    }

    function startAuto() {
      if (!autoEnabled || autoPaused) return;
      stopAuto();
      autoTimer = setInterval(() => {
        setSlide(index + 1, { updateHash: false });
      }, autoIntervalMs);
    }

    function pauseAuto() {
      autoPaused = true;
      stopAuto();
    }

    function resumeAuto() {
      autoPaused = false;
      startAuto();
    }

    function restartAuto() {
      stopAuto();
      if (!autoPaused) startAuto();
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        go(-1);
        restartAuto();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        go(1);
        restartAuto();
      });
    }

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        setSlide(i, { updateHash: true });
        restartAuto();
      });
    });

    cards.forEach((card) => {
      card.addEventListener('click', (event) => {
        const id = card.getAttribute('data-slide-target');
        const slideIndex = slideIndexById(id);
        if (slideIndex < 0) return;
        event.preventDefault();
        setSlide(slideIndex, { updateHash: true, scroll: true });
        restartAuto();
      });
    });

    root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
        restartAuto();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
        restartAuto();
      }
    });

    root.addEventListener('mouseenter', pauseAuto);
    root.addEventListener('mouseleave', resumeAuto);
    root.addEventListener('focusin', pauseAuto);
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget)) resumeAuto();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pauseAuto();
      } else {
        resumeAuto();
      }
    });

    function applyHash() {
      if (syncingHash) return;
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash) return;
      const slideIndex = slideIndexById(hash);
      if (slideIndex >= 0) {
        setSlide(slideIndex, { updateHash: false });
        restartAuto();
      }
    }

    window.addEventListener('hashchange', applyHash);

    const initialHash = window.location.hash.replace(/^#/, '');
    const initialIndex = slideIndexById(initialHash);
    setSlide(initialIndex >= 0 ? initialIndex : 0, {
      updateHash: initialIndex >= 0,
    });

    if (initialIndex >= 0) {
      requestAnimationFrame(() => {
        const target = document.getElementById('feature-slideshow');
        if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }

    startAuto();
  }
})();
