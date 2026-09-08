/* ==========================================================================
   ui/week.js — "the week" bento: slot-accurate week grid / day agenda
   owns: #tt-week-body, the card's .seg [data-view] control, #tt-day-chips
   state (prefs): 'week.view' = grid|day (default 'grid')
                  'week.day'  = mon..sat (default: today, or 'mon' on sunday)

   grid contract (css/week.css):
     .wk-scroll > .wk-grid >
       .wk-gutter(.wk-ghead + .wk-gtrack > .wk-hour ×11, 07:00–17:00)
       + .wk-days(> .wk-bands > .wk-break) > .wk-daycol(.is-today/.is-empty)
         > .wk-dayhead(.wk-dayname + .wk-count) + .wk-daytrack
           > .wk-block(.wk-top>.wk-code+.wk-type, .wk-room, .wk-time)
           + .wk-task(.is-done) + .wk-nowline
     Tracks are exactly 10 × --wk-pitch tall (07:00–17:00) so the
     %-positioned hours/blocks/bands/task strips/nowline land on the
     hour stripes. .wk-task strips are timed tasks (TT.tasks entries
     carrying both day + start) pinned at their start %; a task with a
     valid end renders as a RANGE strip (.is-range) spanning start→end
     with the same % math as blocks (min 18px, time line when ≥40px
     tall), and keeps the thin 18px marker otherwise.
   day contract:
     .wa-rows > .wa-row[data-code](.is-live/.is-past) | .wa-break | .wa-gap
       | .wa-row.wa-task(.is-done/.is-past) — task rows interleave
       chronologically and re-render on 'tt:tasks-changed'; range tasks
       show start/end stacked in the time cell + a duration meta line
   ========================================================================== */
