/* ui/planner.js — study-gap planner card: free-gap chips for the selected day + planned blocks */
(function () {
  'use strict';

  var TT = window.TT;
  if (!TT || !TT.util) return;

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var body = document.getElementById('tt-planner-body');
  var autoBtn = document.getElementById('tt-autoplan');
  var day = validDay(TT.util.todayKey ? TT.util.todayKey() : 'mon');
  var lastGaps = [];   /* gaps as rendered — recovered by index on chip click */
  var lastBlocks = []; /* planned blocks as rendered — preserves original id type */
  var lastBookings = []; /* per-gap timed task (index-aligned with lastGaps), null when free */
  var lastTimed = [];  /* timed tasks on `day` as {t,s,e} minute ranges — cached per render */

  function validDay(d) { return DAYS.indexOf(d) !== -1 ? d : 'mon'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icons() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  /* class nearest to the gap (prefer the one that just ended) → label/color source */
  function nearestClass(dayKey, gap) {
    var classes = TT.util.classesOn(dayKey) || [];
    var gs = TT.util.mins(gap.start), ge = TT.util.mins(gap.end);
    var best = null, bestD = Infinity;
    classes.forEach(function (c) {
      var cs = TT.util.mins(c.start), ce = TT.util.mins(c.end);
      var d = ce <= gs ? gs - ce : (cs >= ge ? cs - ge : 0);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  }

  /* core suggestion policy (core/planner.js) leaves 10 min slack inside a gap;
     mirror it for gaps that have no core suggestion */
  function blockMins(gap) { return Math.min(45, Math.max(0, (gap.mins || 0) - 10)); }

  function buildSug(dayKey, gap) {
    var cls = nearestClass(dayKey, gap);
    var course = cls && TT.util.courseOf ? TT.util.courseOf(cls) : null;
    var label = course ? 'study · ' + String(course.name || cls.course).toLowerCase() : 'study block';
    return {
      day: dayKey, start: gap.start, end: gap.end, mins: blockMins(gap),
      title: label, label: label,
      code: cls ? cls.course : null, color: course ? course.color : null
    };
  }

  /* prefer a real suggestion from core/planner when one matches this gap */
  function suggestionFor(dayKey, gap) {
    if (!TT.plan || typeof TT.plan.suggestions !== 'function') return null;
    var list;
    try { list = TT.plan.suggestions() || []; } catch (e) { return null; }
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s && s.day === dayKey && s.start === gap.start) return s;
    }
    return null;
  }

  /* Timed tasks pinned to a day, as {t,s,e} minute ranges. Start-only tasks
     count as a point booking (e = s); a missing/invalid end never widens one.
     Done tasks are skipped — completing a task frees its gap. */
  function timedOn(dayKey) {
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return [];
    var list;
    try { list = TT.tasks.list() || []; } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t || t.done || t.day !== dayKey || !t.start) continue;
      var s = TT.util.mins(t.start);
      if (!isFinite(s)) continue;
      var e = t.end ? TT.util.mins(t.end) : s;
      if (!isFinite(e) || e < s) e = s;
      out.push({ t: t, s: s, e: e });
    }
    return out;
  }

  /* earliest timed task overlapping the gap → the booking (any intersection
     counts: partial edge overlaps and full coverage included); gapsFor()
     stays class-only, this overlay is purely a UI-layer concern */
  function bookingFor(gap) {
    var gs = TT.util.mins(gap.start), ge = TT.util.mins(gap.end);
    var best = null;
    for (var i = 0; i < lastTimed.length; i++) {
      var r = lastTimed[i];
      if (r.s < ge && gs < r.e && (!best || r.s < best.s)) best = r;
    }
    return best ? best.t : null;
  }

  function chipHtml(gap, i) {
    var cls = nearestClass(day, gap);
    var course = cls && TT.util.courseOf ? TT.util.courseOf(cls) : null;
    var dot = course ? '<span class="cdot" style="background:' + esc(course.color) + '"></span>' : '';
    var booking = lastBookings[i];
    if (booking) { /* occupied: no '+Nm' suffix, click only explains (see handler) */
      return '<button class="gap-chip is-booked" type="button" data-gap="' + i + '" aria-label="already booked: ' + esc(booking.title) + '">'
        + dot
        + esc(gap.start) + ' → ' + esc(gap.end) + ' · ' + esc(TT.util.hm(gap.mins))
        + '</button>';
    }
    var sug = suggestionFor(day, gap);
    var m = sug && sug.mins ? sug.mins : blockMins(gap);
    return '<button class="gap-chip" type="button" data-gap="' + i + '" aria-label="add study block">'
      + dot
      + esc(gap.start) + ' → ' + esc(gap.end) + ' · ' + esc(TT.util.hm(gap.mins))
      + ' <b>+' + esc(TT.util.hm(m)) + '</b></button>';
  }

  function blockHtml(t) {
    var when = t.start
      ? esc(t.start) + (t.end ? ' → ' + esc(t.end) : '')
      : esc(TT.util.hm(t.mins || 0));
    return '<div class="plan-block' + (t.done ? ' is-done' : '') + '" data-id="' + esc(t.id) + '">'
      + '<button class="plan-check" type="button" data-act="toggle" aria-label="toggle done"><i data-lucide="check"></i></button>'
      + '<span class="plan-time">' + when + '</span>'
      + (t.color ? '<span class="cdot" style="background:' + esc(t.color) + '"></span>' : '')
      + '<span class="plan-title">' + esc(t.title) + '</span>'
      + '<button class="plan-x" type="button" data-act="remove" aria-label="remove block"><i data-lucide="x"></i></button>'
      + '</div>';
  }

  function render() {
    if (!body || !TT.dataReady) return;

    lastGaps = (TT.plan && TT.plan.gapsFor) ? (TT.plan.gapsFor(day) || []) : [];
    lastTimed = timedOn(day);
    lastBookings = lastGaps.map(bookingFor);
    var total = lastGaps.reduce(function (n, g) { return n + (g.mins || 0); }, 0);

    var html = '<div class="plan-eyebrow">'
      + esc(day.toUpperCase()) + ' · '
      + lastGaps.length + ' gap' + (lastGaps.length === 1 ? '' : 's') + ' · '
      + esc(TT.util.hm(total)) + ' free</div>';

    if (!lastGaps.length) {
      var hasClasses = (TT.util.classesOn(day) || []).length > 0;
      html += '<div class="bento-empty">' +
        (hasClasses ? 'no free gaps — packed day.' : 'no classes synced for this day yet.') +
        '</div>';
    } else {
      html += '<div class="gap-row">' + lastGaps.map(chipHtml).join('') + '</div>';
    }

    lastBlocks = ((TT.plan && TT.plan.planned) ? (TT.plan.planned() || []) : [])
      .filter(function (t) { return t && t.day === day; })
      .sort(function (a, b) {
        var am = a.start ? TT.util.mins(a.start) : 1e9;
        var bm = b.start ? TT.util.mins(b.start) : 1e9;
        return (am - bm) || ((a.createdAt || 0) - (b.createdAt || 0));
      });

    if (lastBlocks.length) {
      html += '<div class="plan-list">' + lastBlocks.map(blockHtml).join('') + '</div>';
    } else if (lastGaps.length) {
      html += '<div class="bento-empty plan-hint">nothing planned — tap a gap or hit auto-plan.</div>';
    }

    body.innerHTML = html;
    icons();
  }

  /* one delegated click handler: gap chips + block toggle/remove */
  if (body) {
    body.addEventListener('click', function (e) {
      var el = e.target;
      if (!el || typeof el.closest !== 'function') return;

      var chip = el.closest('.gap-chip');
      if (chip) {
        var idx = +chip.getAttribute('data-gap');
        var gap = lastGaps[idx];
        if (!gap) return;
        var booking = lastBookings[idx];
        if (booking) { /* occupied gap — explain, never accept() */
          TT.emit('tt:toast', { msg: 'already booked: ' + booking.title });
          return;
        }
        if (!TT.plan || !TT.plan.accept) return;
        var added = null;
        try {
          added = TT.plan.accept(suggestionFor(day, gap) || buildSug(day, gap));
        } catch (err) {
          added = null;
        }
        if (!added) { // core rejects slots already covered by a planned block
          TT.emit('tt:toast', { msg: 'already planned' });
          return;
        }
        TT.emit('tt:toast', { msg: 'study block added' });
        render();
        return;
      }

      var act = el.closest('[data-act]');
      if (act) {
        var row = act.closest('.plan-block');
        var id = row ? row.getAttribute('data-id') : null;
        var task = null;
        for (var i = 0; i < lastBlocks.length; i++) {
          if (String(lastBlocks[i].id) === id) { task = lastBlocks[i]; break; }
        }
        if (!task) return;
        if (act.getAttribute('data-act') === 'toggle') TT.tasks.toggle(task.id);
        else TT.tasks.remove(task.id);
      }
    });
  }

  /* head button: fill the whole week's decent gaps */
  if (autoBtn) {
    autoBtn.addEventListener('click', function () {
      if (!TT.plan || typeof TT.plan.autoPlanWeek !== 'function') return;
      var n = 0;
      try { n = TT.plan.autoPlanWeek() || 0; } catch (e) { n = 0; }
      if (n > 0) {
        TT.emit('tt:toast', { msg: 'planned ' + n + ' study block' + (n === 1 ? '' : 's') });
        TT.emit('tt:celebrate', {});
      } else {
        TT.emit('tt:toast', { msg: 'no decent gaps found' });
      }
      render();
    });
  }

  TT.on('tt:day-select', function (d) { day = validDay(d && d.day); render(); });
  TT.on('tt:plan-changed', render);
  TT.on('tt:tasks-changed', render);
  TT.whenReady(render);
})();
