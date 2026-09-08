/* focus.js — pomodoro timer inside #tt-focus (vanilla, IIFE, no globals)
   v4: user-picked durations — preset chips (15/25/45/60) + custom minutes
   (1–180, applied explicitly), break-length chips (5/10). Both persist via
   TT.prefs ('focus.dur' default 25, 'focus.break' default 5 — per-user
   scoped by store.js). Ring + countdown adapt to any duration; the focuslog
   records ACTUAL elapsed whole minutes (min 1) on finish or early stop.
   v5: card cleanup — 4px track, ring glow only while running, tabular-nums
   readout with a blinking colon, mode label reads 'focus 25' / 'break 5',
   start swaps to a pause icon while running. Plus a topbar mini-timer
   (.focus-mini, FIRST child of .topbar-actions): live countdown + pulsing
   accent dot fed by the SAME 1s tick (cached nodes — zero per-second
   querySelector), kept dimmed ('paused') on pause, removed on finish/
   stop/reset; click smooth-scrolls to the focus card. Finish keeps the
   ring flash + toast + tt:celebrate. */
(() => {
  'use strict';

  const root = document.getElementById('tt-focus');
  if (!root || !window.TT) return;

  /* sanctioned inline keyframes — the ONE @keyframes allowed outside
     motion.css. Consumers (.focus-colon blink, .focus-mini-dot pulse) are
     rules in css/focus.css that reference it by name; reduced-motion still
     wins because motion.css kills ALL animation globally. */
  const blinkStyle = document.createElement('style');
  blinkStyle.id = 'tt-focus-blink';
  blinkStyle.textContent = '@keyframes focus-blink{to{opacity:0}}';
  (document.head || document.documentElement).appendChild(blinkStyle);
  const TT = window.TT;

  const select = document.getElementById('tt-focus-task');
  const dial = document.getElementById('tt-focus-dial');
  if (!select || !dial) return;

  const CIRC = 402.1; // 2π × r64
  const MAX_DOTS = 4;

  const PRESETS = [15, 25, 45, 60]; // focus duration chips (minutes)
  const BREAKS = [5, 10];           // break length chips (minutes)
  const MIN_DUR = 1;
  const MAX_DUR = 180;

  /* coercers — prefs are user-writable, never trust the stored shape */
  const clampDur = (v) => {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return 25;
    return Math.min(MAX_DUR, Math.max(MIN_DUR, n));
  };
  const focusMins = () => clampDur(TT.prefs.get('focus.dur', 25));
  const breakMins = () => {
    const n = Math.round(Number(TT.prefs.get('focus.break', 5)));
    if (!isFinite(n) || n < 1) return 5;
    return Math.min(60, n);
  };
  const totalFor = (m) => (m === 'break' ? breakMins() : focusMins()) * 60; // seconds

  let mode = 'focus';
  let left = totalFor('focus'); // seconds remaining
  let timer = null;             // setInterval handle, non-null only while running
  let endAt = 0;                // wall-clock ms when the running segment ends (throttle-proof)
  let sessionLive = false;      // true from start until finish/reset — drives the topbar mini chip, the picker lock and aria-pressed on .focus-start
  let customOpen = PRESETS.indexOf(focusMins()) === -1; // custom input row visible

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const pad = (n) => String(n).padStart(2, '0');

  /* local YYYY-MM-DD — must match the key stats.js uses to read 'focuslog' */
  const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStamp = () => stamp(new Date());

  const toast = (msg, type) => TT.emit('tt:toast', type ? { msg, type } : { msg });

  /* ---------- duration picker (styled by css/focus.css, sits above the dial) ---------- */
  const setup = document.createElement('div');
  setup.className = 'focus-setup';
  setup.innerHTML =
    '<div class="focus-presets" role="group" aria-label="focus duration in minutes">' +
      PRESETS.map((m) =>
        '<button type="button" class="focus-chip" data-dur="' + m + '" aria-pressed="false">' + m + '</button>'
      ).join('') +
      '<button type="button" class="focus-chip focus-chip-custom" aria-pressed="false">custom</button>' +
      '<span class="focus-custom">' +
        '<input class="focus-custom-in" id="tt-focus-custom" name="tt-focus-custom" type="number" min="' + MIN_DUR + '" max="' + MAX_DUR + '" step="1" inputmode="numeric" aria-label="custom focus minutes, 1 to 180">' +
        '<button type="button" class="icon-btn focus-custom-go" aria-label="apply custom duration">' +
          '<i data-lucide="check"></i>' +
        '</button>' +
      '</span>' +
    '</div>' +
    '<div class="focus-breaks" role="group" aria-label="break length in minutes">' +
      '<span class="focus-brk-label">break</span>' +
      BREAKS.map((m) =>
        '<button type="button" class="focus-chip focus-chip-brk" data-brk="' + m + '" aria-pressed="false">' + m + '</button>'
      ).join('') +
    '</div>';
  dial.insertAdjacentElement('beforebegin', setup);

  const presetsEl = setup.querySelector('.focus-presets');
  const durChips = Array.prototype.slice.call(setup.querySelectorAll('[data-dur]'));
  const brkChips = Array.prototype.slice.call(setup.querySelectorAll('[data-brk]'));
  const customChip = setup.querySelector('.focus-chip-custom');
  const customIn = setup.querySelector('.focus-custom-in');
  const customGo = setup.querySelector('.focus-custom-go');

  /* ---------- dial markup (styled by css/focus.css) ----------
     the readout is split into mm/colon/ss spans so the colon can blink
     on its own (CSS steps animation, only while .is-running) */
  dial.innerHTML =
    '<div class="focus-dial-wrap">' +
      '<svg class="focus-svg" width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">' +
        '<circle class="focus-track track" cx="74" cy="74" r="64"></circle>' +
        '<circle class="focus-prog" cx="74" cy="74" r="64" stroke-dasharray="' + CIRC + '"></circle>' +
      '</svg>' +
      '<div class="focus-time"><span class="focus-mm">' + pad(focusMins()) + '</span><span class="focus-colon">:</span><span class="focus-ss">00</span></div>' +
      '<div class="focus-mode">focus ' + focusMins() + '</div>' +
    '</div>' +
    '<div class="focus-dots" role="img" aria-label="focus sessions completed today"></div>';

  const wrap = dial.querySelector('.focus-dial-wrap');
  const prog = dial.querySelector('.focus-prog');
  const mmEl = dial.querySelector('.focus-mm');
  const ssEl = dial.querySelector('.focus-ss');
  const modeEl = dial.querySelector('.focus-mode');
  const dotsEl = dial.querySelector('.focus-dots');

  /* ---------- controls row (built after the dial) ---------- */
  const controls = document.createElement('div');
  controls.className = 'focus-controls';
  controls.innerHTML =
    '<button type="button" class="btn btn-acc focus-start">' +
      '<i data-lucide="play"></i><span>start</span>' +
    '</button>' +
    '<button type="button" class="icon-btn focus-reset" aria-label="reset timer">' +
      '<i data-lucide="rotate-ccw"></i>' +
    '</button>';
  dial.insertAdjacentElement('afterend', controls);

  const toggleBtn = controls.querySelector('.focus-start');
  const resetBtn = controls.querySelector('.focus-reset');
  if (window.lucide) window.lucide.createIcons();

  /* ---------- render ---------- */
  let lastToggleKey = ''; // icon+label cache — rewrite the button only on state change
  function renderToggle() {
    if (!toggleBtn) return;
    const running = timer !== null;
    const icon = running ? 'pause' : 'play';
    const label = running ? 'pause' : (left < totalFor(mode) ? 'resume' : 'start');
    /* pressed = a session is LIVE (running or paused), cleared only on
       finish/reset — palette.js probes this to avoid hijacking a paused
       session with its 'timer 15/25/45' commands */
    toggleBtn.setAttribute('aria-pressed', sessionLive ? 'true' : 'false');
    const key = icon + '|' + label;
    if (key === lastToggleKey) return; // no per-second innerHTML/createIcons churn
    lastToggleKey = key;
    toggleBtn.innerHTML = '<i data-lucide="' + icon + '"></i><span>' + label + '</span>';
    if (window.lucide) window.lucide.createIcons();
  }

  function render() {
    if (mmEl) mmEl.textContent = pad(Math.floor(left / 60));
    if (ssEl) ssEl.textContent = pad(left % 60);
    if (modeEl) modeEl.textContent = mode + ' ' + Math.round(totalFor(mode) / 60); // 'focus 25' / 'break 5'
    if (prog) {
      const total = totalFor(mode); // ring adapts to any duration
      const elapsed = total - left;
      prog.style.strokeDashoffset = String(CIRC * (1 - elapsed / total));
    }
    if (wrap) {
      wrap.classList.toggle('is-break', mode === 'break');
      wrap.classList.toggle('is-running', timer !== null);
    }
    /* while a session is live (running OR paused) the picker locks
       (CSS: opacity .4 + pointer-events none) — a paused session must not
       be wiped by chip clicks or the palette's timer presets */
    if (setup) setup.classList.toggle('is-locked', sessionLive);
    if (customIn) customIn.disabled = sessionLive;
    renderToggle();
    syncMini(); // topbar chip rides the same tick
  }

  function renderChips() {
    const d = focusMins();
    const isCustomVal = PRESETS.indexOf(d) === -1;
    const showCustom = customOpen || isCustomVal;
    if (presetsEl) presetsEl.classList.toggle('is-custom', showCustom);
    durChips.forEach((chip) => {
      const on = Number(chip.getAttribute('data-dur')) === d;
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (customChip) {
      customChip.classList.toggle('on', showCustom);
      customChip.setAttribute('aria-pressed', showCustom ? 'true' : 'false');
    }
    /* keep the input mirroring the stored value unless the user is typing in it */
    if (customIn && showCustom && document.activeElement !== customIn) {
      customIn.value = String(d);
    }
    const b = breakMins();
    brkChips.forEach((chip) => {
      const on = Number(chip.getAttribute('data-brk')) === b;
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderDots() {
    if (!dotsEl) return;
    const log = TT.prefs.get('focuslog', {}) || {};
    const mins = Number(log[todayStamp()]) || 0;
    const done = Math.min(MAX_DOTS, Math.floor(mins / 25));
    let html = '';
    for (let i = 0; i < MAX_DOTS; i++) {
      html += '<span class="focus-dot' + (i < done ? ' done' : '') + '"></span>';
    }
    dotsEl.innerHTML = html;
  }

  /* ---------- topbar mini-timer (.focus-mini, FIRST child of .topbar-actions)
     Exists only while a session is live (sessionLive): pulsing accent dot +
     mono countdown while running; kept but dimmed with a 'paused' tag on
     pause; removes itself on finish/stop/reset. Nodes are created once and
     cached — the 1s tick only rewrites a textContent, toggles classes and
     refreshes the dynamic aria-label, never re-queries the DOM. */
  const topbar = document.querySelector('.topbar-actions'); // guarded; may be absent
  let mini = null;     // the chip (button), built lazily by ensureMini()
  let miniTime = null; // its countdown span

  const reduceMotion = () => !!(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  function ensureMini() {
    if (mini) return mini;
    mini = document.createElement('button');
    mini.type = 'button';
    mini.className = 'focus-mini';
    mini.setAttribute('aria-label', 'focus timer — jump to the focus card');
    mini.innerHTML =
      '<span class="focus-mini-dot" aria-hidden="true"></span>' +
      '<span class="focus-mini-time"></span>' +
      '<span class="focus-mini-state">paused</span>';
    miniTime = mini.querySelector('.focus-mini-time');
    mini.addEventListener('click', () => {
      root.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    });
    return mini;
  }

  function syncMini() {
    if (!topbar) return;
    const running = timer !== null;
    if (!sessionLive) { // idle / finished / stopped — the chip removes itself
      if (mini && mini.parentNode) mini.parentNode.removeChild(mini);
      return;
    }
    ensureMini();
    const mmss = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
    if (miniTime) miniTime.textContent = mmss;
    mini.classList.toggle('is-paused', !running); // paused: stays, dimmed
    mini.classList.toggle('is-break', mode === 'break');
    /* dynamic accessible name — SR users hear the actual countdown on next
       focus instead of a static 'focus timer' (attribute swaps don't spam
       announcements) */
    mini.setAttribute('aria-label',
      (running ? '' : 'paused — ') +
      (mode === 'break' ? 'break ' : 'focus session ') +
      mmss + ' remaining — jump to timer');
    if (mini.parentNode !== topbar || topbar.firstChild !== mini) {
      topbar.insertBefore(mini, topbar.firstChild); // always the FIRST child
    }
  }

  /* ---------- timer ---------- */
  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function setMode(next) {
    mode = next;
    left = totalFor(next);
    render();
  }

  function logFocusMinutes(mins) {
    const log = TT.prefs.get('focuslog', {}) || {};
    const key = todayStamp();
    log[key] = (Number(log[key]) || 0) + mins;
    TT.prefs.set('focuslog', log);
    renderDots();
    TT.emit('tt:focus-log', { mins }); // after the write — stats.js recomputes on this (covers early stops too)
  }

  /* whole minutes actually elapsed in the current focus segment (min 1);
     0 outside focus mode or when nothing has elapsed */
  function elapsedFocusMins() {
    if (mode !== 'focus') return 0;
    const elapsed = totalFor('focus') - left; // seconds
    if (elapsed <= 0) return 0;
    return Math.max(1, Math.floor(elapsed / 60));
  }

  /* ring flash on completion — .focus-flash (pop, motion.css) on the dial
     wrap; the reflow restarts the animation on back-to-back finishes */
  function flashRing() {
    if (!wrap) return;
    wrap.classList.remove('focus-flash');
    void wrap.offsetWidth;
    wrap.classList.add('focus-flash');
    setTimeout(() => { wrap.classList.remove('focus-flash'); }, 600);
  }

  function finish() {
    sessionLive = false; // mini chip removes itself
    stopTimer();
    if (mode === 'focus') {
      const taskId = select.value || null;
      const mins = elapsedFocusMins(); // left is 0 → the full chosen duration
      TT.emit('tt:focus-done', { taskId });
      if (mins > 0) logFocusMinutes(mins);
      const r = dial.getBoundingClientRect();
      TT.emit('tt:celebrate', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      flashRing();
      toast('focus session done — break time', 'ok');
      setMode('break'); // break length = chosen break
    } else {
      toast('break over');
      setMode('focus');
    }
  }

  /* remaining time derives from the wall clock, so a throttled
     (hidden-tab) interval can't freeze or drift the countdown */
  function tick() {
    left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (left <= 0) {
      finish();
      return;
    }
    render();
  }

  function startPause() {
    if (timer !== null) {
      left = Math.max(0, Math.round((endAt - Date.now()) / 1000)); // freeze what's left
      stopTimer(); // sessionLive stays true — the mini chip keeps showing, dimmed 'paused'
      render();
      return;
    }
    if (left <= 0) left = totalFor(mode);
    sessionLive = true; // mini chip lives from here until finish/reset
    endAt = Date.now() + left * 1000;
    timer = setInterval(tick, 1000);
    render();
  }

  function reset() {
    const mins = elapsedFocusMins(); // read BEFORE left is wiped
    sessionLive = false; // mini chip removes itself on stop
    stopTimer();
    if (mins > 0) {
      logFocusMinutes(mins); // stopping early still banks the actual minutes
      toast('stopped — ' + mins + ' focus min logged');
    }
    left = totalFor(mode);
    render();
  }

  if (toggleBtn) toggleBtn.addEventListener('click', startPause);
  if (resetBtn) resetBtn.addEventListener('click', reset);

  /* ---------- duration picker (locked while a session is live — running or
     paused — so a paused remainder can't be wiped; handlers guard too) ---------- */
  function pickDur(mins) {
    if (sessionLive) return;
    customOpen = false;
    TT.prefs.set('focus.dur', clampDur(mins));
    if (mode === 'focus') { // idle: dial resets to the new mm:00
      left = totalFor('focus');
      render();
    }
    renderChips();
  }

  function openCustom() {
    if (sessionLive) return;
    customOpen = true;
    renderChips();
    if (customIn) {
      customIn.value = String(focusMins());
      customIn.focus();
      if (typeof customIn.select === 'function') customIn.select();
    }
  }

  function applyCustom() {
    if (sessionLive || !customIn) return;
    const v = clampDur(customIn.value);
    customIn.value = String(v);
    TT.prefs.set('focus.dur', v);
    customOpen = PRESETS.indexOf(v) === -1; // applying a preset value folds the input away
    if (mode === 'focus') {
      left = totalFor('focus');
      render();
    }
    renderChips();
  }

  function pickBrk(mins) {
    if (sessionLive) return;
    TT.prefs.set('focus.break', mins);
    if (mode === 'break') { // idle: dial resets to the new break mm:00
      left = totalFor('break');
      render();
    }
    renderChips();
  }

  durChips.forEach((chip) => chip.addEventListener('click', () => {
    pickDur(Number(chip.getAttribute('data-dur')));
  }));
  brkChips.forEach((chip) => chip.addEventListener('click', () => {
    pickBrk(Number(chip.getAttribute('data-brk')));
  }));
  if (customChip) customChip.addEventListener('click', openCustom);
  if (customGo) customGo.addEventListener('click', applyCustom);
  if (customIn) {
    customIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustom();
      }
    });
  }

  /* ---------- task select (switching tasks never resets the timer) ---------- */
  function fillTasks() {
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return;
    const prev = select.value;
    let active = [];
    try {
      active = TT.tasks.list().filter((t) => t && !t.done);
    } catch (e) {
      active = [];
    }
    select.innerHTML = '<option value="">' + (active.length ? 'no task' : 'no tasks yet — add one below') + '</option>' + active.map((t) =>
      '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'
    ).join('');
    if (prev && active.some((t) => String(t.id) === prev)) {
      select.value = prev; // keep selection across refreshes
    }
  }

  TT.on('tt:tasks-changed', fillTasks);

  /* ---------- init ---------- */
  fillTasks();
  renderChips();
  render();
  renderDots();
})();