(() => {
  'use strict';

  const TT = window.TT;
  if (!TT || !TT.prefs || !TT.util) return;

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const OPEN = 420;            // 07:00 — top of the grid
  const CLOSE = 1020;          // 17:00 — bottom of the grid (10 one-hour stripes)
  const SPAN = CLOSE - OPEN;   // 600
  const STAGGER = 45;          // ms between staggered day-row reveals
  const TALL_PX = 54;          // blocks taller than this show the time line
  const LABEL_PX = 20;         // break bands ≥ this height earn a label (30m band
                               // = 24px at 48px pitch; 10m bands = 8px stay bare)
  const FREE_MIN = 20;         // minimum minutes for a "free" row in day mode
  const TASK_H = 18;           // .wk-task strip height in px (css/week.css)
  const RANGE_TALL_PX = 40;    // range strips this tall also show the time line

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const validDay = (d) => (DAYS.indexOf(d) !== -1 ? d : null);
  const validView = (v) => (v === 'day' ? 'day' : 'grid');
  const minsOf = (date) => date.getHours() * 60 + date.getMinutes();
  const shortDay = (d) => (TT.util.dayLabel(d) || d).slice(0, 3);
  const pct = (m) => ((m - OPEN) / SPAN) * 100;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------------- state ---------------- */
  const state = {
    view: validView(TT.prefs.get('week.view', 'grid')),
    day: validDay(TT.prefs.get('week.day', null)) || validDay(TT.util.todayKey()) || 'mon',
  };

  /* ---------------- dom (all guarded) ---------------- */
  const card = document.getElementById('tt-week');
  const body = document.getElementById('tt-week-body');
  let seg = null;
  let chips = null;
  let lastToday = TT.util.todayKey();
  let nowlineEl = null;    // cached nowline node — per-second tick path
  let nowlineTop = '';     // last written nowline position
  let todayTrack = null;   // today's .wk-daytrack, re-cached per render

  function classesOnDay(day) {
    const list = TT.util.classesOn(day) || [];
    return list.slice().sort((a, b) => TT.util.mins(a.start) - TT.util.mins(b.start));
  }

  /* timed tasks (TT.tasks entries carrying both day + start) for one
     weekday, sorted by start — guarded: script order loads core before
     ui, but a missing tasks store must never break the grid */
  function timedTasksFor(day) {
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return [];
    return TT.tasks.list()
      .filter((t) => t && t.day === day && t.start && isFinite(TT.util.mins(t.start)))
      .sort((a, b) => TT.util.mins(a.start) - TT.util.mins(b.start));
  }

  /* data attrs shared by grid strips and day rows — the click delegate
     builds the 'task: <title> · <start[–end]>' toast from these */
  function taskAttrs(t) {
    return ' data-task-id="' + esc(t.id) + '"' +
      ' data-title="' + esc(t.title) + '"' +
      ' data-start="' + esc(t.start) + '"' +
      (t.end ? ' data-end="' + esc(t.end) + '"' : '');
  }

  /* task time range in minutes, or null — core/tasks.js already nulls an
     end ≤ start, but a hand-edited/local backup can still carry one, so
     the renderer re-validates before trusting it (defensive only) */
  function taskRange(t) {
    if (!t || !t.start || !t.end) return null;
    const s = TT.util.mins(t.start);
    const e = TT.util.mins(t.end);
    if (!isFinite(s) || !isFinite(e) || e <= s) return null;
    return { s: s, e: e };
  }

  /* course catalog entry: name/color via util (fallback-safe), short code
     straight from data.json courses (fallback: the raw course code) */
  function courseInfo(c) {
    const base = TT.util.courseOf(c) || {};
    const cat = c && TT.data && TT.data.courses ? TT.data.courses[c.course] : null;
    return {
      name: base.name || (c && c.course) || 'class',
      color: base.color || 'var(--acc)',
      short: (cat && cat.short) || (c && c.course) || '?',
    };
  }

  function summaryOf(c, course) {
    const bits = [course.short + (c.type ? '-' + c.type : '')];
    if (course.name) bits.push(course.name);
    bits.push(c.start + '–' + c.end);
    if (c.section) bits.push(c.section);
    if (c.room) bits.push(c.room);
    return bits.join(' · ');
  }

  function dataAttrs(c, course) {
    return ' data-code="' + esc(c.course) + '"' +
      ' data-type="' + esc(c.type || '') + '"' +
      ' data-short="' + esc(course.short) + '"' +
      ' data-name="' + esc(course.name || '') + '"' +
      ' data-sec="' + esc(c.section || '') + '"' +
      ' data-room="' + esc(c.room || '') + '"' +
      ' data-start="' + esc(c.start) + '"' +
      ' data-end="' + esc(c.end) + '"';
  }

  /* 'slot 7–8' — from the entry's own slots field, else derived by matching
     the class start/end against data.slots ('1'…'10') */
  function slotCaption(c) {
    if (c.slots) return 'slot ' + c.slots;
    const slots = TT.data && TT.data.slots;
    if (!slots || typeof slots !== 'object') return '';
    const s = TT.util.mins(c.start);
    const e = TT.util.mins(c.end);
    let first = null;
    let last = null;
    Object.keys(slots).forEach((k) => {
      const span = slots[k];
      if (!Array.isArray(span) || span.length < 2) return;
      const ss = TT.util.mins(span[0]);
      const ee = TT.util.mins(span[1]);
      if (isFinite(ss) && isFinite(ee) && ss >= s && ee <= e) {
        if (first === null) first = k;
        last = k;
      }
    });
    if (first === null) return '';
    return 'slot ' + first + (last && last !== first ? '–' + last : '');
  }

  /* ---------------- segmented control (grid | day) ---------------- */
  function buildSeg() {
    if (!card) return null;
    let el = $('.seg', card);
    if (!el) {
      const head = $('.bento-head', card);
      if (!head) return null;
      el = document.createElement('div');
      el.className = 'seg';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Schedule view');
      head.appendChild(el);
    }
    if (!el.querySelector('[data-view]')) {
      el.innerHTML =
        '<button type="button" data-view="grid" aria-label="Grid view">' +
        '<i data-lucide="layout-grid"></i><span>grid</span></button>' +
        '<button type="button" data-view="day" aria-label="Day view">' +
        '<i data-lucide="list"></i><span>day</span></button>';
    }
    return el;
  }

  function syncSeg() {
    if (!seg) return;
    $$('[data-view]', seg).forEach((btn) => {
      const on = btn.getAttribute('data-view') === state.view;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setView(view) {
    view = validView(view);
    if (view === state.view) return;
    state.view = view;
    TT.prefs.set('week.view', view);
    syncSeg();
    render();
  }

  /* ---------------- day chips ---------------- */
  function buildChips() {
    if (!chips) return;
    if ($$('[data-day]', chips).length !== DAYS.length) {
      chips.innerHTML = DAYS.map((d) =>
        '<button type="button" data-day="' + d + '">' + esc(shortDay(d)) + '</button>'
      ).join('');
    }
  }

  function syncChips() {
    if (!chips) return;
    const today = TT.util.todayKey();
    $$('[data-day]', chips).forEach((btn) => {
      const d = btn.getAttribute('data-day');
      const on = d === state.day;
      const isToday = d === today;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-today', isToday);
      /* cards.css contract: an empty <span class="today-dot"> inside today's
         chip draws the accent dot (and inverts on the active chip) */
      const dot = btn.querySelector('.today-dot');
      if (isToday && !dot) {
        const span = document.createElement('span');
        span.className = 'today-dot';
        span.setAttribute('aria-hidden', 'true');
        btn.appendChild(span);
      } else if (!isToday && dot && dot.parentNode) {
        dot.parentNode.removeChild(dot);
      }
    });
  }

  function selectDay(day, emit) {
    day = validDay(day);
    if (!day) return;
    const changed = day !== state.day;
    state.day = day;
    if (changed) TT.prefs.set('week.day', day);
    syncChips();
    if (emit) TT.emit('tt:day-select', { day: day });
    if (changed && state.view === 'day') render();
  }

  /* ---------------- grid view ---------------- */
  function blockHTML(day, c) {
    const course = courseInfo(c);
    const top = clamp(pct(TT.util.mins(c.start)), 0, 100);
    const bottom = clamp(pct(TT.util.mins(c.end)), 0, 100);
    const height = Math.max(0, bottom - top);
    return '<button type="button" class="wk-block"' +
      ' style="--c:' + esc(course.color) +
      ';top:' + top.toFixed(3) + '%;height:' + height.toFixed(3) + '%"' +
      ' data-day="' + day + '"' + dataAttrs(c, course) +
      ' aria-label="' + esc(summaryOf(c, course)) + '">' +
      '<span class="wk-top">' +
      '<span class="wk-code">' + esc(course.short) + '</span>' +
      (c.type ? '<span class="wk-type">' + esc(c.type) + '</span>' : '') +
      '</span>' +
      (c.room ? '<span class="wk-room">' + esc(c.room) + '</span>' : '') +
      '<span class="wk-time">' + esc(c.start + '–' + c.end) + '</span>' +
      '</button>';
  }

  /* timed-task strip: pinned at the task's start % with the same pct()
     math as blocks — the inline clamp() keeps tasks outside 07:00–17:00
     visible at the track edges instead of letting the track's
     overflow:hidden clip them away. A task with a valid end renders as
     a RANGE strip: height = (end-start)/600*100% like a block (min
     TASK_H px, so a tiny range stays readable), clamped window edges
     included; no-end tasks keep the thin TASK_H px marker. The time
     line ships inside every range strip — sizeBlocks() reveals it via
     .is-tall once the strip measures ≥ RANGE_TALL_PX */
  function taskMarkerHTML(t) {
    const top = clamp(pct(TT.util.mins(t.start)), 0, 100);
    const range = taskRange(t);
    if (!range) {
      return '<button type="button" class="wk-task' + (t.done ? ' is-done' : '') + '"' +
        ' style="top:clamp(0%, ' + top.toFixed(3) + '%, calc(100% - ' + TASK_H + 'px))"' +
        taskAttrs(t) +
        ' aria-label="' + esc('task: ' + t.title + ' · ' + t.start) + '">' +
        '<span class="wk-tbox" aria-hidden="true"></span>' +
        '<span class="wk-tname">' + esc(t.title) + '</span>' +
        '</button>';
    }
    const bottom = clamp(pct(range.e), 0, 100);
    const height = Math.max(0, bottom - top);
    const hCss = 'max(' + TASK_H + 'px, ' + height.toFixed(3) + '%)';
    return '<button type="button" class="wk-task is-range' + (t.done ? ' is-done' : '') + '"' +
      ' style="top:clamp(0%, ' + top.toFixed(3) + '%, calc(100% - ' + hCss + '));height:' + hCss + '"' +
      taskAttrs(t) +
      ' aria-label="' + esc('task: ' + t.title + ' · ' + t.start + '–' + t.end) + '">' +
      '<span class="wk-tbox" aria-hidden="true"></span>' +
      '<span class="wk-tname">' + esc(t.title) + '</span>' +
      '<span class="wk-ttime">' + esc(t.start + '–' + t.end) + '</span>' +
      '</button>';
  }

  /* data.breaks that intersect 07:00–17:00, clipped to the window */
  function breaksHTML() {
    const list = TT.data && Array.isArray(TT.data.breaks) ? TT.data.breaks : [];
    return list.map((b) => {
      const s = TT.util.mins(b && b.start);
      const e = TT.util.mins(b && b.end);
      if (!isFinite(s) || !isFinite(e)) return '';
      const top = clamp(pct(Math.max(s, OPEN)), 0, 100);
      const bottom = clamp(pct(Math.min(e, CLOSE)), 0, 100);
      if (bottom - top <= 0) return '';
      const label = String((b && b.label) || 'break').toLowerCase();
      return '<div class="wk-break" aria-hidden="true"' +
        ' style="top:' + top.toFixed(3) + '%;height:' + (bottom - top).toFixed(3) + '%">' +
        '<span class="wk-break-label">' + esc(label) + '</span></div>';
    }).join('');
  }

  function renderGrid() {
    const today = TT.util.todayKey();
    let hours = '';
    for (let h = 7; h <= 17; h += 1) { // 07:00–16:00 stripe labels + 17:00 closer
      hours += '<span class="wk-hour" style="top:' + pct(h * 60).toFixed(3) + '%">' +
        esc(TT.util.fmt(h * 60)) + '</span>';
    }
    let cols = '';
    DAYS.forEach((d) => {
      const list = classesOnDay(d);
      const blocks = list.map((c) => blockHTML(d, c)).join('');
      const markers = timedTasksFor(d).map(taskMarkerHTML).join('');
      const n = list.length;
      cols += '<div class="wk-daycol' + (d === today ? ' is-today' : '') + (n ? '' : ' is-empty') + '"' +
        ' data-day="' + d + '">' +
        '<div class="wk-dayhead">' +
        '<span class="wk-dayname">' + esc(shortDay(d)) + '</span>' +
        '<span class="wk-count">' + n + (n === 1 ? ' class' : ' classes') + '</span>' +
        '</div>' +
        '<div class="wk-daytrack">' + blocks + markers + '</div>' +
        '</div>';
    });
    body.innerHTML = '<div class="wk-scroll"><div class="wk-grid">' +
      '<div class="wk-gutter" aria-hidden="true">' +
      '<div class="wk-ghead"></div><div class="wk-gtrack">' + hours + '</div></div>' +
      '<div class="wk-days">' +
      '<div class="wk-bands" aria-hidden="true">' + breaksHTML() + '</div>' + cols +
      '</div></div></div>';
    nowlineEl = null; // grid rebuilt — drop cached refs
    nowlineTop = '';
    const col = $('.wk-daycol[data-day="' + today + '"]', body);
    todayTrack = col ? $('.wk-daytrack', col) : null;
    sizeBlocks();
    updateNowline(new Date());
  }

  /* one measure pass after a grid render: blocks taller than TALL_PX earn
     the time line, break bands ≥ LABEL_PX earn their label, range task
     strips ≥ RANGE_TALL_PX earn their time line — measured in real px
     so a --wk-pitch override never breaks the thresholds */
  function sizeBlocks() {
    $$('.wk-block', body).forEach((block) => {
      block.classList.toggle('is-tall', block.clientHeight > TALL_PX);
    });
    $$('.wk-break', body).forEach((band) => {
      band.classList.toggle('is-roomy', band.clientHeight >= LABEL_PX);
    });
    $$('.wk-task.is-range', body).forEach((strip) => {
      strip.classList.toggle('is-tall', strip.clientHeight >= RANGE_TALL_PX);
    });
  }

  /* pink nowline inside today's track — moved on tick, never rebuilt.
     Node/track refs and the last written position are cached, so the
     per-second tick does no querySelector work and no same-value writes. */
  function updateNowline(now) {
    if (!body || state.view !== 'grid') return;
    const today = TT.util.todayKey();
    const m = minsOf(now);
    const show = DAYS.indexOf(today) !== -1 && m >= OPEN && m <= CLOSE;
    let line = (nowlineEl && nowlineEl.isConnected) ? nowlineEl : $('.wk-nowline', body);
    if (!show) {
      if (line && line.parentNode) line.parentNode.removeChild(line);
      nowlineEl = null;
      nowlineTop = '';
      return;
    }
    let track = (todayTrack && todayTrack.isConnected) ? todayTrack : null;
    if (!track) {
      const col = $('.wk-daycol[data-day="' + today + '"]', body);
      track = col ? $('.wk-daytrack', col) : null;
    }
    if (!track) return;
    todayTrack = track;
    if (!line) {
      line = document.createElement('div');
      line.className = 'wk-nowline';
      line.setAttribute('aria-hidden', 'true');
    }
    if (line.parentNode !== track) track.appendChild(line);
    nowlineEl = line;
    const top = pct(m).toFixed(3) + '%';
    if (top !== nowlineTop) { // the value only changes once per minute
      nowlineTop = top;
      line.style.top = top;
    }
  }

  /* ---------------- day view ---------------- */

  /* the gap between two classes as an ordered mix of scheduled breaks
     (data.breaks) and leftover free spans ≥ FREE_MIN */
  function gapSegments(s, e) {
    const out = [];
    const spans = [];
    const breaks = TT.data && Array.isArray(TT.data.breaks) ? TT.data.breaks : [];
    breaks.forEach((b) => {
      const bs = TT.util.mins(b && b.start);
      const be = TT.util.mins(b && b.end);
      if (!isFinite(bs) || !isFinite(be)) return;
      const cs = Math.max(s, bs);
      const ce = Math.min(e, be);
      if (ce > cs) spans.push({ s: cs, e: ce, label: String((b && b.label) || 'break').toLowerCase() });
    });
    spans.sort((a, b) => a.s - b.s);
    let cur = s;
    spans.forEach((sp) => {
      if (sp.s - cur >= FREE_MIN) out.push({ s: cur, e: sp.s, free: true });
      out.push(sp);
      cur = Math.max(cur, sp.e);
    });
    if (e - cur >= FREE_MIN) out.push({ s: cur, e: e, free: true });
    return out;
  }

  function fillerRowHTML(segRow, i, isToday, nowM) {
    const past = isToday && segRow.e <= nowM;
    const label = (segRow.free ? 'free' : segRow.label) + ' · ' + TT.util.hm(segRow.e - segRow.s);
    return '<div class="wa-row reveal ' + (segRow.free ? 'wa-gap' : 'wa-break') + (past ? ' is-past' : '') + '"' +
      ' style="animation-delay:' + (Math.min(i, 12) * STAGGER) + 'ms"' +
      ' data-s="' + segRow.s + '" data-e="' + segRow.e + '">' +
      '<div class="wa-time">' +
      '<span class="wa-start">' + esc(TT.util.fmt(segRow.s)) + '</span>' +
      '<span class="wa-end">' + esc(TT.util.fmt(segRow.e)) + '</span>' +
      '</div>' +
      '<div class="wa-main"><span class="wa-note">' + esc(label) + '</span></div>' +
      '</div>';
  }

  function classRowHTML(c, i, isToday, nowM) {
    const course = courseInfo(c);
    const s = TT.util.mins(c.start);
    const e = TT.util.mins(c.end);
    const live = isToday && s <= nowM && nowM < e;
    const past = isToday && e <= nowM;
    let cls = 'wa-row reveal';
    if (live) cls += ' is-live';
    if (past) cls += ' is-past';
    const title = course.short + (c.type ? '-' + c.type : '') +
      (c.section ? ' · ' + c.section : '') +
      (c.room ? ' · ' + c.room : '');
    const slot = slotCaption(c);
    return '<div class="' + cls + '"' +
      ' style="--c:' + esc(course.color) + ';animation-delay:' + (Math.min(i, 12) * STAGGER) + 'ms"' +
      ' data-s="' + s + '" data-e="' + e + '"' + dataAttrs(c, course) + '>' +
      '<div class="wa-time">' +
      '<span class="wa-start">' + esc(c.start) + '</span>' +
      '<span class="wa-end">' + esc(c.end) + '</span>' +
      (slot ? '<span class="wa-slots">' + esc(slot) + '</span>' : '') +
      '</div>' +
      '<div class="wa-main">' +
      '<div class="wa-title">' + esc(title) + (live ? '<span class="badge-live">live</span>' : '') + '</div>' +
      '<div class="wa-sub">' + esc(course.name) + '</div>' +
      '</div></div>';
  }

  /* timed task: mono time cell + hollow-square marker + title + a faint
     'task' tag; no data-code → refreshRows dims it when past but never
     adds the live badge. A task with a valid end shows the real range
     ('09:00' / '10:00' stacked) plus a duration meta line; mins-only
     tasks keep the computed end (start + mins), which earns the same
     meta line. data-e drives refreshRows dimming, so it tracks the
     effective end in all three cases */
  function taskRowHTML(t, i, isToday, nowM) {
    const s = TT.util.mins(t.start);
    const range = taskRange(t);
    const e = range ? range.e : (t.mins ? s + t.mins : s);
    const endLabel = range ? t.end : (t.mins ? TT.util.fmt(e) : null);
    let cls = 'wa-row wa-task reveal';
    if (isToday && e <= nowM) cls += ' is-past';
    if (t.done) cls += ' is-done';
    return '<div class="' + cls + '"' +
      ' style="animation-delay:' + (Math.min(i, 12) * STAGGER) + 'ms"' +
      ' data-s="' + s + '" data-e="' + e + '"' + taskAttrs(t) + '>' +
      '<div class="wa-time">' +
      '<span class="wa-start">' + esc(t.start) + '</span>' +
      (endLabel ? '<span class="wa-end">' + esc(endLabel) + '</span>' : '') +
      '</div>' +
      '<div class="wa-main">' +
      '<div class="wa-title">' +
      '<span class="wa-tbox" aria-hidden="true"></span>' +
      '<span class="wa-tname">' + esc(t.title) + '</span>' +
      '<span class="wa-tag">task</span>' +
      '</div>' +
      (e > s ? '<div class="wa-sub">' + esc(TT.util.hm(e - s)) + '</div>' : '') +
      '</div></div>';
  }

  function renderDay() {
    const list = classesOnDay(state.day);
    const tasks = timedTasksFor(state.day);
    if (!list.length && !tasks.length) {
      body.innerHTML = '<div class="bento-empty">' +
        '<i data-lucide="coffee"></i>' +
        '<span class="bento-empty-title">nothing on ' +
        esc((TT.util.dayLabel(state.day) || state.day).toLowerCase()) + '.</span>' +
        '<span class="bento-empty-sub">no classes synced for this day — pick another one.</span>' +
        '</div>';
      return;
    }
    const nowM = minsOf(new Date());
    const isToday = state.day === TT.util.todayKey();
    /* one ordered item list: class rows, the break/free rows between
       them (unchanged gapSegments math), and timed-task rows — merged
       by start time, stable so same-minute items keep generation order
       (classes before tasks) */
    const items = [];
    list.forEach((c, idx) => {
      if (idx > 0) {
        const gapStart = TT.util.mins(list[idx - 1].end);
        const gapEnd = TT.util.mins(c.start);
        if (gapEnd > gapStart) {
          gapSegments(gapStart, gapEnd).forEach((segRow) => {
            items.push({ kind: 'fill', seg: segRow, s: segRow.s });
          });
        }
      }
      items.push({ kind: 'class', c: c, s: TT.util.mins(c.start) });
    });
    tasks.forEach((t) => {
      items.push({ kind: 'task', t: t, s: TT.util.mins(t.start) });
    });
    items.sort((a, b) => a.s - b.s);
    let rows = '';
    items.forEach((it, i) => {
      if (it.kind === 'class') rows += classRowHTML(it.c, i, isToday, nowM);
      else if (it.kind === 'fill') rows += fillerRowHTML(it.seg, i, isToday, nowM);
      else rows += taskRowHTML(it.t, i, isToday, nowM);
    });
    body.innerHTML = '<div class="wa-rows">' + rows + '</div>';
  }

  /* live/past states updated in place — no rebuild, reveal anim stays put */
  function refreshRows(now) {
    if (!body || state.view !== 'day') return;
    const m = minsOf(now);
    const isToday = state.day === TT.util.todayKey();
    $$('.wa-row[data-s]', body).forEach((row) => {
      const s = parseInt(row.getAttribute('data-s'), 10);
      const e = parseInt(row.getAttribute('data-e'), 10);
      if (!isFinite(s) || !isFinite(e)) return;
      row.classList.toggle('is-past', isToday && e <= m);
      if (!row.getAttribute('data-code')) return; // break/free rows never go live
      const live = isToday && s <= m && m < e;
      row.classList.toggle('is-live', live);
      const title = row.querySelector('.wa-title');
      if (!title) return;
      let badge = title.querySelector('.badge-live');
      if (live && !badge) {
        badge = document.createElement('span');
        badge.className = 'badge-live';
        badge.textContent = 'live';
        title.appendChild(badge);
      } else if (!live && badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }
    });
  }

  /* ---------------- render dispatch ---------------- */
  function render() {
    if (!body || !TT.dataReady) return;
    if (state.view === 'grid') renderGrid();
    else renderDay();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function toastFrom(el) {
    const d = el.dataset || {};
    if (!d.code) return;
    const bits = [(d.short || d.code) + (d.type ? '-' + d.type : '')];
    if (d.name) bits.push(d.name);
    if (d.start && d.end) bits.push(d.start + '–' + d.end);
    if (d.sec) bits.push(d.sec);
    if (d.room) bits.push(d.room);
    TT.emit('tt:toast', { msg: bits.join(' · ') });
  }

  function toastTask(el) {
    const d = el.dataset || {};
    if (!d.title) return;
    const when = d.start ? ' · ' + d.start + (d.end ? '–' + d.end : '') : '';
    TT.emit('tt:toast', { msg: 'task: ' + d.title + when });
  }

  /* ---------------- events ---------------- */
  function onTick(now) {
    /* cross-realm-safe Date check (same duck-type as core/data.js isDate):
       a Date from another realm fails instanceof but has getTime */
    const ok = now instanceof Date || !!(now && typeof now.getTime === 'function');
    const date = ok ? now : new Date();
    const today = TT.util.todayKey();
    if (today !== lastToday) {           // midnight rollover
      lastToday = today;
      syncChips();
      render();
      return;
    }
    if (state.view === 'grid') updateNowline(date);
    else refreshRows(date);
  }

  function init() {
    seg = buildSeg();
    if (seg) {
      seg.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-view]') : null;
        if (btn && seg.contains(btn)) setView(btn.getAttribute('data-view'));
      });
      syncSeg();
    }

    chips = document.getElementById('tt-day-chips');
    if (chips) {
      buildChips();
      chips.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-day]') : null;
        if (btn && chips.contains(btn)) selectDay(btn.getAttribute('data-day'), true);
      });
      syncChips();
    }

    if (body) {
      body.addEventListener('click', (e) => {
        const tEl = e.target && e.target.closest ? e.target.closest('.wk-task, .wa-task') : null;
        if (tEl && body.contains(tEl)) { toastTask(tEl); return; }
        const el = e.target && e.target.closest ? e.target.closest('.wk-block, .wa-row[data-code]') : null;
        if (el && body.contains(el)) toastFrom(el);
      });
    }

    TT.on('tt:tick', onTick);
    TT.on('tt:tasks-changed', render); // timed tasks → strips/rows
    TT.on('tt:day-select', (detail) => {
      const day = detail && detail.day;
      if (day && day !== state.day) selectDay(day, false);
    });

    TT.whenReady(render); // first paint wipes the .skel placeholders
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  init();
})();
