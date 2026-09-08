/* shortcuts.js — global keyboard shortcuts (no modifier combos; ⌘K lives in palette.js) */
(() => {
  'use strict';

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const isTyping = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  };

  const paletteOpen = () => {
    const pal = document.getElementById('tt-palette');
    return !!pal && !pal.classList.contains('hidden');
  };

  const selectDay = (idx) => {
    const day = DAYS[idx];
    if (!day) return;
    window.TT && TT.emit('tt:day-select', { day });
  };

  const reduceMotion = () => (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  const newTask = () => {
    const input = document.getElementById('tt-task-input');
    if (!input) return;
    const card = input.closest('#tt-tasks') || document.getElementById('tt-tasks');
    if (card && card.scrollIntoView) {
      card.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    input.focus({ preventScroll: true });
  };

  const newNote = () => {
    const sec = document.getElementById('tt-notes');
    if (!sec) return;
    const pad = sec.querySelector('.notes-pad') || document.querySelector('.notes-pad'); // the textarea itself carries .notes-pad (ui/notes.js)
    if (sec.scrollIntoView) {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (pad && pad.focus) pad.focus({ preventScroll: true });
  };

  /* goals add input: '.goal-add input' first, then #tt-goal-input (ui/goals.js);
     stamp the id on whatever we find so every entry point shares one hook */
  const newGoal = () => {
    const sec = document.getElementById('tt-goals');
    if (!sec) return;
    const input = sec.querySelector('.goal-add input') || sec.querySelector('#tt-goal-input') || document.getElementById('tt-goal-input');
    if (input && !input.id) input.id = 'tt-goal-input';
    if (sec.scrollIntoView) {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (input && input.focus) input.focus({ preventScroll: true });
  };

  const toggleTheme = () => {
    const btn = document.getElementById('tt-theme-btn');
    if (btn) btn.click();
  };

  const toggleWeekView = () => {
    const week = document.getElementById('tt-week');
    if (!week) return;
    const segs = Array.from(week.querySelectorAll('.seg [data-view], .seg[data-view]'));
    if (!segs.length) return;
    const inactive = segs.find((b) => !b.classList.contains('active') && b.getAttribute('aria-pressed') !== 'true');
    (inactive || segs[0]).click();
  };

  const showHelp = () => {
    if (window.TT) TT.emit('tt:toast', { msg: '1-6 days · n task · o goal · m note · t theme · g grid/day · ⌘K palette', type: 'info' });
  };

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target) || paletteOpen()) return;

    const k = e.key;

    if (k >= '1' && k <= '6') {
      e.preventDefault();
      selectDay(k.charCodeAt(0) - 49); // '1' -> 0 (mon) … '6' -> 5 (sat)
      return;
    }

    switch (k) {
      case 'n':
      case 'N':
        e.preventDefault();
        newTask();
        break;
      case 'o':
      case 'O':
        e.preventDefault();
        newGoal();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        newNote();
        break;
      case 't':
      case 'T':
        e.preventDefault();
        toggleTheme();
        break;
      case 'g':
      case 'G':
        e.preventDefault();
        toggleWeekView();
        break;
      case '?':
        e.preventDefault();
        showHelp();
        break;
    }
  });
})();
