/* ============================================================
   Timetable v2 — Command Palette
   ⌘K / Ctrl+K / '/' fuzzy command launcher.
   Owns: #tt-palette (input #tt-palette-input, list #tt-palette-list)
   ============================================================ */
(function () {
  'use strict';

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_LABELS = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday'
  };
  const MAX_RESULTS = 7;

  let palette = null;   // #tt-palette
  let panel = null;     // .palette-panel
  let input = null;     // #tt-palette-input
  let list = null;      // #tt-palette-list

  let commands = [];
  let results = [];     // currently rendered (filtered) commands
  let sel = 0;          // selected index within results
  let isOpen = false;
  let lastFocus = null; // element to refocus on close

  const TT = () => window.TT;
  const reduceMotion = () => (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  /* ---------------- commands ---------------- */

  function dayLabel(day) {
    const tt = TT();
    if (tt && tt.util && typeof tt.util.dayLabel === 'function') {
      try { return tt.util.dayLabel(day); } catch (e) { /* fall through */ }
    }
    return DAY_LABELS[day] || day;
  }

  function clickEl(selector) {
    const el = document.querySelector(selector);
    if (el) el.click();
    return !!el;
  }

  /* Drive the real share popover so behaviour stays in ui/share.js:
     open it, then click the row carrying the matching data-action. */
  function shareAction(action) {
    const btn = document.getElementById('tt-share-btn');
    if (!btn) return;
    btn.click();
    setTimeout(() => {
      const row = document.querySelector('#tt-popover [data-action="' + action + '"]');
      if (row) row.click();
    }, 60);
  }

  /* Same trick for the account menu (ui/auth.js owns it): open via
     #tt-user-btn, click the row; toast when the row isn't on offer. */
  function userAction(action, label) {
    const btn = document.getElementById('tt-user-btn');
    if (!btn) return;
    btn.click();
    setTimeout(() => {
      const row = document.querySelector('.auth-menu [data-act="' + action + '"]'); // auth menu rows carry data-act (ui/auth.js)
      if (row) { row.click(); return; }
      const tt = TT();
      if (tt && typeof tt.emit === 'function') {
        tt.emit('tt:toast', { msg: label + ' isn\'t available right now' });
      }
    }, 60);
  }

  /* Notes pad lives in ui/notes.js (#tt-notes mount): scroll the section
     in, then focus the pad without yanking the scroll position back. */
  function focusNotes() {
    const sec = document.getElementById('tt-notes');
    if (!sec) return;
    if (typeof sec.scrollIntoView === 'function') {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    const pad = sec.querySelector('.notes-pad') || document.querySelector('.notes-pad'); // the textarea itself carries .notes-pad (ui/notes.js)
    if (pad && typeof pad.focus === 'function') pad.focus({ preventScroll: true });
  }

  /* Goals UI (ui/goals.js, #tt-goals mount) is being built alongside this —
     find the add input defensively: '.goal-add input' first, then the
     #tt-goal-input id; stamp the id on whatever we find so every entry
     point (palette, shortcuts) shares one hook. */
  function goalsInput() {
    const sec = document.getElementById('tt-goals');
    const inp = (sec && (sec.querySelector('.goal-add input') || sec.querySelector('#tt-goal-input')))
      || document.querySelector('.goal-add input')
      || document.getElementById('tt-goal-input');
    if (inp && !inp.id) inp.id = 'tt-goal-input';
    return inp;
  }

  function focusGoal() {
    const sec = document.getElementById('tt-goals');
    if (sec && typeof sec.scrollIntoView === 'function') {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    const inp = goalsInput();
    if (inp && typeof inp.focus === 'function') inp.focus({ preventScroll: true });
  }

  /* Flip the day/week seg inside #tt-goals, then bring the section in. */
  function goalsScope(scope) {
    const btn = document.querySelector('#tt-goals-seg [data-scope="' + scope + '"]');
    if (btn) btn.click();
    const sec = document.getElementById('tt-goals');
    if (sec && typeof sec.scrollIntoView === 'function') {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  /* Preset chips carry data-dur minutes (ui/focus.js). Only drive the timer
     while idle — aria-pressed on .focus-start / .is-locked on the picker
     mark a LIVE session (running or paused), which we never hijack. */
  function timerPreset(mins) {
    const sec = document.getElementById('tt-focus');
    if (!sec) return;
    const startBtn = sec.querySelector('.focus-start');
    const running = !!(startBtn && startBtn.getAttribute('aria-pressed') === 'true')
      || !!sec.querySelector('.focus-setup.is-locked');
    if (running) {
      const tt = TT();
      if (tt && typeof tt.emit === 'function') {
        tt.emit('tt:toast', { msg: 'timer session is live — finish or reset it first' });
      }
      return;
    }
    if (typeof sec.scrollIntoView === 'function') {
      sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
    let chip = sec.querySelector('.focus-chip[data-dur="' + mins + '"]');
    if (!chip) { // text fallback (break chips are 5/10, no collision with 15/25/45)
      const chips = sec.querySelectorAll('.focus-chip');
      for (let i = 0; i < chips.length; i++) {
        if ((chips[i].textContent || '').trim() === String(mins)) { chip = chips[i]; break; }
      }
    }
    if (chip) chip.click();
    if (startBtn) startBtn.click();
  }

  /* focus.js preset chips aren't a fixed API — find the 'custom' one
     defensively (data attribute first, then button text). */
  function clickCustomPreset(sec) {
    let chip = sec.querySelector('[data-preset="custom"], [data-mins="custom"], [data-len="custom"]');
    if (!chip) {
      const cands = sec.querySelectorAll('button, .chip');
      for (let i = 0; i < cands.length; i++) {
        if ((cands[i].textContent || '').trim().toLowerCase() === 'custom') { chip = cands[i]; break; }
      }
    }
    if (chip) chip.click();
  }

  function buildCommands() {
    const cmds = DAYS.map((day) => ({
      title: 'go to ' + String(dayLabel(day)).toLowerCase(),
      icon: 'calendar',
      keywords: day + ' week day jump view',
      run() {
        const tt = TT();
        if (tt && typeof tt.emit === 'function') tt.emit('tt:day-select', { day });
        const week = document.getElementById('tt-week');
        if (week && typeof week.scrollIntoView === 'function') {
          week.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        }
      }
    }));

    cmds.push({
      title: 'new task', icon: 'plus', keywords: 'add create todo task',
      run() {
        const inp = document.getElementById('tt-task-input');
        if (inp) inp.focus();
      }
    }, {
      title: 'new goal', icon: 'target', keywords: 'add create goal today week intention',
      run() { focusGoal(); }
    }, {
      title: 'goals today', icon: 'list-checks', keywords: 'daily goals scope day view show',
      run() { goalsScope('day'); }
    }, {
      title: 'goals week', icon: 'calendar-check', keywords: 'weekly goals scope week view show',
      run() { goalsScope('week'); }
    }, {
      title: 'start focus', icon: 'play', keywords: 'pomodoro timer begin concentrate',
      run() { clickEl('#tt-focus .focus-start'); }
    }, {
      title: 'pause focus', icon: 'pause', keywords: 'pomodoro timer stop break',
      run() { clickEl('#tt-focus .focus-start'); }
    }, {
      title: 'cycle theme', icon: 'sun-moon', keywords: 'dark light mode appearance colour color',
      run() { clickEl('#tt-theme-btn'); }
    }, {
      title: 'toggle reminders', icon: 'bell', keywords: 'notifications alerts nudge class',
      run() { clickEl('#tt-remind-btn'); }
    }, {
      title: 'copy today', icon: 'copy', keywords: 'share clipboard schedule text whatsapp',
      run() { shareAction('copy'); }
    }, {
      title: 'download .ics', icon: 'download', keywords: 'share calendar export file ical',
      run() { shareAction('ics'); }
    }, {
      title: 'switch account', icon: 'users', keywords: 'user login logout change id erp profile sign',
      run() { userAction('switch', 'switch account'); }
    }, {
      title: 'refresh timetable', icon: 'refresh-cw', keywords: 'reload fetch erp update schedule data',
      run() { userAction('refresh', 'refresh timetable'); }
    }, {
      title: 'new note', icon: 'pen-line', keywords: 'scratchpad notes write jot brain dump text',
      run() { focusNotes(); }
    }, {
      title: 'set timer', icon: 'timer', keywords: 'focus custom length minutes duration pomodoro preset',
      run() {
        const sec = document.getElementById('tt-focus');
        if (!sec) return;
        if (typeof sec.scrollIntoView === 'function') {
          sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
        }
        clickCustomPreset(sec);
      }
    }, {
      title: 'clear done tasks', icon: 'check-check', keywords: 'clean completed finished remove tidy',
      run() {
        const tt = TT();
        if (!tt || !tt.tasks) return;
        let done = 0;
        if (typeof tt.tasks.counts === 'function') {
          try { done = (tt.tasks.counts() || {}).done || 0; } catch (e) { done = 0; }
        }
        if (typeof tt.tasks.clearDone === 'function') tt.tasks.clearDone();
        if (typeof tt.emit === 'function') {
          tt.emit('tt:toast', {
            msg: done > 0
              ? 'cleared ' + done + ' done task' + (done === 1 ? '' : 's')
              : 'no done tasks to clear'
          });
        }
      }
    });

    [15, 25, 45].forEach((mins) => {
      cmds.push({
        title: 'timer ' + mins,
        icon: 'timer',
        keywords: 'focus pomodoro preset ' + mins + ' minutes start',
        run() { timerPreset(mins); }
      });
    });

    return cmds;
  }

  /* ---------------- fuzzy match ---------------- */

  /* Subsequence match on lowercase text; tight, word-start matches
     score higher. Returns { score, idxs } or null when the query
     is not a subsequence of the text. */
  function fuzzy(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return { score: 0, idxs: [] };

    const idxs = [];
    let ti = 0;
    let prev = -1;
    let score = 0;

    for (let qi = 0; qi < q.length; qi++) {
      const at = t.indexOf(q.charAt(qi), ti);
      if (at === -1) return null;
      idxs.push(at);
      const gap = prev === -1 ? at : at - prev - 1;
      score += 10 - Math.min(gap, 9);                    // tightness bonus
      if (at === 0 || t.charAt(at - 1) === ' ') score += 6; // word-start bonus
      prev = at;
      ti = at + 1;
    }
    score -= (idxs[idxs.length - 1] - idxs[0] + 1 - q.length); // spread penalty
    return { score, idxs };
  }

  function filter(query) {
    const q = (query || '').trim();
    if (!q) {
      return commands.slice(0, MAX_RESULTS)
        .map((cmd) => ({ cmd, idxs: [], score: 0 }));
    }
    const out = [];
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const mTitle = fuzzy(q, cmd.title);
      const mKeys = cmd.keywords ? fuzzy(q, cmd.keywords) : null;
      if (!mTitle && !mKeys) continue;
      out.push({
        cmd,
        idxs: mTitle ? mTitle.idxs : [],
        score: mTitle ? mTitle.score : mKeys.score - 8, // keyword-only ranks lower
        order: i
      });
    }
    out.sort((a, b) => (b.score - a.score) || (a.order - b.order));
    return out.slice(0, MAX_RESULTS);
  }

  /* ---------------- rendering ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function highlight(title, idxs) {
    if (!idxs || !idxs.length) return escapeHtml(title);
    const marked = {};
    idxs.forEach((i) => { marked[i] = true; });
    let html = '';
    for (let j = 0; j < title.length; j++) {
      const ch = escapeHtml(title.charAt(j));
      html += marked[j] ? '<b>' + ch + '</b>' : ch;
    }
    return html;
  }

  function render() {
    if (!list) return;
    if (!results.length) {
      list.innerHTML = '<div class="palette-empty">no matching commands</div>';
      if (input) input.removeAttribute('aria-activedescendant');
      return;
    }
    let html = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      html += '<button type="button" class="palette-row' + (i === sel ? ' sel' : '') + '"'
        + ' id="tt-pal-opt-' + i + '"'
        + ' data-i="' + i + '" role="option" aria-selected="' + (i === sel) + '">'
        + '<i data-lucide="' + r.cmd.icon + '"></i>'
        + '<span class="palette-row-title">' + highlight(r.cmd.title, r.idxs) + '</span>'
        + '</button>';
    }
    list.innerHTML = html;
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
    paintSel();
  }

  function paintSel() {
    if (!list) return;
    const rows = list.querySelectorAll('.palette-row');
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('sel', i === sel);
      rows[i].setAttribute('aria-selected', i === sel ? 'true' : 'false');
    }
    if (input) {
      if (rows.length && rows[sel]) input.setAttribute('aria-activedescendant', rows[sel].id);
      else input.removeAttribute('aria-activedescendant');
    }
    scrollSel();
  }

  function scrollSel() {
    if (!list) return;
    const row = list.querySelector('.palette-row.sel');
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function buildFoot() {
    if (!panel || panel.querySelector('.palette-foot')) return;
    const foot = document.createElement('div');
    foot.className = 'palette-foot';
    foot.innerHTML = '<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>'
      + '<span><kbd>↵</kbd> run</span>'
      + '<span><kbd>esc</kbd> close</span>';
    panel.appendChild(foot);
  }

  /* ---------------- open / close / run ---------------- */

  function refresh() {
    results = filter(input ? input.value : '');
    sel = 0;
    render();
  }

  function open() {
    if (!palette || isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    palette.classList.remove('hidden');
    if (input) {
      input.value = '';
      input.setAttribute('aria-expanded', 'true');
    }
    refresh();
    setTimeout(() => { if (input) input.focus(); }, 0);
  }

  function close() {
    if (!palette || !isOpen) return;
    isOpen = false;
    palette.classList.add('hidden');
    if (input) {
      input.blur();
      input.setAttribute('aria-expanded', 'false');
    }
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function toggle() { if (isOpen) close(); else open(); }

  function move(delta) {
    if (!results.length) return;
    sel = (sel + delta + results.length) % results.length;
    paintSel();
  }

  function run(i) {
    const r = results[i == null ? sel : i];
    close();
    if (r && r.cmd && typeof r.cmd.run === 'function') r.cmd.run();
  }

  /* ---------------- events ---------------- */

  function isTyping(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function onGlobalKey(e) {
    const k = e.key || '';
    if ((e.metaKey || e.ctrlKey) && !e.altKey && k.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
      return;
    }
    if (k === 'Escape' && isOpen) {
      close();
      return;
    }
    if (k === '/' && !isOpen && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
      e.preventDefault();
      open();
    }
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results.length) run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function bindMouse() {
    if (list) {
      list.addEventListener('click', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.palette-row') : null;
        if (!row) return;
        run(parseInt(row.getAttribute('data-i'), 10));
      });
      list.addEventListener('mousemove', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.palette-row') : null;
        if (!row) return;
        const i = parseInt(row.getAttribute('data-i'), 10);
        if (!isNaN(i) && i !== sel) { sel = i; paintSel(); }
      });
    }
    // backdrop click closes
    palette.addEventListener('mousedown', (e) => {
      if (e.target === palette) close();
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    palette = document.getElementById('tt-palette');
    if (!palette) return;
    panel = palette.querySelector('.palette-panel') || palette;
    input = document.getElementById('tt-palette-input');
    list = document.getElementById('tt-palette-list');

    commands = buildCommands();
    buildFoot();

    if (list) list.setAttribute('role', 'listbox');
    if (input) {
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', 'tt-palette-list');
      input.addEventListener('input', refresh);
      input.addEventListener('keydown', onInputKey);
    }
    bindMouse();
    document.addEventListener('keydown', onGlobalKey);

    const searchBtn = document.getElementById('tt-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', open);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
