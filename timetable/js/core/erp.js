/* erp.js — TT.erp: KL ERP timetable fetch + normalization.
 * Owns the slot clock (SLOT_TIMES 1..11, 07:10–17:30), the day BREAKS and the
 * course PALETTE. fetchTimetable() posts credentials form-urlencoded to the
 * buddy API (https://kl-erp-buddy-api.onrender.com/fetch-timetable) and reshapes
 * the raw ERP grid — { Mon: { '7': '26UC1137-P - S-35 -RoomNo-S708' } } — into
 * the same bundle shape data.json uses, so stored and demo data stay
 * indistinguishable downstream. Consecutive identical cell texts merge into one
 * entry; slot keys > 11 and empty/'-' cells are ignored.
 */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT) return;

  var API = 'https://kl-erp-buddy-api.onrender.com/fetch-timetable';
  var TIMEOUT = 60000; // render free-tier cold start + ERP login + captcha solve
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var EN_DASH = '–'; // slots label: '7–8'

  // Official KL slot times (50 min each). ERP slot keys go higher but only
  // 1..11 are real — anything above 11 is ignored everywhere.
  var SLOT_TIMES = {
    1: ['07:10', '08:00'],
    2: ['08:00', '08:50'],
    3: ['09:20', '10:10'],
    4: ['10:10', '11:00'],
    5: ['11:10', '12:00'],
    6: ['12:00', '12:50'],
    7: ['13:00', '13:50'],
    8: ['13:50', '14:40'],
    9: ['14:50', '15:40'],
    10: ['15:40', '16:30'],
    11: ['16:40', '17:30']
  };

  var BREAKS = [
    { start: '08:50', end: '09:20', label: 'break' },
    { start: '11:00', end: '11:10', label: 'break' },
    { start: '12:50', end: '13:00', label: 'lunch' },
    { start: '14:40', end: '14:50', label: 'break' }
  ];

  // per-course accent, assigned in first-seen order across the week
  var PALETTE = ['#c8ff00', '#8b5cf6', '#2dd4ff', '#f5a623', '#fb7185', '#4ade80', '#22d3ee', '#fbbf24'];

  // '26UC1137-P    - S-35    -RoomNo-S708' -> { course, type, section, room }.
  // Tolerates extra spaces around the dashes; '-'/empty/garbage -> null.
  var CELL_RE = /^(\S+?)\s*-\s*(L|T|P|S)\s*-\s*(\S+)\s*-\s*RoomNo-(\S+)/;

  function parseCell(text) {
    if (text == null) return null;
    var t = String(text).trim();
    if (!t || t === '-') return null;
    var m = CELL_RE.exec(t);
    if (!m) return null;
    return { course: m[1], type: m[2], section: m[3], room: m[4] };
  }

  // ---- transform ------------------------------------------------------------

  function dayKeyOf(k) {
    return String(k == null ? '' : k).trim().slice(0, 3).toLowerCase();
  }

  function semesterName(semId) {
    return semId === '1' ? 'Odd' : semId === '2' ? 'Even' : 'Summer';
  }

  // raw ERP grid -> data.json-shaped bundle. Days scan slots 1..11 in order, so
  // each day's list comes out sorted by start; zero-class days are [].
  function transform(timetable, username, semId) {
    var rows = {}; // 'mon'..'sat' -> raw slot map
    if (timetable && typeof timetable === 'object') {
      Object.keys(timetable).forEach(function (k) {
        var dk = dayKeyOf(k);
        if (DAYS.indexOf(dk) === -1 || rows[dk]) return;
        var row = timetable[k];
        if (row && typeof row === 'object' && !Array.isArray(row)) rows[dk] = row;
      });
    }

    var courses = {};
    var seen = 0;
    var week = {};

    DAYS.forEach(function (dk) {
      var day = [];
      week[dk] = day;
      var row = rows[dk];
      if (!row) return;

      // slot number (1..11) -> trimmed cell text; other keys/values ignored
      var cells = {};
      Object.keys(row).forEach(function (k) {
        var n = parseInt(k, 10);
        if (!(n >= 1 && n <= 11)) return;
        var v = row[k];
        if (v == null) return;
        var t = String(v).trim();
        if (t && t !== '-') cells[n] = t;
      });

      var n = 1;
      while (n <= 11) {
        var t = cells[n];
        if (!t) { n++; continue; }
        var first = n;
        var last = n;
        while (last < 11 && cells[last + 1] === t) last++; // merge identical neighbours
        var p = parseCell(t);
        if (p) { // unparseable cells are dropped, but their run is still consumed
          if (!courses[p.course]) {
            courses[p.course] = {
              name: p.course,
              short: p.course.replace(/^26/, ''),
              color: PALETTE[seen % PALETTE.length]
            };
            seen++;
          }
          day.push({
            start: SLOT_TIMES[first][0],
            end: SLOT_TIMES[last][1],
            slots: first === last ? String(first) : first + EN_DASH + last,
            course: p.course,
            type: p.type,
            section: p.section,
            room: p.room
          });
        }
        n = last + 1;
      }
    });

    return {
      student: { id: username, semester: semesterName(semId), year: '2026-27' }, // year label pinned to academic-year code '29'
      slots: SLOT_TIMES,   // shared by reference — read-only everywhere
      breaks: BREAKS,      // shared by reference — read-only everywhere
      courses: courses,
      week: week
    };
  }

  // ---- http -----------------------------------------------------------------

  function friendlyHttpError(status, detail) {
    var msg;
    if (status === 401 || status === 403) msg = 'wrong id or password?';
    else if (status >= 500) msg = 'erp unreachable — try later';
    else if (typeof detail === 'string' && detail && detail.length <= 140) msg = detail;
    else msg = 'timetable fetch failed (http ' + status + ') — try again?';
    var err = new Error(msg);
    err.status = status;
    return err;
  }

  function unreachableError() {
    var err = new Error('erp unreachable — try later');
    err.status = 0; // network failure / timeout, not an http response
    return err;
  }

  function isNetworkError(err) {
    return err instanceof TypeError || (err && err.name === 'AbortError');
  }

  // username + password (+ optional academic-year code / semester id) -> promise
  // of a data.json-shaped bundle. Rejects only with friendly-message Errors
  // carrying .status (0 = network/timeout).
  function fetchTimetable(username, password, academicYearCode, semesterId, session) {
    var user = String(username == null ? '' : username).trim();
    var pass = String(password == null ? '' : password);
    var yearCode = academicYearCode == null ? '29' : String(academicYearCode);
    var semId = semesterId == null ? '1' : String(semesterId);
    if (!user || !pass) return Promise.reject(new Error('missing erp id or password'));

    var body = new URLSearchParams();
    body.set('username', user);
    body.set('password', pass);
    body.set('academic_year_code', yearCode);
    body.set('semester_id', semId);
    // Optional session passthrough (from a just-completed /login): lets the
    // backend reuse the ERP session instead of forcing a second fresh login.
    if (session && typeof session === 'object') {
      if (session.php_sess_id) body.set('php_sess_id', String(session.php_sess_id));
      if (session.csrf_cookie) body.set('csrf_cookie', String(session.csrf_cookie));
      if (session.device_id) body.set('device_id', String(session.device_id));
      if (session.server_id) body.set('server_id', String(session.server_id));
    }

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var killer = ctrl
      ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* noop */ } }, TIMEOUT)
      : null;

    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(API, opts)
      .then(function (res) {
        return res.json()
          .catch(function () { return null; }) // non-json error pages still map by status
          .then(function (data) {
            if (!res.ok) throw friendlyHttpError(res.status, data && data.detail);
            if (!data || data.success === false || !data.timetable || typeof data.timetable !== 'object') {
              var d = data && typeof data.detail === 'string' ? data.detail : '';
              var err = new Error(d && d.length <= 140 ? d : 'no timetable came back — try again?');
              err.status = res.status;
              throw err;
            }
            return transform(data.timetable, user, semId);
          });
      })
      .then(
        function (bundle) { if (killer) clearTimeout(killer); return bundle; },
        function (err) {
          if (killer) clearTimeout(killer);
          throw isNetworkError(err) ? unreachableError() : err;
        }
      );
  }

  TT.erp = {
    SLOT_TIMES: SLOT_TIMES,
    BREAKS: BREAKS,
    PALETTE: PALETTE,
    parseCell: parseCell,
    fetchTimetable: fetchTimetable
  };
})();
