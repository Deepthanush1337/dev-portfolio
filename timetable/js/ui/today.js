/* today.js — tt-today card: vertical timeline for the REAL current day.
 * Merges today's classes with data.breaks that fall inside the class span,
 * plus today's TIMED TASKS (TT.tasks entries with day === today && start)
 * interleaved chronologically, plus "free" gap rows between any two adjacent
 * items. Task windows run start→end (v5 task.end 'HH:MM' when valid, else
 * start+mins||30, clamped to midnight) — the time cell always shows the full
 * range. A task whose window CONTAINS now renders .is-live: pink pulsing
 * hollow-square marker, a 'now' .badge-live chip and an 'ends in Nm' .tl-count
 * chip next to the title; fully past windows render .is-past. Gaps measure
 * from the running max end of all placed items, so a range task overlapping
 * what would be a free gap shrinks/merges it (no "free" over busy time).
 * Full rebuild only on structural change (day rollover, live/past transitions,
 * timed-task add/remove/toggle/edit via tt:tasks-changed); live "ends in Nm"
 * countdowns are cached nodes (class + any number of live tasks) updated per
 * tt:tick with last-value compares — ticking text never triggers a rebuild.
 * Row contract (timeline.css): .tl-row > .tl-time(.tl-start/.tl-end) + .tl-rail(.tl-dot) + .tl-card(--c)
 * modifiers: .is-live (+ .badge-live + .tl-count), .is-past, .is-gap ("free · 45m"), .tl-break
 * task rows: .tl-row.tl-task (+ .is-live / .is-done) > ... + .tl-card(.tl-check + .tl-task-title [+ chips])
 */
