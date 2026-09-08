/* ui/notes.js — scratchpad card (#tt-notes).
 * One auto-growing <textarea.notes-pad> in #tt-notes-body, autosaved into
 * TT.prefs under 'notes' (per-user scoped by core/store.js — nothing extra
 * needed here). Typing debounces 400ms → save + #tt-notes-stamp flips from
 * 'autosaves' to 'saved HH:MM'; the idle label returns on the next keystroke.
 * Extras: faint word count bottom-right, ⌘/Ctrl+S saves now + toasts,
 * Escape blurs, pending writes flush on beforeunload. */
(() => {
  'use strict';

  const TT = window.TT; // created by core/store.js (loaded first)
  if (!TT || !TT.prefs || !TT.emit) return;

  const body = document.getElementById('tt-notes-body');
  const stamp = document.getElementById('tt-notes-stamp');
  if (!body) return;
  if (body.querySelector('.notes-pad')) return; // already mounted

  const PREF_KEY = 'notes';
  const DEBOUNCE_MS = 400;
  const MAX_H = 320; // mirrors .notes-pad max-height in notes.css

  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const timeStamp = () => {
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  /* ---------- build ---------- */

  const pad = document.createElement('textarea');
  pad.className = 'notes-pad';
  pad.placeholder = 'dump it here. links, ideas, whatever.';
  pad.setAttribute('aria-label', 'Scratchpad notes');
  pad.setAttribute('spellcheck', 'false');
  pad.rows = 1;
  body.appendChild(pad);

  const count = document.createElement('div');
  count.className = 'notes-count';
  count.setAttribute('aria-hidden', 'true');
  body.appendChild(count);

  /* ---------- helpers ---------- */

  let timer = 0;
  let lastSaved = null; // value currently persisted in prefs

  const setStamp = (txt) => { if (stamp) stamp.textContent = txt; };

  // auto-grow: shrink to natural height, then fit content up to the cap;
  // past the cap the pad keeps 320px and scrolls (see notes.css)
  const grow = () => {
    pad.style.height = 'auto';
    const over = pad.scrollHeight > MAX_H;
    pad.style.height = Math.min(pad.scrollHeight, MAX_H) + 'px';
    pad.style.overflowY = over ? 'auto' : 'hidden';
  };

  const words = () => {
    const t = pad.value.trim();
    const n = t ? t.split(/\s+/).length : 0;
    count.textContent = n + (n === 1 ? ' word' : ' words');
  };

  const save = (announce) => {
    window.clearTimeout(timer);
    timer = 0;
    if (pad.value !== lastSaved) {
      lastSaved = pad.value;
      TT.prefs.set(PREF_KEY, lastSaved);
    }
    setStamp('saved ' + timeStamp());
    if (announce) TT.emit('tt:toast', { msg: 'saved' });
  };

  const queue = () => {
    setStamp('autosaves'); // editing resumed → back to the idle label
    window.clearTimeout(timer);
    timer = window.setTimeout(() => save(false), DEBOUNCE_MS);
  };

  /* ---------- events ---------- */

  pad.addEventListener('input', () => { grow(); words(); queue(); });

  pad.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && typeof e.key === 'string' && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(true); // immediate, with toast
    } else if (e.key === 'Escape') {
      pad.blur();
    }
  });

  // re-wrap on width changes re-flows the text — re-fit the height
  window.addEventListener('resize', grow);

  // never lose a pending debounced write
  window.addEventListener('beforeunload', () => { if (timer) save(false); });

  /* ---------- init ---------- */

  const initial = TT.prefs.get(PREF_KEY, '');
  pad.value = typeof initial === 'string' ? initial : '';
  lastSaved = pad.value;
  grow();
  words();

  // mono webfont swaps in after first paint → metrics shift → re-fit
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(grow).catch(() => {});
  }
})();
