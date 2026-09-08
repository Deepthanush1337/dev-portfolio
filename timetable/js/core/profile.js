/* profile.js — TT.user + TT.profile: multi-user identity on raw localStorage keys.
 * Loaded AFTER core/store.js (which already resolved its prefs scope from 'who').
 *
 * Raw keys (never go through TT.prefs):
 *   'deeptt.v2.who'          plain user-id string, ''/absent = demo/anon
 *   'deeptt.v2.u_<id>.name'  plain display-name string
 *   'deeptt.v2.u_<id>.cred'  JSON {password, year, sem, token}  (year/sem = ERP
 *     academic year/semester codes, so 'refresh my timetable' refetches the same
 *     term; token = the sync app_token the gate's /login minted at sign-in, ''
 *     when there isn't one — core/sync.js adopts it on boot via tokenFor)
 *   'deeptt.v2.u_<id>.tt'    JSON timetable snapshot (data.json shape)
 *   'deeptt.v2.demo'         '1' while demo mode was explicitly entered
 * Every mutating action is terminal: it writes storage, then reloads the page so
 * store.js re-resolves scope and the whole app boots as the new user. Exception:
 * when the identity write doesn't land (storage blocked/full) the action surfaces
 * an error and does NOT reload — reloading would loop the welcome gate forever. */
(function () {
  'use strict';

  var TT = window.TT = window.TT || {};

  var BASE = 'deeptt.v2.';
  var K_WHO = BASE + 'who';
  var K_DEMO = BASE + 'demo';

  function userKey(id, suffix) { return BASE + 'u_' + id + '.' + suffix; }

  function rawGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawGetJSON(k) {
    var raw = rawGet(k);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* non-fatal */ }
  }
  function rawSetJSON(k, v) {
    var raw;
    try { raw = JSON.stringify(v); } catch (e) { return; }
    rawSet(k, raw);
  }
  function rawDel(k) {
    try { window.localStorage.removeItem(k); } catch (e) { /* noop */ }
  }
  function reload() {
    try { window.location.reload(); } catch (e) { /* noop */ }
  }

  /* Storage-denied guard: every mutating action ends in reload(), so when the
   * identity write didn't land (localStorage blocked/full) reloading would
   * just resurrect the welcome gate forever. Surface the problem and stay
   * put instead — the gate error slot when it's up, console+toast otherwise. */
  var STORAGE_ERR = 'browser storage is blocked or full — fix that and retry';
  function storageFail() {
    var shown = false;
    try {
      var el = document.querySelector('#tt-auth .auth-err');
      if (el) {
        el.textContent = STORAGE_ERR; // escaped — never innerHTML
        el.classList.remove('hidden');
        shown = true;
      }
    } catch (e) { /* noop */ }
    if (!shown) {
      try { if (window.console && window.console.error) window.console.error('tt: ' + STORAGE_ERR); } catch (e) { /* noop */ }
      try { if (typeof TT.emit === 'function') TT.emit('tt:toast', { msg: STORAGE_ERR, type: 'err' }); } catch (e) { /* noop */ }
    }
  }

  function current() {
    return rawGet(K_WHO) || '';
  }

  TT.profile = {
    current: current,

    isDemo: function () {
      return current() === '';
    },

    signIn: function (opts) {
      opts = opts || {};
      var id = String(opts.id == null ? '' : opts.id).trim();
      if (!id) return false;
      rawSet(userKey(id, 'name'), String(opts.name == null ? id : opts.name));
      // year/sem ride along so 'refresh my timetable' refetches the same term;
      // token (optional) is the sync app_token the gate minted via /login —
      // core/sync.js picks it up on the next boot (TT.sync.adoptToken)
      rawSetJSON(userKey(id, 'cred'), {
        password: String(opts.password == null ? '' : opts.password),
        year: String(opts.year || '29'),
        sem: String(opts.sem || '1'),
        token: String(opts.token || '')
      });
      rawSetJSON(userKey(id, 'tt'), opts.timetable || null);
      rawSet(K_WHO, id); // last write flips identity; store.js rescopes on reload
      if (rawGet(K_WHO) !== id) { storageFail(); return false; } // write didn't land — don't reload into the gate loop
      reload();
      return true;
    },

    signOut: function () {
      rawDel(K_WHO); // per-user u_<id>.* data stays for the next login
      if (rawGet(K_WHO) !== null) { storageFail(); return false; } // removal didn't land
      reload();
      return true;
    },

    wipeUser: function () {
      var id = current();
      if (id) {
        var prefix = userKey(id, '');
        var doomed = [];
        try {
          for (var i = 0; i < window.localStorage.length; i++) {
            var k = window.localStorage.key(i);
            if (k && k.indexOf(prefix) === 0) doomed.push(k);
          }
        } catch (e) { /* noop */ }
        for (var j = 0; j < doomed.length; j++) rawDel(doomed[j]);
      }
      rawDel(K_WHO);
      if (rawGet(K_WHO) !== null) { storageFail(); return false; } // removal didn't land
      reload();
      return true;
    },

    refreshTimetable: function (tt) {
      var id = current();
      if (!id) return; // demo session has no per-user slot to overwrite
      rawSetJSON(userKey(id, 'tt'), tt || null);
      reload();
    },

    demoEnter: function () {
      rawSet(K_DEMO, '1');
      if (rawGet(K_DEMO) !== '1') { storageFail(); return false; } // same gate-loop guard as signIn
      reload();
      return true;
    },

    demoExit: function () {
      rawDel(K_DEMO);
      reload();
    },

    timetableFor: function (id) {
      if (!id) return null;
      return rawGetJSON(userKey(id, 'tt'));
    },

    credsFor: function (id) {
      if (!id) return null;
      return rawGetJSON(userKey(id, 'cred'));
    },

    // sync app_token stored at sign-in ('' when absent) — core/sync.js reads
    // this on boot to adopt the gate's session without a second login
    tokenFor: function (id) {
      if (!id) return '';
      var c = rawGetJSON(userKey(id, 'cred'));
      return c && typeof c.token === 'string' ? c.token : '';
    }
  };

  var who = current();
  TT.user = who ? { id: who, name: rawGet(userKey(who, 'name')) || who } : null;
})();
