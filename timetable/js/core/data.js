/* data.js — timetable data + time utilities.
   Source priority: (1) the signed-in user's stored timetable via TT.profile
   (current() + timetableFor(id)), (2) the bundled data.json demo. Either way the
   bundle is normalized: every class gets precomputed _s/_e minute marks and each
   day's list is sorted by start time. Sets TT.data / TT.dataReady and emits
   'tt:data-ready' with the data — on failure too, with an error-shaped payload
   so the UI can render empty states.
   Owns TT.util; time.js extends it later with greet() / todayKey(). */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT) return;

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // timetable days, in week order
  var WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // index = Date#getDay()
  var LABELS = {
    sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday'
  };
  var FALLBACK_COLOR = '#c8ff00'; // --acc

  // ---- time helpers -------------------------------------------------------

  // 'HH:MM' -> minutes since midnight (numbers pass through).
  function mins(t) {
    if (typeof t === 'number') return t;
    var parts = String(t == null ? '' : t).split(':');
    var h = Number(parts[0]);
    if (!isFinite(h)) return NaN;
    var m = Number(parts[1]);
    return h * 60 + (isFinite(m) ? m : 0);
  }

  // minutes since midnight -> 'HH:MM'
  function fmt(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    var h = Math.floor(m / 60);
    var r = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (r < 10 ? '0' : '') + r;
  }

  // minutes -> '1h 40m' / '1h' / '45m'
  function hm(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (h && r) return h + 'h ' + r + 'm';
    if (h) return h + 'h';
    return r + 'm';
  }

  // Cross-realm-safe Date check: a Date from another realm (iframe, node vm)
  // fails `instanceof Date`; duck-typing getTime catches those too.
  function isDate(d) {
    return d instanceof Date || !!(d && typeof d.getTime === 'function');
  }

  // Date -> lowercase 3-letter day key ('mon'…'sun')
  function dayKey(date) {
    if (!isDate(date)) date = new Date();
    return WEEKDAY_KEYS[date.getDay()];
  }

  // 'mon' -> 'Monday'
  function dayLabel(k) {
    return LABELS[k] || '';
  }

  // ---- class helpers (read TT.data) ---------------------------------------

  // sorted classes for a day key; [] when the day/week is empty or missing
  function classesOn(day) {
    var week = TT.data && TT.data.week;
    var list = week && week[day];
    return Array.isArray(list) ? list.slice() : [];
  }

  // class duration in minutes (uses precomputed marks when present)
  function dur(cls) {
    if (!cls) return 0;
    var s = cls._s != null ? cls._s : mins(cls.start);
    var e = cls._e != null ? cls._e : mins(cls.end);
    return Math.max(0, e - s);
  }

  // class happening right now — today only, Mon–Sat (Sunday has no timetable)
  function ongoing(now) {
    if (!isDate(now)) now = new Date();
    var key = dayKey(now);
    if (key === 'sun') return null;
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var list = classesOn(key);
    for (var i = 0; i < list.length; i++) {
      if (list[i]._s <= nowMin && nowMin < list[i]._e) return list[i];
    }
    return null;
  }

  // next upcoming class: today first, then the following days, wrapping the
  // week (two-week scan so a fully-passed week still finds next week's first).
  // -> { day, cls, startsInMin } | null when the whole week has no classes
  function nextClass(now) {
    if (!isDate(now)) now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var todayIdx = now.getDay();
    for (var off = 0; off < 14; off++) {
      var key = WEEKDAY_KEYS[(todayIdx + off) % 7];
      if (key === 'sun') continue;
      var list = classesOn(key);
      for (var i = 0; i < list.length; i++) {
        var startsInMin = off * 1440 + list[i]._s - nowMin;
        if (startsInMin > 0) return { day: key, cls: list[i], startsInMin: startsInMin };
      }
    }
    return null;
  }

  // catalog entry for a class -> { name, color } (graceful fallback)
  function courseOf(cls) {
    var code = cls && cls.course;
    var cat = code && TT.data && TT.data.courses ? TT.data.courses[code] : null;
    if (cat) return { name: cat.name || code, color: cat.color || FALLBACK_COLOR };
    return { name: code || 'Class', color: FALLBACK_COLOR };
  }

  TT.util = TT.util || {};
  TT.util.mins = mins;
  TT.util.fmt = fmt;
  TT.util.hm = hm;
  TT.util.dayKey = dayKey;
  TT.util.dayLabel = dayLabel;
  TT.util.classesOn = classesOn;
  TT.util.dur = dur;
  TT.util.ongoing = ongoing;
  TT.util.nextClass = nextClass;
  TT.util.courseOf = courseOf;

  // run fn(data) now if ready, else exactly once when 'tt:data-ready' fires
  TT.whenReady = function (fn) {
    if (typeof fn !== 'function') return;
    if (TT.dataReady) { fn(TT.data); return; }
    var off = TT.on('tt:data-ready', function (data) {
      off();
      fn(data);
    });
  };

  // ---- load ---------------------------------------------------------------

  function normalize(raw) {
    var data = raw && typeof raw === 'object' ? raw : {};
    var src = data.week && typeof data.week === 'object' ? data.week : {};
    var week = {};
    for (var i = 0; i < DAYS.length; i++) {
      var list = Array.isArray(src[DAYS[i]]) ? src[DAYS[i]] : [];
      week[DAYS[i]] = list
        .filter(function (c) { return c && c.start && c.end; })
        .map(function (c) { c._s = mins(c.start); c._e = mins(c.end); return c; })
        .filter(function (c) { return isFinite(c._s) && isFinite(c._e); })
        .sort(function (a, b) { return a._s - b._s; });
    }
    data.week = week;
    data.courses = data.courses && typeof data.courses === 'object' ? data.courses : {};

    // Enrich course names/shorts from the scraped y26btech catalog (courses.json:
    // code -> [acronym, title]). Authoritative for both demo + ERP-fetched weeks;
    // codes missing from the catalog keep whatever the timetable source gave.
    var catalog = data._catalog && typeof data._catalog === 'object' ? data._catalog : {};
    var palette = ['#c8ff00', '#8b5cf6', '#2dd4ff', '#f5a623', '#fb7185', '#4ade80', '#22d3ee', '#fbbf24'];
    var seen = {};
    var codes = Object.keys(data.courses);
    DAYS.forEach(function (d) {
      week[d].forEach(function (c) {
        if (c.course && codes.indexOf(c.course) === -1) codes.push(c.course);
      });
    });
    codes.forEach(function (code) {
      var hit = catalog[code];
      var cur = data.courses[code] || {};
      if (hit) {
        data.courses[code] = {
          name: hit[1] || cur.name || code,
          short: hit[0] || cur.short || code,
          color: cur.color || palette[Object.keys(seen).length % palette.length]
        };
      } else if (!cur.name) {
        data.courses[code] = {
          name: code,
          short: cur.short || String(code).replace(/^\d{2}/, ''),
          color: cur.color || palette[Object.keys(seen).length % palette.length]
        };
      } else {
        data.courses[code] = cur;
      }
      seen[code] = true;
    });
    delete data._catalog;
    return data;
  }

  function ready(data) {
    TT.data = data;
    TT.dataReady = true;
    if (typeof TT.emit === 'function') TT.emit('tt:data-ready', data);
  }

  TT.dataReady = false;

  // Stored timetable for the signed-in user; null when demo/signed-out/broken.
  // core/profile.js loads before this file (script order) but is still defended
  // against — a missing profile simply falls through to the demo bundle.
  function storedTimetable() {
    try {
      var p = TT.profile;
      if (!p || typeof p.current !== 'function' || typeof p.timetableFor !== 'function') return null;
      var cur = p.current();
      if (!cur) return null;
      var id = typeof cur === 'string' ? cur : cur.id; // contract: id; tolerate {id}
      if (!id) return null;
      var tt = p.timetableFor(id);
      return tt && typeof tt === 'object' ? tt : null;
    } catch (e) {
      return null;
    }
  }

  function load() {
    var stored = storedTimetable();
    var tt = stored
      ? Promise.resolve(stored)
      : fetch('data.json').then(function (res) {
          if (!res.ok) throw new Error('data.json: HTTP ' + res.status);
          return res.json();
        });
    var cat = fetch('courses.json').then(function (res) {
      return res.ok ? res.json() : {};
    }).catch(function () { return {}; }); // catalog is best-effort
    return Promise.all([tt, cat]).then(function (parts) {
      var raw = parts[0];
      if (raw && typeof raw === 'object') raw._catalog = parts[1];
      return raw;
    });
  }

  load()
    .then(function (raw) { ready(normalize(raw)); })
    .catch(function (err) {
      if (window.console && typeof console.error === 'function') console.error('[tt:data]', err);
      ready({ week: {}, courses: {}, error: true });
    });
})();
