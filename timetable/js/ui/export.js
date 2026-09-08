/* ui/export.js — TT.export: data portability for the dashboard.
 * json(): full backup ({app:'deeptt', version:3, exportedAt, tasks, focuslog,
 *   prefs:{theme, remind}}) → 'deepthanush-backup-YYYY-MM-DD.json'.
 * csvTasks(): flat task table (RFC4180 quoting) → 'deepthanush-tasks.csv'.
 * importJson(file): validates a backup, merges tasks by id (new ones added via
 *   TT.tasks.add, done state replayed via TT.tasks.toggle → events propagate,
 *   no reload), restores the theme pref (raw 'deeptt.v2.theme' key + html class).
 * share.js resolves TT.export lazily at click time (it loads before this file). */
(function () {
  'use strict';

  var TT = window.TT;
  if (!TT) return;

  var THEME_KEY = 'deeptt.v2.theme';   // raw key — the pre-paint script reads it, not TT.prefs
  var THEMES = ['', 'theme-violet', 'theme-rose'];

  function toast(msg, type) {
    TT.emit('tt:toast', type ? { msg: msg, type: type } : { msg: msg });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dateStamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function themePref() {
    try { return window.localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; }
  }

  /* ---------- backup .json ---------- */

  function json() {
    if (!TT.tasks) { toast('tasks not ready', 'err'); return; }
    var payload = {
      app: 'deeptt',
      version: 3,
      exportedAt: new Date().toISOString(),
      tasks: TT.tasks.list(),
      focuslog: TT.prefs.get('focuslog', {}),
      prefs: {
        theme: themePref(),
        remind: TT.prefs.get('remind', null)
      }
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    download(blob, 'deepthanush-backup-' + dateStamp(new Date()) + '.json');
    toast('backup downloaded');
  }

  /* ---------- tasks .csv ---------- */

  /* RFC4180: quote fields containing a comma, quote, CR or LF; double inner quotes. */
  function cell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvTasks() {
    if (!TT.tasks) { toast('tasks not ready', 'err'); return; }
    var rows = ['title,cat,day,start,end,mins,done,pomos,createdAt'];
    TT.tasks.list().forEach(function (t) {
      rows.push([t.title, t.cat, t.day, t.start, t.end, t.mins, t.done, t.pomos, t.createdAt].map(cell).join(','));
    });
    var blob = new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    download(blob, 'deepthanush-tasks.csv');
    toast('tasks downloaded');
  }

  /* ---------- import backup ---------- */

  function applyTheme(v) {
    var root = document.documentElement;
    THEMES.forEach(function (t) { if (t) root.classList.remove(t); });
    if (v) root.classList.add(v);
    try { window.localStorage.setItem(THEME_KEY, v); } catch (e) { /* non-fatal */ }
  }

  function merge(data) {
    var local = {};
    TT.tasks.list().forEach(function (t) { local[t.id] = true; });
    var imported = Array.isArray(data.tasks) ? data.tasks : [];
    var n = 0;
    imported.forEach(function (t) {
      if (!t || typeof t.title !== 'string' || !t.title.trim()) return;
      if (t.id && local[t.id]) return;              // id already lives here — skip
      var added = TT.tasks.add({ title: t.title, cat: t.cat, day: t.day, start: t.start, end: t.end, mins: t.mins });
      if (!added) return;
      if (t.done) TT.tasks.toggle(added.id);        // replay done state on the fresh id
      n++;
    });
    if (data.prefs && THEMES.indexOf(data.prefs.theme) !== -1) applyTheme(data.prefs.theme);
    return n;
  }

  function importJson(file) {
    if (!file || !TT.tasks) { toast('not a valid backup file', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result || '')); }
      catch (e) { toast('not a valid backup file', 'err'); return; }
      if (!data || data.app !== 'deeptt') { toast('not a valid backup file', 'err'); return; }
      var n = merge(data);
      toast('imported ' + n + ' task' + (n === 1 ? '' : 's'));
    };
    reader.onerror = function () { toast('not a valid backup file', 'err'); };
    reader.readAsText(file);
  }

  TT.export = { json: json, csvTasks: csvTasks, importJson: importJson };
})();
