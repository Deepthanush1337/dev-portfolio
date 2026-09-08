/* goals.js — TT.goals: tiny day/week goal lists with auto-rollover.
 * Per-scope model in TT.prefs (per-user): 'goals.day' = {date:'YYYY-MM-DD', items},
 * 'goals.week' = {week:'YYYY-Www' (ISO, Mon-based), items}. Item: {id,text,done,doneAt}.
 * Rollover: on ANY access, a stale stamp resets the scope to a fresh empty list
 * (unfinished items are dropped). A day rollover first settles 'goals.streak' (int):
 * previous record had ≥1 item and all done → +1, else 0.
 * Emits 'tt:goals-changed' {scope, items} after every mutation. */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT || !TT.prefs || TT.goals) return;

  var KEYS = { day: 'goals.day', week: 'goals.week' };
  var STREAK_KEY = 'goals.streak';
  var MAX_ITEMS = 12;
  var MAX_TEXT = 200;

  // ---- stamps (local time) --------------------------------------------------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function currentDateKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ISO-8601 week, Monday-based: the Thursday of this week fixes week + year.
  function currentWeekKey() {
    var now = new Date();
    var thu = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    thu.setDate(thu.getDate() - ((thu.getDay() + 6) % 7) + 3);
    var first = new Date(thu.getFullYear(), 0, 4); // Jan 4 is always in week 1
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7) + 3);
    var week = 1 + Math.round((thu - first) / 604800000); // 7 * 24 * 3600 * 1000
    return thu.getFullYear() + '-W' + pad2(week);
  }

  // ---- state ------------------------------------------------------------------

  function scopeOf(scope) {
    return scope === 'week' ? 'week' : 'day';
  }

  function stampOf(scope) {
    return scope === 'week' ? currentWeekKey() : currentDateKey();
  }

  function cleanItems(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_ITEMS; i++) {
      var it = raw[i];
      if (!it || typeof it.text !== 'string' || !it.id) continue;
      var text = it.text.trim().slice(0, MAX_TEXT);
      if (!text) continue;
      out.push({
        id: String(it.id),
        text: text,
        done: !!it.done,
        doneAt: it.done ? (it.doneAt || Date.now()) : null
      });
    }
    return out;
  }

  function read(scope) {
    var raw = TT.prefs.get(KEYS[scope], null);
    if (!raw || typeof raw !== 'object') return null;
    var stamp = scope === 'week' ? raw.week : raw.date;
    if (typeof stamp !== 'string' || !stamp) return null;
    return { stamp: stamp, items: cleanItems(raw.items) };
  }

  function persist(scope, rec) {
    var out = { items: rec.items };
    if (scope === 'week') out.week = rec.stamp; else out.date = rec.stamp;
    TT.prefs.set(KEYS[scope], out);
  }

  function copy(items) {
    return items.map(function (it) {
      return { id: it.id, text: it.text, done: it.done, doneAt: it.doneAt };
    });
  }

  function changed(scope, rec) {
    if (typeof TT.emit === 'function') {
      TT.emit('tt:goals-changed', { scope: scope, items: copy(rec.items) });
    }
  }

  function streakRaw() {
    var n = Number(TT.prefs.get(STREAK_KEY, 0));
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function allDone(items) {
    if (!items.length) return false;
    for (var i = 0; i < items.length; i++) {
      if (!items[i].done) return false;
    }
    return true;
  }

  // Rollover gate — every public method passes through here first. A stale stamp
  // settles the streak (day only), then swaps in a fresh empty list. Emits only
  // on a real rollover (a record existed and got dropped), never on first run.
  function ensure(scope) {
    var stamp = stampOf(scope);
    var rec = read(scope);
    if (rec && rec.stamp === stamp) return rec;
    if (rec && scope === 'day') {
      TT.prefs.set(STREAK_KEY, allDone(rec.items) ? streakRaw() + 1 : 0);
    }
    var fresh = { stamp: stamp, items: [] };
    persist(scope, fresh);
    if (rec) changed(scope, fresh);
    return fresh;
  }

  function uid() {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function find(rec, id) {
    for (var i = 0; i < rec.items.length; i++) {
      if (rec.items[i].id === id) return rec.items[i];
    }
    return null;
  }

  // ---- api --------------------------------------------------------------------

  var api = {
    items: function (scope) {
      scope = scopeOf(scope);
      return copy(ensure(scope).items);
    },

    add: function (text, scope) {
      scope = scopeOf(scope);
      text = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
      if (!text) return null;
      var rec = ensure(scope);
      if (rec.items.length >= MAX_ITEMS) return null;
      var item = { id: uid(), text: text, done: false, doneAt: null };
      rec.items.push(item);
      persist(scope, rec);
      changed(scope, rec);
      return { id: item.id, text: item.text, done: item.done, doneAt: item.doneAt };
    },

    toggle: function (id, scope) {
      scope = scopeOf(scope);
      var rec = ensure(scope);
      var it = find(rec, id);
      if (!it) return null;
      it.done = !it.done;
      it.doneAt = it.done ? Date.now() : null;
      persist(scope, rec);
      changed(scope, rec);
      if (it.done && allDone(rec.items) && typeof TT.emit === 'function') {
        TT.emit('tt:celebrate', {});
        TT.emit('tt:toast', { msg: 'all ' + scope + ' goals done. nice.' });
      }
      return { id: it.id, text: it.text, done: it.done, doneAt: it.doneAt };
    },

    remove: function (id, scope) {
      scope = scopeOf(scope);
      var rec = ensure(scope);
      var before = rec.items.length;
      rec.items = rec.items.filter(function (it) { return it.id !== id; });
      if (rec.items.length === before) return false;
      persist(scope, rec);
      changed(scope, rec);
      return true;
    },

    clearDone: function (scope) {
      scope = scopeOf(scope);
      var rec = ensure(scope);
      var before = rec.items.length;
      rec.items = rec.items.filter(function (it) { return !it.done; });
      var n = before - rec.items.length;
      if (!n) return 0;
      persist(scope, rec);
      changed(scope, rec);
      return n;
    },

    progress: function (scope) {
      scope = scopeOf(scope);
      var items = ensure(scope).items;
      var done = 0;
      for (var i = 0; i < items.length; i++) {
        if (items[i].done) done++;
      }
      return { done: done, total: items.length, all: items.length > 0 && done === items.length };
    },

    streak: function () {
      ensure('day'); // settle any pending day rollover before reading
      return streakRaw();
    },

    resetsIn: function (scope) {
      var now = new Date();
      if (scopeOf(scope) === 'week') {
        // next Monday 00:00 local (a full week out if checked exactly at Monday 00:00)
        var add = (7 - ((now.getDay() + 6) % 7)) % 7 || 7;
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() + add) - now;
      }
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    },

    currentDateKey: currentDateKey,
    currentWeekKey: currentWeekKey
  };

  TT.goals = api;
})();
