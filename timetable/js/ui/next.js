/* ui/next.js — tt-next card: the next upcoming class with a live "starts in" countdown.
   Renders inside #tt-next-body only. Click jumps the week card to that day. */
(function () {
  'use strict';

  var TT = window.TT;
  if (!TT || !TT.util) return;

  var MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';

  var body = null;   // #tt-next-body, resolved on init
  var inEl = null;   // big countdown node — cheap per-tick text updates
  var lastKey = '';  // identity of what's rendered; full rerender only when it changes
  var lastIn = '';   // last written countdown text — skip same-value per-second writes

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function icons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  /* Eyebrow tag: TODAY for today's classes, otherwise the 3-letter day (MON…). */
  function tagFor(day) {
    return day === TT.util.todayKey() ? 'TODAY' : String(day || '').slice(0, 3).toUpperCase();
  }

  function startsInText(min) {
    return min <= 0 ? 'starting now' : 'in ' + TT.util.hm(min);
  }

  /* Far-future classes read as "mon 09:20" instead of a cold "in 44h 16m";
     same-day keeps the live countdown. */
  function displayText(t) {
    if (t.startsInMin > 720 && t.day !== TT.util.todayKey()) {
      return String(t.day).slice(0, 3).toLowerCase() + ' ' + t.cls.start;
    }
    return startsInText(t.startsInMin);
  }

  /* Soonest unticked timed task still ahead of now today (day + start set,
     start > now) — null when none. Done tasks are past, never "next". */
  function nextTaskToday(now, today) {
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return null;
    if (!(now instanceof Date)) now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var list;
    try { list = TT.tasks.list() || []; } catch (e) { return null; }
    var best = null, bestS = Infinity;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || t.done || t.day !== today || !t.start) continue;
      var s = TT.util.mins(t.start);
      if (!isFinite(s) || s <= nowMin) continue;
      if (s < bestS) { best = t; bestS = s; }
    }
    return best;
  }

  /* secondary acc2 mono line under the class info: 'task at 14:30 · <title>'
     (visuals live in planner.css — it owns misc this wave) */
  function taskLine(task) {
    return '<span class="nx-task">task at ' + esc(task.start) + ' · ' + esc(task.title) + '</span>';
  }

  /* Idle: nothing upcoming — muted, gently floating. When a timed task is
     still due today it rides along as a secondary line under the chill copy. */
  function renderIdle(task) {
    inEl = null;
    lastIn = '';
    body.innerHTML =
      '<div class="bento-empty nx-idle" role="status" style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 12px;text-align:center;color:rgba(255,255,255,.38);animation:float 6s var(--ease) ease-in-out infinite">' +
        '<i data-lucide="coffee" style="width:22px;height:22px;opacity:.55"></i>' +
        '<p style="margin:0;font-size:.85rem;line-height:1.65">nothing scheduled.<br>the week is yours.</p>' +
        (task ? taskLine(task) : '') +
      '</div>';
    icons();
  }

  function bindCard(card, day, color) {
    function on() {
      card.style.transform = 'translateY(-2px)';
      card.style.borderColor = color + '66';
      card.style.boxShadow = '0 14px 34px -14px ' + color + '55';
    }
    function off() {
      card.style.transform = '';
      card.style.borderColor = 'rgba(255,255,255,.09)';
      card.style.boxShadow = 'none';
    }
    card.addEventListener('mouseenter', on);
    card.addEventListener('mouseleave', off);
    card.addEventListener('focus', on);
    card.addEventListener('blur', off);
    card.addEventListener('click', function () {
      TT.emit('tt:day-select', { day: day });
    });
  }

  /* Full render of the next-class card (replaces any .skel placeholders).
     `task` (optional) adds a secondary timed-task line under the class info. */
  function renderNext(t, task) {
    var cls = t.cls;
    var course = TT.util.courseOf(cls);
    var color = course.color || '#c8ff00';
    var tag = tagFor(t.day);

    body.innerHTML =
      '<button type="button" class="nx-card" data-day="' + esc(t.day) + '"' +
        ' aria-label="Next class: ' + esc(cls.course) + ', ' + esc(course.name) + ', ' + esc(tag.toLowerCase()) + '.' +
          (task ? ' Task at ' + esc(task.start) + ': ' + esc(task.title) + '.' : '') +
          ' Jump to day in week view."' +
        ' style="position:relative;display:flex;flex-direction:column;align-items:stretch;gap:12px;width:100%;padding:16px;margin:0;border-radius:18px;text-align:left;font:inherit;color:inherit;cursor:pointer;overflow:hidden;appearance:none;' +
        'background:radial-gradient(130% 150% at 100% 0%,' + color + '14,transparent 55%),linear-gradient(165deg,rgba(255,255,255,.05),rgba(255,255,255,.015));' +
        'border:1px solid rgba(255,255,255,.09);box-shadow:none;' +
        'transition:transform .35s var(--ease),border-color .35s var(--ease),box-shadow .35s var(--ease);' +
        'animation:pop .45s var(--ease) both">' +

        '<span class="nx-day" style="font-size:.62rem;font-weight:800;letter-spacing:.16em;color:' +
          (tag === 'TODAY' ? 'var(--live)' : 'rgba(255,255,255,.42)') + '">' + tag + '</span>' +

        '<span class="now-course nx-course" style="display:flex;align-items:baseline;gap:8px;min-width:0">' +
          '<strong class="nx-code" style="font-family:' + MONO + ';font-size:1rem;font-weight:800;letter-spacing:.02em;color:' + color + '">' + esc(cls.course) + '</strong>' +
          '<span class="nx-name" style="font-size:.82rem;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(course.name) + '</span>' +
        '</span>' +

        '<span class="nx-chips" style="display:flex;flex-wrap:wrap;gap:6px">' +
          '<span class="chip nx-chip"><i data-lucide="clock"></i>' + esc(cls.start + '–' + cls.end) + '</span>' +
          (cls.room ? '<span class="chip nx-chip"><i data-lucide="map-pin"></i>' + esc(cls.room) + '</span>' : '') +
        '</span>' +

        '<span class="nx-in" style="font-family:' + MONO + ';font-size:clamp(1.75rem,4.5vw,2.4rem);font-weight:800;line-height:1.05;letter-spacing:-.03em;font-variant-numeric:tabular-nums;' +
          'background:var(--grad);-webkit-background-clip:text;background-clip:text;color:var(--acc);-webkit-text-fill-color:transparent">' + esc(displayText(t)) + '</span>' +

        (task ? taskLine(task) : '') +
      '</button>';

    var card = body.firstElementChild;
    inEl = card ? card.querySelector('.nx-in') : null;
    lastIn = displayText(t);
    if (card) bindCard(card, t.day, color);
    icons();
  }

  /* Every tick: rerender only when the target (or its day tag, or the
     secondary task line) changes, otherwise just refresh the countdown text. */
  function tick(now) {
    if (!body) return;
    var t = null;
    try { t = TT.util.nextClass(now); } catch (e) { t = null; }
    /* no upcoming class today (a future-day class or none at all) → surface
       the next timed task still due today as a secondary line */
    var today = TT.util.todayKey();
    var task = (t && t.day === today) ? null : nextTaskToday(now, today);
    var key = t ? tagFor(t.day) + '|' + t.day + '|' + t.cls.course + '|' + t.cls.start : 'idle';
    key += '|' + (task ? task.id + '@' + task.start + '#' + task.title : '-');
    if (key !== lastKey) {
      lastKey = key;
      if (t) renderNext(t, task); else renderIdle(task);
    } else if (t && inEl) {
      var txt = displayText(t); // minute-granular string — write only on change
      if (txt !== lastIn) {
        lastIn = txt;
        inEl.textContent = txt;
      }
    }
  }

  function init() {
    body = document.getElementById('tt-next-body');
    if (!body || typeof TT.util.nextClass !== 'function') return;
    TT.whenReady(function () { tick(new Date()); });
    TT.on('tt:tick', function (d) { tick(d instanceof Date ? d : new Date()); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
