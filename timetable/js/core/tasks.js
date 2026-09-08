/* tasks.js — TT.tasks: task store with persistence, CRUD, events, pomo tracking. */
(function () {
  'use strict';

  var TT = window.TT;
  var KEY = 'tasks';
  var tasks = load();

  function load() {
    var raw = TT.prefs.get(KEY, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (t) { return t && typeof t.title === 'string' && t.id; })
      .map(function (t) {
        var st = start(t.start);
        return {
          id: String(t.id),
          title: String(t.title),
          cat: cat(t.cat),
          done: !!t.done,
          createdAt: t.createdAt || Date.now(),
          doneAt: t.done ? (t.doneAt || Date.now()) : null,
          day: day(t.day),
          mins: mins(t.mins),
          start: st,
          end: rangeEnd(st, end(t.end)),
          pomos: typeof t.pomos === 'number' && t.pomos > 0 ? Math.floor(t.pomos) : 0
        };
      });
  }

  function save() {
    TT.prefs.set(KEY, tasks);
    TT.emit('tt:tasks-changed', api.list());
  }

  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function cat(v) {
    return v === 'class' || v === 'life' ? v : 'study';
  }

  function day(v) {
    return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(v) !== -1 ? v : null;
  }

  // 'HH:MM' (00:00–23:59) or null — planned blocks carry their slot start.
  function start(v) {
    v = String(v == null ? '' : v);
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  }

  // 'HH:MM' (00:00–23:59) or null — task ranges carry their slot end.
  function end(v) {
    v = String(v == null ? '' : v);
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  }

  // end only survives when it comes after start ('HH:MM' is fixed-width, so strings compare cleanly).
  function rangeEnd(st, en) {
    return st && en && en > st ? en : null;
  }

  function mins(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  function find(id) {
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === id) return tasks[i];
    }
    return null;
  }

  var api = {
    list: function () {
      return tasks.map(function (t) {
        return {
          id: t.id,
          title: t.title,
          cat: t.cat,
          done: t.done,
          createdAt: t.createdAt,
          doneAt: t.doneAt,
          day: t.day,
          mins: t.mins,
          start: t.start,
          end: t.end,
          pomos: t.pomos
        };
      });
    },

    add: function (input) {
      input = input || {};
      var title = String(input.title || '').trim();
      if (!title) return null;
      var st = start(input.start);
      var task = {
        id: uid(),
        title: title,
        cat: cat(input.cat),
        done: false,
        createdAt: Date.now(),
        doneAt: null,
        day: day(input.day),
        mins: mins(input.mins),
        start: st,
        end: rangeEnd(st, end(input.end)),
        pomos: 0
      };
      tasks.push(task);
      save();
      return task;
    },

    toggle: function (id) {
      var t = find(id);
      if (!t) return null;
      t.done = !t.done;
      t.doneAt = t.done ? Date.now() : null;
      save();
      return t;
    },

    update: function (id, patch) {
      var t = find(id);
      if (!t || !patch) return null;
      if (patch.title !== undefined) {
        var title = String(patch.title).trim();
        if (title) t.title = title;
      }
      if (patch.cat !== undefined) t.cat = cat(patch.cat);
      if (patch.day !== undefined) t.day = day(patch.day);
      if (patch.mins !== undefined) t.mins = mins(patch.mins);
      if (patch.start !== undefined) t.start = start(patch.start);
      if (patch.end !== undefined) t.end = end(patch.end);
      if (patch.start !== undefined || patch.end !== undefined) t.end = rangeEnd(t.start, t.end);
      if (patch.done !== undefined) {
        t.done = !!patch.done;
        t.doneAt = t.done ? (t.doneAt || Date.now()) : null;
      }
      save();
      return t;
    },

    remove: function (id) {
      var before = tasks.length;
      tasks = tasks.filter(function (t) { return t.id !== id; });
      if (tasks.length === before) return false;
      save();
      return true;
    },

    clearDone: function () {
      var before = tasks.length;
      tasks = tasks.filter(function (t) { return !t.done; });
      if (tasks.length === before) return 0;
      var n = before - tasks.length;
      save();
      return n;
    },

    counts: function () {
      var done = 0;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].done) done++;
      }
      return { total: tasks.length, done: done, active: tasks.length - done };
    }
  };

  TT.on('tt:focus-done', function (detail) {
    if (!detail || !detail.taskId) return;
    var t = find(detail.taskId);
    if (!t) return;
    t.pomos++;
    save();
  });

  TT.tasks = api;
})();
