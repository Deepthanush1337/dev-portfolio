/* theme.js — accent theme cycler (#tt-theme-btn) + brand party easter egg.
 * Theme persists to the RAW localStorage key 'deeptt.v2.theme' (not TT.prefs)
 * because the shell's inline pre-paint script reads that exact key. */
(() => {
  'use strict';

  const KEY = 'deeptt.v2.theme';
  const THEMES = ['', 'theme-violet', 'theme-rose'];
  const LABELS = { '': 'lime mode', 'theme-violet': 'violet mode', 'theme-rose': 'rose mode' };
  const ANIM_MS = 250;        // html.theme-anim transition window
  const PARTY_CLICKS = 5;     // rapid .brand clicks to trigger
  const PARTY_WINDOW = 2000;  // …within this many ms
  const PARTY_MS = 2500;      // body.party lifetime

  const root = document.documentElement;

  const toast = (msg) => {
    if (window.TT && typeof window.TT.emit === 'function') {
      window.TT.emit('tt:toast', { msg });
    }
  };

  /* DOM is the source of truth (pre-paint script already applied it);
   * fall back to storage, then to default. */
  const current = () => {
    for (const t of THEMES) {
      if (t && root.classList.contains(t)) return t;
    }
    try {
      const v = localStorage.getItem(KEY);
      if (v && THEMES.indexOf(v) !== -1) return v;
    } catch (e) { /* storage unavailable — non-fatal */ }
    return '';
  };

  let animTimer = 0;
  const apply = (v) => {
    root.classList.add('theme-anim');
    for (const t of THEMES) {
      if (t) root.classList.remove(t);
    }
    if (v) root.classList.add(v);
    try { localStorage.setItem(KEY, v); } catch (e) { /* non-fatal */ }
    window.clearTimeout(animTimer);
    animTimer = window.setTimeout(() => root.classList.remove('theme-anim'), ANIM_MS);
  };

  const cycle = () => {
    const next = THEMES[(THEMES.indexOf(current()) + 1) % THEMES.length];
    apply(next);
    toast(LABELS[next]);
  };

  /* ---- party easter egg ---- */
  let clicks = [];
  let partyTimer = 0;
  let styleInjected = false;

  const injectPartyStyle = () => {
    if (styleInjected) return;
    styleInjected = true;
    const s = document.createElement('style');
    s.id = 'tt-party-style';
    s.textContent = '.party .bento{animation:pop .5s var(--ease)}' +
      '.party .brand-tile{animation:spin 1s linear infinite}';
    document.head.appendChild(s);
  };

  const party = () => {
    injectPartyStyle();
    if (!document.body) return;
    document.body.classList.add('party');
    toast('party mode');
    window.clearTimeout(partyTimer);
    partyTimer = window.setTimeout(() => {
      if (document.body) document.body.classList.remove('party');
    }, PARTY_MS);
  };

  const onBrandClick = () => {
    const now = Date.now();
    clicks = clicks.filter((t) => now - t < PARTY_WINDOW);
    clicks.push(now);
    if (clicks.length >= PARTY_CLICKS) {
      clicks = [];
      party();
    }
  };

  const init = () => {
    const btn = document.getElementById('tt-theme-btn');
    if (btn) btn.addEventListener('click', cycle);
    const brand = document.querySelector('.brand');
    if (brand) brand.addEventListener('click', onBrandClick);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
