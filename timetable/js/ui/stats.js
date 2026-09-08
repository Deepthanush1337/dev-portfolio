/* stats.js — owns #tt-stats-body.
   Tiles: classes/wk, class hours, free hours (TT.plan gaps), tasks done %,
   focus today + focus week (prefs 'focuslog'), day streak.
   Two sparklines: class minutes Mon–Sun (.spark, lime) and focus minutes
   for the last 7 days ending today (.spark.spark-focus, violet).
   Recomputes on whenReady + 'tt:tasks-changed' + 'tt:focus-done' + 'tt:focus-log'
   (+ midnight rollover via 'tt:tick'). */
(function () {
  'use strict';

  var body = document.getElementById('tt-stats-body');
  if (!body || !window.TT) return;

  var TT = window.TT;
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var rafs = []; // live count-up rAF ids, cancelled on every re-render

  /* ---------- helpers ---------- */

  function stamp(d) { // local YYYY-MM-DD — must match the key focus.js writes to 'focuslog'
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function classesOn(day) {
    return (TT.util.classesOn(day) || []);
  }

  function freeMinsWeek() { // sum of study-gap minutes, mon–sat
    var sum = 0;
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach(function (d) {
      var gaps = (TT.plan && TT.plan.gapsFor(d)) || [];
      gaps.forEach(function (g) { sum += (g && g.mins) || 0; });
    });
    return sum;
  }

  function focusLogMap() { // normalize prefs 'focuslog' → {'YYYY-MM-DD': mins}
    var log = TT.prefs.get('focuslog', {});
    var map = {};
    function add(key, mins) {
      if (!key) return;
      map[key] = (map[key] || 0) + (Number(mins) || 0);
    }
    if (Array.isArray(log)) { // legacy: [{at|ts|date|day, mins}]
      log.forEach(function (e) {
        if (!e) return;
        var when = e.at || e.ts || e.date || e.day;
        var key = (typeof when === 'number') ? stamp(new Date(when)) : String(when || '').slice(0, 10);
        add(key, e.mins);
      });
    } else if (log && typeof log === 'object') { // current: {'YYYY-MM-DD': mins} (legacy: mins|[{mins}])
      Object.keys(log).forEach(function (k) {
        var key = k.slice(0, 10);
        var v = log[k];
        if (typeof v === 'number') add(key, v);
        else if (Array.isArray(v)) v.forEach(function (e) {
          add(key, e && e.mins != null ? e.mins : e);
        });
      });
    }
    return map;
  }

  function focusDays(map) { // last 7 days ending today, oldest first
    var out = [];
    var d = new Date();
    d.setDate(d.getDate() - 6);
    for (var i = 0; i < 7; i++) {
      var key = stamp(d);
      out.push({ key: key, day: TT.util.dayKey(d), mins: Math.round(map[key] || 0) });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function dayStreak(tasks) { // consecutive days ending today with ≥1 task doneAt
    var doneDays = {};
    tasks.forEach(function (t) {
      if (!t || !t.done || !t.doneAt) return;
      var d = new Date(t.doneAt);
      if (!isNaN(d)) doneDays[stamp(d)] = true;
    });
    var n = 0;
    var d = new Date();
    while (doneDays[stamp(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /* ---------- compute ---------- */

  function compute() {
    var perDay = [];
    var classCount = 0;
    var classMins = 0;
    DAYS.forEach(function (d) {
      var list = classesOn(d);
      var mins = 0;
      list.forEach(function (c) { mins += TT.util.dur(c) || 0; });
      perDay.push(mins);
      classCount += list.length;
      classMins += mins;
    });

    var counts = (TT.tasks && TT.tasks.counts()) || { total: 0, done: 0 };
    var tasks = (TT.tasks && TT.tasks.list()) || [];

    var fdays = focusDays(focusLogMap());
    var focusWeek = 0;
    fdays.forEach(function (f) { focusWeek += f.mins; });

    return {
      perDay: perDay,
      classes: classCount,
      classH: classMins / 60,
      freeH: freeMinsWeek() / 60,
      pct: counts.total ? Math.round((counts.done / counts.total) * 100) : 0,
      focus: fdays[6].mins, // last entry is always today
      focusWeek: focusWeek,
      focusDays: fdays,
      streak: dayStreak(tasks)
    };
  }

  /* ---------- count-up animation ---------- */

  function countUp(node, target, decimals) {
    if (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.nodeValue = decimals ? target.toFixed(decimals) : String(Math.round(target));
      return; // reduced motion: set the final value instantly
    }
    var t0 = performance.now();
    var DUR = 700;
    function frame(t) {
      var p = Math.min(1, (t - t0) / DUR);
      var e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var v = target * e;
      node.nodeValue = decimals ? v.toFixed(decimals) : String(Math.round(v));
      if (p < 1) rafs.push(requestAnimationFrame(frame));
    }
    rafs.push(requestAnimationFrame(frame));
  }

  /* ---------- sparkline builder ---------- */

  // o: {cap, variant, aria, days:[{day, mins, today, title}]}
  function sparkBlock(o) {
    var max = 0;
    o.days.forEach(function (d) { if (d.mins > max) max = d.mins; });
    var bars = o.days.map(function (d) {
      var h = max > 0 ? Math.round((d.mins / max) * 100) : 0;
      var val = TT.util.hm(d.mins).replace(/\s+/g, ''); // '2h 20m' → '2h20m'
      return '<div class="spark-bar' + (d.today ? ' today' : '') + (h === 0 ? ' is-zero' : '') + '"' +
        ' style="height:' + h + '%"' +
        ' data-v="' + val + '"' +
        (d.today ? ' data-today="1"' : '') +
        ' title="' + d.title + ' · ' + val + '"></div>';
    }).join('');

    var labels = o.days.map(function (d) {
      return '<span>' + TT.util.dayLabel(d.day).charAt(0) + '</span>';
    }).join('');

    return '<div class="spark-cap">' + o.cap + '</div>' +
      // per-day values ride the role="img" label — the bars themselves aren't focusable
      '<div class="spark' + (o.variant ? ' ' + o.variant : '') + '" role="img" aria-label="' + o.aria + '">' +
      bars + '</div>' +
      '<div class="spark-labels">' + labels + '</div>';
  }

  /* ---------- render ---------- */

  function render() {
    rafs.forEach(cancelAnimationFrame);
    rafs = [];

    var s = compute();
    var tiles = [
      { v: s.classes,   dec: 0, suf: '',  label: 'classes/wk' },
      { v: s.classH,    dec: 1, suf: 'h', label: 'class hours' },
      { v: s.freeH,     dec: 1, suf: 'h', label: 'free hours' },
      { v: s.pct,       dec: 0, suf: '%', label: 'tasks done' },
      { v: s.focus,     dec: 0, suf: 'm', label: 'focus today' },
      { v: s.focusWeek, dec: 0, suf: 'm', label: 'focus week' },
      { v: s.streak,    dec: 0, suf: '',  label: 'day streak' }
    ];

    var grid = '<div class="stat-grid">' + tiles.map(function (t, i) {
      return '<div class="stat">' +
        '<div class="stat-num" data-i="' + i + '">0' +
          (t.suf ? '<span class="stat-suffix">' + t.suf + '</span>' : '') +
        '</div>' +
        '<div class="stat-label">' + t.label + '</div>' +
      '</div>';
    }).join('') + '</div>';

    var today = TT.util.todayKey();
    var classDays = DAYS.map(function (d, i) {
      return { day: d, mins: s.perDay[i], today: d === today, title: TT.util.dayLabel(d) };
    });
    var classAria = 'Class minutes per day, Monday to Sunday: ' + classDays.map(function (d) {
      return d.title + ' ' + TT.util.hm(d.mins);
    }).join(', ');

    var focusDaysList = s.focusDays.map(function (f, i) {
      return {
        day: f.day,
        mins: f.mins,
        today: i === s.focusDays.length - 1,
        title: TT.util.dayLabel(f.day) + ', ' + f.key // rolling window — the date disambiguates repeats
      };
    });
    var focusAria = 'Focus minutes per day, last 7 days: ' + s.focusDays.map(function (f) {
      return TT.util.dayLabel(f.day) + ' ' + TT.util.hm(f.mins);
    }).join(', ');

    body.innerHTML = grid +
      sparkBlock({ cap: 'classes', variant: '', aria: classAria, days: classDays }) +
      sparkBlock({ cap: 'focus', variant: 'spark-focus', aria: focusAria, days: focusDaysList });

    var nums = body.querySelectorAll('.stat-num');
    tiles.forEach(function (t, i) {
      var el = nums[i];
      if (el && el.firstChild) countUp(el.firstChild, t.v, t.dec);
    });
  }

  /* ---------- wiring ---------- */

  TT.whenReady(render);
  TT.on('tt:tasks-changed', render);
  TT.on('tt:focus-done', render);
  TT.on('tt:focus-log', render); // early stops bank minutes without a focus-done

  var lastDay = TT.util.todayKey();
  TT.on('tt:tick', function () { // midnight rollover keeps "today" stats honest
    var k = TT.util.todayKey();
    if (k !== lastDay) {
      lastDay = k;
      render();
    }
  });
})();
