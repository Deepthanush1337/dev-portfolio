/* store.js — owns window.TT. Loaded first; every other module only reads/extends it.
 * Provides: TT.prefs (per-user scoped localStorage JSON store, in-memory fallback),
 * TT.emit / TT.on (document CustomEvent bus), TT.els + TT.$ (lazy id cache).
 *
 * Scoping: at load, the RAW localStorage key 'deeptt.v2.who' (plain user-id string,
 * ''/absent = demo/anon) decides the prefs prefix — 'deeptt.v2.u_<who>.' when signed
 * in, else plain 'deeptt.v2.'. The resolved prefix is exposed as TT.prefs.scope.
 * The scope is fixed for the page lifetime; user switches always reload the page.
 * Runs BEFORE core/profile.js, so it must not depend on TT.profile.
 * GLOBAL exception: the theme lives at raw key 'deeptt.v2.theme' and never scopes. */
(function () {
  'use strict';

  var TT = window.TT = window.TT || {};

  var BASE = 'deeptt.v2.';
  var NS = BASE;
  try {
    var who = window.localStorage.getItem(BASE + 'who'); // plain string, '' = demo
    if (who) NS = BASE + 'u_' + who + '.';
  } catch (e) { /* storage unavailable — stay on the base (demo) scope */ }
  var mem = new Map(); // fallback when localStorage is unavailable (private mode, quota, disabled)

  TT.prefs = {
    scope: NS, // resolved key prefix for this page lifetime (read-only)
    get: function (k, fb) {
      try {
        var raw = window.localStorage.getItem(NS + k);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) { /* fall through to memory */ }
      return mem.has(k) ? mem.get(k) : fb;
    },
    set: function (k, v) {
      var raw;
      try { raw = JSON.stringify(v); } catch (e) { return; }
      try {
        window.localStorage.setItem(NS + k, raw);
        mem.delete(k);
      } catch (e) {
        mem.set(k, v);
      }
    },
    remove: function (k) {
      mem.delete(k);
      try { window.localStorage.removeItem(NS + k); } catch (e) { /* noop */ }
    }
  };

  TT.emit = function (name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  };

  TT.on = function (name, fn) {
    if (typeof fn !== 'function') return function () {};
    var handler = function (e) { fn(e.detail, e); };
    document.addEventListener(name, handler);
    return function () { document.removeEventListener(name, handler); };
  };

  TT.els = {};
  TT.$ = function (id) {
    if (typeof id !== 'string') return null;
    var key = id.charAt(0) === '#' ? id.slice(1) : id;
    if (Object.prototype.hasOwnProperty.call(TT.els, key)) return TT.els[key];
    var el = document.getElementById(key);
    if (el) TT.els[key] = el; // only cache hits, so late-injected DOM stays findable
    return el;
  };
})();