(function () {
  'use strict';

  var TT = window.TT;
  if (!TT || !TT.util) return;

  var TYPE_LABEL = { L: 'lecture', P: 'practical', S: 'skill', T: 'tutorial' };
  var KIND_RANK = { class: 0, break: 1, task: 2 }; // sort tie-break on equal starts
  var GAP_MIN = 20;      // idle minutes before a gap earns its own row
  var SCROLL_ROWS = 6;   // beyond this many rows the body gets .scroll (capped height)

  var body = null;
  var lastMinute = -1;
  var lastSig = '';
  var counts = []; // cached live countdown chips: [{ el, end, last }] — refilled on every render

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function chip(text) {
    return el('span', 'chip', text);
  }

  function typeLabel(t) {
    return TYPE_LABEL[t] || String(t || '').toLowerCase();
  }

  function emptySub(date, day) {
    if (day === 'sun') return 'sunday — reset, recharge, be a person.';
    try {
      var n = TT.util.nextClass(date);
      if (n && n.cls) {
        return 'next up: ' + TT.util.dayLabel(n.day).toLowerCase() + ' ' +
          n.cls.start + ' · ' + n.cls.course;
      }
    } catch (e) { /* nextClass not usable yet — fall through to generic */ }
    return 'no classes scheduled — use the time well.';
  }

  function renderEmpty(date, day) {
    var wrap = el('div', 'bento-empty');
    var icon = el('i');
    icon.setAttribute('data-lucide', day === 'sun' ? 'sun' : 'coffee');
    wrap.appendChild(icon);
    wrap.appendChild(el('span', 'bento-empty-title', 'nothing today. touch grass.'));
    wrap.appendChild(el('span', 'bento-empty-sub', emptySub(date, day)));
    body.appendChild(wrap);
  }

  /* task window end in minutes since midnight: task.end ('HH:MM', only when it
   * parses and is > start) else start + (mins || 30) — clamped to midnight */
  function taskWindowEnd(t, s) {
    var e = t.end ? TT.util.mins(t.end) : NaN;
    if (!isFinite(e) || e <= s) e = s + (t.mins || 30);
    return Math.min(e, 1440);
  }

  /* today's timed tasks as time-sorted items (NOT bounded by the class span —
   * a 20:00 task still renders on a class-light day).
   * item: { kind:'task', s, e, start, end, task } — end is the resolved window
   * end (task.end when set, else start+mins||30) */
  function timedTaskItems(day) {
    var out = [];
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return out;
    var list = TT.tasks.list();
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || t.day !== day || !t.start) continue;
      var s = TT.util.mins(t.start);
      if (!isFinite(s)) continue;
      var e = taskWindowEnd(t, s);
      out.push({ kind: 'task', s: s, e: e, start: t.start, end: TT.util.fmt(e), task: t });
    }
    return out;
  }

  /* classes + in-span breaks + timed tasks as one time-sorted item list.
   * item: { kind:'class'|'break'|'task', s, e, start, end, cls?, label?, task? } */
  function buildItems(classes, day) {
    var items = [];
    var firstStart = Infinity;
    var lastEnd = -Infinity;
    var i, s, e;

    for (i = 0; i < classes.length; i++) {
      s = TT.util.mins(classes[i].start);
      e = TT.util.mins(classes[i].end);
      if (!isFinite(s) || !isFinite(e) || e <= s) continue;
      if (s < firstStart) firstStart = s;
      if (e > lastEnd) lastEnd = e;
      items.push({ kind: 'class', s: s, e: e, start: classes[i].start, end: classes[i].end, cls: classes[i] });
    }

    if (items.length) {
      var list = TT.data && Array.isArray(TT.data.breaks) ? TT.data.breaks : [];
      for (i = 0; i < list.length; i++) {
        var br = list[i];
        if (!br || !br.start || !br.end) continue;
        s = TT.util.mins(br.start);
        e = TT.util.mins(br.end);
        if (!isFinite(s) || !isFinite(e) || e <= s) continue;
        if (s < firstStart || e > lastEnd) continue; // outside today's class span
        items.push({ kind: 'break', s: s, e: e, start: br.start, end: br.end, label: br.label });
      }
    }

    var timed = timedTaskItems(day);
    for (i = 0; i < timed.length; i++) items.push(timed[i]);

    items.sort(function (a, b) {
      if (a.s !== b.s) return a.s - b.s;
      return KIND_RANK[a.kind] - KIND_RANK[b.kind]; // classes, then breaks, then tasks
    });
    return items;
  }

  /* gap row spanning fromMins → next.start. fromMins is the running max end of
   * everything placed so far, NOT just the previous item's end — a range task
   * overlapping the gap shrinks it to the part that is actually free */
  function buildGapRow(fromMins, next) {
    var gap = next.s - fromMins;
    var row = el('div', 'tl-row is-gap');

    var time = el('div', 'tl-time');
    time.appendChild(el('span', 'tl-start', TT.util.fmt(fromMins)));
    time.appendChild(el('span', 'tl-end', next.start));
    row.appendChild(time);

    var rail = el('div', 'tl-rail');
    rail.appendChild(el('span', 'tl-dot'));
    row.appendChild(rail);

    row.appendChild(el('div', 'tl-gap', 'free · ' + TT.util.hm(gap)));
    return row;
  }

  function buildBreakRow(item, nowMins) {
    var row = el('div', 'tl-row tl-break' + (item.e <= nowMins ? ' is-past' : ''));

    var time = el('div', 'tl-time');
    time.appendChild(el('span', 'tl-start', item.start));
    time.appendChild(el('span', 'tl-end', item.end));
    row.appendChild(time);

    var rail = el('div', 'tl-rail');
    rail.appendChild(el('span', 'tl-dot'));
    row.appendChild(rail);

    var card = el('div', 'tl-card');
    var label = String(item.label || 'break').toLowerCase() + ' · ' + TT.util.hm(item.e - item.s);
    card.appendChild(el('span', 'tl-break-label', label));
    row.appendChild(card);
    return row;
  }

  /* timed task row: hollow-square rail marker + mini checkbox + title.
   * Window containing now → .is-live (pulsing pink marker, 'now' badge +
   * 'ends in Nm' chip after the title); window fully passed → .is-past. */
  function buildTaskRow(item, nowMins) {
    var task = item.task;
    var isLive = item.s <= nowMins && nowMins < item.e;
    var isPast = !isLive && item.e <= nowMins;
    var row = el('div', 'tl-row tl-task' +
      (isLive ? ' is-live' : '') + (isPast ? ' is-past' : '') + (task.done ? ' is-done' : ''));

    var time = el('div', 'tl-time');
    time.appendChild(el('span', 'tl-start', item.start));
    time.appendChild(el('span', 'tl-end', item.end));
    row.appendChild(time);

    var rail = el('div', 'tl-rail');
    rail.appendChild(el('span', 'tl-dot'));
    row.appendChild(rail);

    var card = el('div', 'tl-card');

    var btn = el('button', 'tl-check');
    btn.type = 'button';
    btn.setAttribute('aria-label', (task.done ? 'mark active' : 'mark done') + ': ' + task.title);
    btn.setAttribute('aria-pressed', task.done ? 'true' : 'false');
    // static markup only — same check-draw pattern as the tasks card
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    btn.addEventListener('click', function (e) {
      var completing = !task.done; // snapshot from render time — row rebuilds on toggle
      TT.tasks.toggle(task.id);
      if (completing) {
        /* keyboard/synthetic clicks carry clientX/Y 0,0 — burst from the
           checkbox instead of the viewport corner (mirrors ui/tasks.js) */
        var pt = null;
        if (e.clientX || e.clientY) {
          pt = { x: e.clientX, y: e.clientY };
        } else {
          var r = btn.getBoundingClientRect();
          if (r && (r.width || r.height)) pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        TT.emit('tt:celebrate', pt || {});
      }
    });
    card.appendChild(btn);

    card.appendChild(el('span', 'tl-task-title', task.title)); // textContent — user text stays escaped

    if (isLive) {
      card.appendChild(el('span', 'badge-live', 'now'));
      var tCount = el('span', 'tl-count', ''); // text filled by updateCountdown
      counts.push({ el: tCount, end: item.e, last: '' });
      card.appendChild(tCount);
    }
    row.appendChild(card);
    return row;
  }

  function buildClassRow(cls, nowMins, liveCls) {
    var course = TT.util.courseOf(cls);
    var start = TT.util.mins(cls.start);
    var end = TT.util.mins(cls.end);
    var isLive = liveCls === cls || (nowMins >= start && nowMins < end);
    var isPast = !isLive && end <= nowMins;

    var row = el('div', 'tl-row' + (isLive ? ' is-live' : '') + (isPast ? ' is-past' : ''));
    row.style.setProperty('--c', course.color);

    var time = el('div', 'tl-time');
    time.appendChild(el('span', 'tl-start', cls.start));
    time.appendChild(el('span', 'tl-end', cls.end));
    row.appendChild(time);

    var rail = el('div', 'tl-rail');
    rail.appendChild(el('span', 'tl-dot'));
    row.appendChild(rail);

    var card = el('div', 'tl-card');
    card.style.setProperty('--c', course.color);

    var main = el('div', 'tl-main');
    main.appendChild(el('span', 'tl-code', cls.course));
    main.appendChild(el('span', 'tl-name', course.name));
    if (isLive) main.appendChild(el('span', 'badge-live', 'LIVE'));
    card.appendChild(main);

    var meta = el('div', 'tl-meta');
    if (isLive) {
      // cached for updateCountdown — text is filled right after render
      var cCount = el('span', 'tl-count', '');
      counts.push({ el: cCount, end: end, last: '' });
      meta.appendChild(cCount);
    }
    meta.appendChild(chip(typeLabel(cls.type)));
    if (cls.section) meta.appendChild(chip(cls.section));
    if (cls.room) meta.appendChild(chip(cls.room));
    card.appendChild(meta);

    row.appendChild(card);
    return row;
  }

  /* tick every cached live "ends in Nm" chip — minute-granular, writes only
   * on change. Disconnected nodes (row rebuilt since) are dropped lazily. */
  function updateCountdown(date) {
    if (!counts.length) return;
    var nowM = date.getHours() * 60 + date.getMinutes();
    for (var i = counts.length - 1; i >= 0; i--) {
      var c = counts[i];
      if (!c.el.isConnected) { counts.splice(i, 1); continue; }
      var left = c.end - nowM;
      if (left < 1) continue; // end boundary — render() rebuilds this row on the same tick
      var txt = 'ends in ' + TT.util.hm(left);
      if (txt === c.last) continue;
      c.last = txt;
      c.el.textContent = txt;
    }
  }

  /* signature of everything time-visible: day + past/live transitions + a
   * fingerprint of today's timed tasks (id/window/done/title) so toggles and
   * edits via tt:tasks-changed force exactly one rebuild. liveT makes a task
   * entering/leaving its window a structural change (chips appear/disappear) */
  function stateSig(day, items, nowMins, liveCls) {
    var pastC = 0;
    var pastB = 0;
    var pastT = 0;
    var liveT = 0;
    var tSig = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'task') {
        tSig.push(it.task.id + ':' + it.s + ':' + it.e + ':' + (it.task.done ? 1 : 0) + ':' + it.task.title);
        if (it.s <= nowMins && nowMins < it.e) liveT++;
        else if (it.e <= nowMins) pastT++;
      } else if (it.e <= nowMins) {
        if (it.kind === 'break') pastB++; else pastC++;
      }
    }
    return day + '|' + pastC + '|' + pastB + '|' + pastT + '|' + liveT + '|' +
      (liveCls ? liveCls.course + liveCls.start : '-') + '|' + tSig.join(',');
  }

  function render(date) {
    if (!body) return;
    var day = TT.util.todayKey();
    var nowMins = date.getHours() * 60 + date.getMinutes();
    var classes = TT.util.classesOn(day).slice().sort(function (a, b) {
      return TT.util.mins(a.start) - TT.util.mins(b.start);
    });
    var items = buildItems(classes, day);

    var liveCls = null;
    try { liveCls = TT.util.ongoing(date); } catch (e) { liveCls = null; }

    var sig = stateSig(day, items, nowMins, liveCls);
    if (sig === lastSig) return; // nothing time-visible changed
    lastSig = sig;

    counts = []; // fresh render — countdown cache refilled by the row builders
    body.innerHTML = ''; // clears skeletons (.skel) from the shell

    if (!items.length) {
      body.classList.remove('scroll');
      renderEmpty(date, day);
    } else {
      var rows = 0;
      var prev = null;
      var tail = -1; // running max end (mins) of everything placed so far
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (prev && it.s - tail >= GAP_MIN) {
          body.appendChild(buildGapRow(tail, it));
          rows++;
        }
        body.appendChild(
          it.kind === 'break' ? buildBreakRow(it, nowMins) :
          it.kind === 'task' ? buildTaskRow(it, nowMins) :
          buildClassRow(it.cls, nowMins, liveCls)
        );
        rows++;
        if (it.e > tail) tail = it.e;
        prev = it;
      }
      body.classList.toggle('scroll', rows > SCROLL_ROWS);
    }

    updateCountdown(date); // fill the live countdown now — no 1s blank

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function init() {
    body = document.getElementById('tt-today-body');
    if (!body) return;

    render(new Date());

    TT.on('tt:tick', function (date) {
      var d = date instanceof Date ? date : new Date();
      updateCountdown(d); // every tick: cached node + last-value compare, no rebuilds
      var minute = d.getHours() * 60 + d.getMinutes();
      if (minute === lastMinute && lastSig) return; // structure can only flip on minute change
      lastMinute = minute;
      render(d);
    });

    /* timed-task add/remove/toggle/edit — sig diff makes this a no-op when
       today's timed tasks are untouched (e.g. only untimed tasks changed) */
    TT.on('tt:tasks-changed', function () { render(new Date()); });
  }

  TT.whenReady(init);
})();
