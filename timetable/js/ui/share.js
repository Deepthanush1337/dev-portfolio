/* ui/share.js — owns #tt-share-btn + #tt-popover.
   Popover anchored under the button (fixed, getBoundingClientRect), closes on
   outside click / Escape / scroll. Rows: share link (navigator.share → clipboard
   fallback), copy today (plain-text agenda of selected/current day: classes,
   then '— tasks —' with that day's timed tasks and '— goals —' with today's
   day-scope goals, '[x]'/'[ ]' ASCII checkboxes), download
   .ics (weekly VEVENTs anchored to the Monday of the current week), plus data
   portability rows (backup .json / tasks .csv / import backup) delegated to
   TT.export — resolved lazily at click time since export.js loads after us. */
(function () {
  'use strict';

  var SHARE_URL = 'https://deepthanush.io/timetable';
  var ICS_FILE = 'deepthanush-timetable.ics';
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var BYDAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA' };
  var ROWS = [
    { act: 'link', icon: 'link', label: 'share link' },
    { act: 'copy', icon: 'clipboard', label: 'copy today' },
    { act: 'ics', icon: 'calendar-plus', label: 'download .ics' },
    { act: 'json', icon: 'download', label: 'backup .json' },
    { act: 'csv', icon: 'file-json', label: 'tasks .csv' },
    { act: 'import', icon: 'upload', label: 'import backup' }
  ];

  var btn = document.getElementById('tt-share-btn');
  var pop = document.getElementById('tt-popover');
  if (!btn || !pop || !window.TT) return;

  var built = false;
  var isOpen = false;
  var selectedDay = null;

  /* ---------- small helpers ---------- */

  function toast(msg, type) { window.TT.emit('tt:toast', type ? { msg: msg, type: type } : { msg: msg }); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* ---------- popover ---------- */

  function build() {
    if (built) return;
    built = true;
    pop.setAttribute('role', 'menu');
    pop.setAttribute('aria-label', 'share timetable');
    var html = '';
    ROWS.forEach(function (r) {
      html += '<button type="button" class="pop-row" role="menuitem" data-action="' + r.act + '">' +
        '<i data-lucide="' + r.icon + '"></i><span>' + r.label + '</span></button>';
    });
    pop.innerHTML = html;
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    pop.addEventListener('click', onPopClick);
  }

  function menuRows() {
    return Array.prototype.slice.call(pop.querySelectorAll('.pop-row'));
  }

  function position() {
    if (!isOpen) return;
    var r = btn.getBoundingClientRect();
    var pw = pop.offsetWidth || 220;
    var left = r.right - pw;                       /* right-align under the button */
    var max = window.innerWidth - pw - 12;
    if (left < 12) left = 12;
    if (left > max) left = Math.max(12, max);
    pop.style.position = 'fixed';
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.left = Math.round(left) + 'px';
    pop.style.zIndex = '80';
  }

  function openPop() {
    build();
    pop.classList.remove('hidden');
    isOpen = true;
    position();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', closePop, true);
    window.addEventListener('resize', position);
    var rows = menuRows();
    if (rows.length) rows[0].focus(); // menu-button pattern: focus lands inside the menu
  }

  function closePop() {
    if (!isOpen) return;
    isOpen = false;
    pop.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', closePop, true);
    window.removeEventListener('resize', position);
    if (pop.contains(document.activeElement)) btn.focus(); // never strand focus in a closed menu
  }

  function onDocClick(e) {
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    closePop();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePop();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    var rows = menuRows();
    if (!rows.length) return;
    e.preventDefault();
    var i = rows.indexOf(document.activeElement);
    var next = 0;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % rows.length;
    else next = i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length;
    rows[next].focus();
  }

  function onPopClick(e) {
    var t = e.target;
    var row = t && t.closest ? t.closest('[data-action]') : null;
    if (!row) return;
    closePop();
    var act = row.getAttribute('data-action');
    if (act === 'link') shareLink();
    else if (act === 'copy') copyToday();
    else if (act === 'ics') downloadIcs();
    else if (act === 'json') exportJson();
    else if (act === 'csv') exportCsv();
    else if (act === 'import') pickImportFile();
  }

  /* ---------- actions ---------- */

  function shareLink() {
    var done = function (ok) { toast(ok ? 'link copied' : 'copy failed'); };
    if (navigator.share) {
      navigator.share({ title: 'deepthanush · timetable', url: SHARE_URL })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;   /* user dismissed the sheet */
          copyText(SHARE_URL).then(done);
        });
    } else {
      copyText(SHARE_URL).then(done);
    }
  }

  function copyToday() {
    var TT = window.TT;
    if (!TT.dataReady) { toast('timetable still loading'); return; }
    var day = selectedDay || TT.util.todayKey();
    var label = (TT.util.dayLabel(day) || day).toLowerCase();
    var classes = (TT.util.classesOn ? TT.util.classesOn(day) : []) || [];
    var lines = ['my classes · ' + label];
    if (!classes.length) {
      lines.push('no classes · free day');
    } else {
      classes.forEach(function (c) {
        lines.push(c.start + '–' + c.end + ' ' + c.course + '-' + c.type + ' · Room ' + c.room);
      });
    }
    var tasks = timedTasks(day);
    if (tasks.length) {
      lines.push('— tasks —');
      tasks.forEach(function (t) {
        var when = t.end ? t.start + '–' + t.end : t.start;
        lines.push(when + ' ' + (t.done ? '[x]' : '[ ]') + ' ' + t.title);
      });
    }
    var goals = dayGoals();
    if (goals.length) {
      lines.push('— goals —');
      goals.forEach(function (g) {
        lines.push((g.done ? '[x]' : '[ ]') + ' ' + g.text);
      });
    }
    copyText(lines.join('\n')).then(function (ok) {
      toast(ok ? 'agenda copied' : 'copy failed');
    });
  }

  /* timed tasks (start set) for the copied day, sorted by start time */
  function timedTasks(day) {
    var TT = window.TT;
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return [];
    var list;
    try { list = TT.tasks.list(); } catch (err) { return []; }
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (t) {
      if (t && t.day === day && t.start) out.push(t);
    });
    out.sort(function (a, b) {
      var ma = TT.util && typeof TT.util.mins === 'function' ? TT.util.mins(a.start) : 0;
      var mb = TT.util && typeof TT.util.mins === 'function' ? TT.util.mins(b.start) : 0;
      return ma - mb;
    });
    return out;
  }

  /* today's day-scope goals — core/goals.js resolves lazily like export.js */
  function dayGoals() {
    var TT = window.TT;
    if (!TT.goals || typeof TT.goals.items !== 'function') return [];
    var items;
    try { items = TT.goals.items('day'); } catch (err) { return []; }
    if (!Array.isArray(items)) return [];
    var out = [];
    items.forEach(function (g) {
      if (g && g.text) out.push(g);
    });
    return out;
  }

  function downloadIcs() {
    var TT = window.TT;
    if (!TT.dataReady || !TT.data || !TT.data.week) { toast('timetable still loading'); return; }
    var ics = buildIcs(TT.data.week);
    if (!ics) { toast('no classes to export yet'); return; }
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ICS_FILE;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('calendar downloaded');
  }

  /* ---------- export / import (delegated to TT.export, resolved per click) ---------- */

  function exportApi() {
    var api = window.TT && window.TT.export;
    if (!api) toast('export module not loaded', 'err');
    return api || null;
  }

  function exportJson() {
    var api = exportApi();
    if (api) api.json();
  }

  function exportCsv() {
    var api = exportApi();
    if (api) api.csvTasks();
  }

  var importInput = null;

  function pickImportFile() {
    if (!exportApi()) return;                    /* check at click time, not bind time */
    if (!importInput) {
      importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = '.json';
      importInput.hidden = true;
      importInput.addEventListener('change', onImportFile);
      document.body.appendChild(importInput);
    }
    importInput.value = '';                      /* re-picking the same file still fires change */
    importInput.click();
  }

  function onImportFile() {
    var f = importInput.files && importInput.files[0];
    var api = window.TT && window.TT.export;     /* module may have loaded since the pick */
    if (f && api) api.importJson(f);
  }

  /* ---------- .ics building ---------- */

  function mondayOfWeek(now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function atTime(monday, offsetDays, hhmm) {
    var d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offsetDays);
    var m = window.TT.util.mins(hhmm);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return d;
  }

  function stampLocal(d) {   /* floating local time: YYYYMMDDTHHMMSS (no TZID, no Z) */
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      'T' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function stampUtc(d) {     /* DTSTAMP: YYYYMMDDTHHMMSSZ */
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function buildIcs(week) {
    var now = new Date();
    var monday = mondayOfWeek(now);
    var stamp = stampUtc(now);
    var out = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//deepthanush.io//timetable v2//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];
    var n = 0;
    DAYS.forEach(function (day, i) {
      var list = week[day] || [];
      list.forEach(function (c, j) {
        if (!c || !c.start || !c.end) return;
        out.push(
          'BEGIN:VEVENT',
          'UID:deepthanush-tt-' + day + '-' + j + '@deepthanush.io',
          'DTSTAMP:' + stamp,
          'DTSTART:' + stampLocal(atTime(monday, i, c.start)),
          'DTEND:' + stampLocal(atTime(monday, i, c.end)),
          'RRULE:FREQ=WEEKLY;BYDAY=' + BYDAY[day],
          'SUMMARY:' + esc(c.course + (c.type ? '-' + c.type : '')),
          'LOCATION:' + esc(c.room),
          'END:VEVENT'
        );
        n++;
      });
    });
    if (!n) return null;
    out.push('END:VCALENDAR');
    return out.join('\r\n') + '\r\n';
  }

  /* ---------- wire up ---------- */

  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (isOpen) closePop(); else openPop();
  });

  window.TT.on('tt:day-select', function (d) {
    if (d && d.day) selectedDay = d.day;
  });
})();
