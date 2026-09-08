/* planner.js — TT.plan: study-gap planner. Finds free windows inside the daily
 * 07:30–18:00 study window, suggests prep sessions next to real classes, and
 * turns accepted suggestions into dated study tasks (cat 'study' + day set).
 * Needs TT.data (week) and TT.tasks (adds) → attaches on TT.whenReady. */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT || typeof TT.whenReady !== 'function') return;

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var WIN_START = '07:30';
  var WIN_END = '18:00';
  var MIN_GAP = 25;     // ignore slivers you can't study in
  var MAX_SESSION = 45; // cap one planned block…
  var SESSION_PAD = 10; // …leaving this much slack inside the gap
  var PER_DAY = 2;
  var PER_WEEK = 6;

  // Day classes sorted by start (defensive copy — never sort a cached array).
  function classes(dayKey) {
    var list = (TT.util && typeof TT.util.classesOn === 'function')
      ? TT.util.classesOn(dayKey)
      : null;
    return (list || []).slice().sort(function (a, b) {
      return TT.util.mins(a.start) - TT.util.mins(b.start);
    });
  }

  function weekHasClasses() {
    for (var i = 0; i < DAYS.length; i++) {
      if (classes(DAYS[i]).length) return true;
    }
    return false;
  }

  function pushGap(out, s, e) {
    if (e - s < MIN_GAP) return;
    out.push({ start: TT.util.fmt(s), end: TT.util.fmt(e), mins: e - s });
  }

  // Free windows inside the study window, classes subtracted; chronological.
  // A day with zero classes is unsynced, not free — return [] so planner and
  // stats never fabricate "free hours" out of a missing day (ux review #7).
  function gapsFor(dayKey) {
    var list = classes(dayKey);
    if (!list.length) return []; // no data for this day → no gaps at all
    var end = TT.util.mins(WIN_END);
    var cursor = TT.util.mins(WIN_START);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = TT.util.mins(list[i].start);
      var e = TT.util.mins(list[i].end);
      if (s > cursor) pushGap(out, cursor, Math.min(s, end));
      if (e > cursor) cursor = e;
      if (cursor >= end) break;
    }
    if (cursor < end) pushGap(out, cursor, end);
    return out;
  }

  // Code of the last class ending at/before the gap start, else null.
  function courseBefore(dayClasses, gapStart) {
    var best = null;
    var bestEnd = -1;
    for (var i = 0; i < dayClasses.length; i++) {
      var e = TT.util.mins(dayClasses[i].end);
      if (e <= gapStart && e > bestEnd) {
        best = dayClasses[i];
        bestEnd = e;
      }
    }
    return best && best.course ? String(best.course) : null;
  }

  // Up to PER_DAY largest gaps of one day as drafts (gap kept for ranking).
  function dayDrafts(dayKey) {
    var dayClasses = classes(dayKey);
    var gaps = gapsFor(dayKey).sort(function (a, b) {
      return b.mins - a.mins || TT.util.mins(a.start) - TT.util.mins(b.start);
    });
    var drafts = [];
    for (var i = 0; i < gaps.length && i < PER_DAY; i++) {
      var g = gaps[i];
      var code = courseBefore(dayClasses, TT.util.mins(g.start));
      drafts.push({
        day: dayKey,
        start: g.start,
        mins: Math.min(MAX_SESSION, g.mins - SESSION_PAD),
        label: code ? code + ' prep' : 'revision',
        gap: g.mins
      });
    }
    return drafts;
  }

  function strip(d) {
    return { day: d.day, start: d.start, mins: d.mins, label: d.label };
  }

  // All suggestions, mon→sat, per day largest first. Unsynced (zero-class)
  // days contribute nothing (no gaps); an all-empty week → [].
  function suggestions() {
    if (!weekHasClasses()) return [];
    var out = [];
    for (var i = 0; i < DAYS.length; i++) {
      var drafts = dayDrafts(DAYS[i]);
      for (var j = 0; j < drafts.length; j++) out.push(strip(drafts[j]));
    }
    return out;
  }

  // Start minutes of a planned task: the stored field, else the ' · HH:MM'
  // suffix accept() embeds in the title (covers pre-schema legacy tasks).
  function startMinOf(t) {
    if (t.start) return TT.util.mins(t.start);
    var m = /· (\d{2}:\d{2})$/.exec(String(t.title || ''));
    return m ? TT.util.mins(m[1]) : null;
  }

  // True when a planned task already covers the suggestion's slot (same day,
  // overlapping time) — keeps accept() and autoPlanWeek() idempotent.
  function isDupe(sug) {
    var s = TT.util.mins(sug.start);
    var e = s + (sug.mins || 0);
    var list = planned();
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.day !== sug.day) continue;
      var ts = startMinOf(t);
      if (ts == null) continue; // no slot info → can't prove a collision
      var te = ts + (t.mins || sug.mins || 0);
      if (s < te && ts < e) return true;
    }
    return false;
  }

  // Turn one suggestion into a dated study task; announces the change.
  // opts.quiet skips the emit (autoPlanWeek announces once for the batch).
  // Returns null when an overlapping block already exists for that day.
  function accept(sug, opts) {
    if (!sug || !sug.day || !sug.start || !TT.tasks) return null;
    if (isDupe(sug)) return null;
    var task = TT.tasks.add({
      title: sug.label + ' · ' + sug.start,
      cat: 'study',
      day: sug.day,
      mins: sug.mins,
      start: sug.start
    });
    if (task && !(opts && opts.quiet)) TT.emit('tt:plan-changed');
    return task;
  }

  // Accept the PER_WEEK biggest-gap drafts (max PER_DAY per day). Returns count.
  // Idempotent: slots already covered by planned blocks are skipped, and
  // 'tt:plan-changed' is emitted once at the end, not per accepted draft.
  function autoPlanWeek() {
    if (!weekHasClasses()) return 0; // all-empty week: nothing to prep against
    var drafts = [];
    for (var i = 0; i < DAYS.length; i++) drafts = drafts.concat(dayDrafts(DAYS[i]));
    drafts.sort(function (a, b) {
      return b.gap - a.gap ||
        DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
        TT.util.mins(a.start) - TT.util.mins(b.start);
    });
    var perDay = {};
    var count = 0;
    for (var j = 0; j < drafts.length && count < PER_WEEK; j++) {
      var d = drafts[j];
      if ((perDay[d.day] || 0) >= PER_DAY) continue;
      if (!accept(strip(d), { quiet: true })) continue; // dupe slot → skipped, not counted
      perDay[d.day] = (perDay[d.day] || 0) + 1;
      count++;
    }
    if (count) TT.emit('tt:plan-changed');
    return count;
  }

  // Study tasks pinned to a day — the visible result of planning.
  // Optional day key ('mon'…'sat') filters; no argument returns all blocks.
  function planned(day) {
    if (!TT.tasks) return [];
    return TT.tasks.list().filter(function (t) {
      return t && t.cat === 'study' && !!t.day && (!day || t.day === day);
    });
  }

  TT.whenReady(function () {
    TT.plan = {
      gapsFor: gapsFor,
      suggestions: suggestions,
      accept: accept,
      autoPlanWeek: autoPlanWeek,
      planned: planned
    };
  });
})();
