/* sync.js — TT.sync: optional cloud backup for tasks & planner study blocks.
 * Talks to the owner's FastAPI backend (Supabase behind it):
 *   POST /login (form: username, password, turnstile_token) -> { app_token }
 *   GET/POST /data/{table} · PATCH/DELETE /data/{table}/{uuid}
 *   data calls authenticate with header 'x-app-token' (30-day HMAC token).
 * Tables: tasks {title, course, due_date, priority, done},
 *         study_blocks {course, day, start_time, end_time, note, done}.
 *
 * Link model: TT.tasks whitelists its own fields, so the local<->cloud
 * mapping lives here in prefs 'sync.links' = { localTaskId: { cid, sbid } } —
 *   cid  = row id in cloud 'tasks' (the task's cloud twin)
 *   sbid = row id in cloud 'study_blocks' (planner blocks only: cat 'study'
 *          + day + start; mirrored one-way with current-week Mon-based dates)
 * Delete tracking: prefs 'sync.known' caches the last-seen local id set and
 * is diffed on 'tt:tasks-changed'; removed ids with a link are cloud-deleted.
 * Failed deletes go to prefs 'sync.gone' tombstones so an offline delete can
 * neither resurrect on the next pull nor orphan its study block.
 *
 * Everything is best-effort: failures flip state to 'error', surface at most
 * one 'tt:toast' (errors only), and never throw into other modules. With no
 * token the module is inert and the page works fully offline.
 * States: 'off' (no token) | 'ready' | 'syncing' | 'error'.
 * Emits 'tt:sync-state' { state, lastSync } on every transition.
 *
 * One sign-in covers timetable + sync: the welcome gate (ui/auth.js) runs
 * /login during profile sign-in and stashes the app_token in the profile cred
 * blob (core/profile.js). On boot, with no session of its own, this module
 * adopts that token (adoptToken: pull THEN push, silent). A /data call that
 * comes back 401/403 (expired 30-day token) drops the session AND scrubs the
 * blob token so the corpse can't be re-adopted, toasting once per session:
 * 'sync session expired — tap the cloud to reconnect'.
 */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT || !TT.prefs || !TT.emit || !TT.on) return;

  var BASE = 'https://kl-erp-buddy-api.onrender.com';
  var TIMEOUT = 75000;      // render free-tier cold starts can take 30-60s
  var DEBOUNCE = 1500;
  var RETRY_DELAYS = [8000, 30000]; // non-auth failures retry this many times
  var DEFAULT_BLOCK_MIN = 30; // length assumed for planner blocks without mins
  var VALID_CATS = { study: 1, class: 1, life: 1 };
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  var K_TOKEN = 'sync.token';
  var K_LAST = 'sync.last';
  var K_LINKS = 'sync.links';
  var K_KNOWN = 'sync.known';
  var K_GONE = 'sync.gone';

  // ---- persisted + runtime state -------------------------------------------

  var token = TT.prefs.get(K_TOKEN, null);
  var lastSync = TT.prefs.get(K_LAST, null);
  var links = asObj(TT.prefs.get(K_LINKS, {}));
  var gone = normalizeGone(TT.prefs.get(K_GONE, null));

  var state = token ? 'ready' : 'off';
  var applying = false;      // true while pullAll mutates local tasks
  var timer = null;          // debounce handle
  var pushInFlight = null;   // single-flight promise
  var pushWanted = false;    // a change arrived mid-push -> run once more
  var pullInFlight = null;
  var expiredToastShown = false; // 'session expired' toast fires once per page session

  function asObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  function isId(x) { return typeof x === 'string' && x.length > 0 && x.length < 64; }

  function normalizeGone(v) {
    v = asObj(v);
    return {
      tasks: (Array.isArray(v.tasks) ? v.tasks : []).filter(isId).slice(0, 200),
      blocks: (Array.isArray(v.blocks) ? v.blocks : []).filter(isId).slice(0, 200)
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---- state / events --------------------------------------------------------

  function setState(next) {
    if (next === state) return;
    state = next;
    TT.emit('tt:sync-state', { state: state, lastSync: lastSync });
  }

  function touch() {
    lastSync = Date.now();
    TT.prefs.set(K_LAST, lastSync);
    TT.emit('tt:sync-state', { state: state, lastSync: lastSync });
  }

  function toastErr(msg) {
    TT.emit('tt:toast', { msg: msg, type: 'err' });
  }

  function enabled() { return !!token; }

  function isAuthErr(e) { return !!e && (e.status === 401 || e.status === 403); }

  // Scrub the gate-stored token from the profile cred blob (raw global key
  // 'deeptt.v2.u_<id>.cred' — NOT TT.prefs, that store is per-user scoped),
  // preserving password/year/sem, so a dead or signed-out session can't be
  // re-adopted on the next boot. Only touches the blob when it holds THIS
  // session's token: a differing token means the blob belongs to another
  // account's gate sign-in (sync account ≠ timetable account is legal) and
  // stays put. Best-effort — never breaks the caller over storage.
  function clearGateToken(expected) {
    if (!expected) return;
    try {
      var prof = TT.profile;
      if (!prof || typeof prof.current !== 'function' || typeof prof.tokenFor !== 'function') return;
      var id = prof.current();
      if (!id || prof.tokenFor(id) !== expected) return;
      var key = 'deeptt.v2.u_' + id + '.cred';
      var raw = window.localStorage.getItem(key);
      if (raw === null) return;
      var blob = null;
      try { blob = JSON.parse(raw); } catch (e) { blob = null; }
      if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return;
      blob.token = '';
      window.localStorage.setItem(key, JSON.stringify(blob));
    } catch (e) { /* noop */ }
  }

  // token is dead -> drop the session locally; cloud data stays put.
  // expired=true (a /data call came back 401/403): also scrub the gate blob
  // token and say it once per session — the user reconnects via the cloud.
  function dropSession(expired) {
    var dead = token;
    token = null;
    TT.prefs.remove(K_TOKEN);
    if (expired) {
      clearGateToken(dead);
      if (!expiredToastShown) {
        expiredToastShown = true;
        toastErr('sync session expired — tap the cloud to reconnect');
      }
    }
    setState('off');
  }

  function failState(e) {
    if (isAuthErr(e)) dropSession(true);
    else setState('error');
  }

  // ---- http -------------------------------------------------------------------

  // req(method, path, body) -> promise of parsed json. body as string is sent
  // form-urlencoded (login), objects go as JSON. Rejects with Error carrying
  // .status on http failures; network/abort failures pass through as TypeError
  // / 'request timed out'. Never throws synchronously.
  function req(method, path, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var killer = ctrl
      ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* noop */ } }, TIMEOUT)
      : null;
    var opts = { method: method, headers: {} };
    if (token) opts.headers['x-app-token'] = token;
    if (typeof body === 'string') {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (ctrl) opts.signal = ctrl.signal;

    function done() { if (killer) clearTimeout(killer); }

    return fetch(BASE + path, opts).then(function (res) {
      done();
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
          var err = new Error(data && data.detail ? String(data.detail) : 'http ' + res.status);
          err.status = res.status;
          throw err;
        }
        return asObj(data);
      });
    }, function (e) {
      done();
      if (e && e.name === 'AbortError') {
        var t = new Error('request timed out');
        t.status = 0;
        throw t;
      }
      throw e;
    });
  }

  // ---- time / date helpers ------------------------------------------------------

  function toMin(hhmm) {
    if (TT.util && typeof TT.util.mins === 'function') return TT.util.mins(hhmm);
    var p = String(hhmm || '').split(':');
    return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
  }

  function toHm(m) {
    if (TT.util && typeof TT.util.fmt === 'function') return TT.util.fmt(m);
    m = Math.max(0, Math.min(1439, Math.round(m)));
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  // 'HH:MM' end of a planner block: start + mins (default 30), clamped to 23:59
  function blockEnd(task) {
    return toHm(Math.min(toMin(task.start) + (task.mins || DEFAULT_BLOCK_MIN), 1439));
  }

  // calendar date (YYYY-MM-DD) of weekday `dayKey` in the CURRENT week,
  // Mon-based (ISO: Sunday belongs to the week that started the previous Mon)
  function weekDate(dayKey) {
    var idx = DAYS.indexOf(dayKey);
    if (idx === -1) return null;
    var now = new Date();
    var dow = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + idx);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // course for a study_blocks row: planner titles start with the course code
  // ('26MT1101 prep · 10:40') — use it when it matches the catalog, else 'study'
  function sbCourse(task) {
    var m = /^([A-Za-z0-9]{6,12})\b/.exec(String(task.title || ''));
    var code = m ? m[1].toUpperCase() : null;
    var courses = TT.data && TT.data.courses;
    return code && courses && courses[code] ? code : 'study';
  }

  // ---- tombstones (deletes that must outlive a failure) -------------------------

  function saveGone() { TT.prefs.set(K_GONE, gone); }

  function bury(kind, id) {
    if (!isId(id)) return;
    if (gone[kind].indexOf(id) !== -1) return;
    gone[kind].push(id);
    if (gone[kind].length > 200) gone[kind].shift();
    saveGone();
  }

  function unbury(kind, id) {
    var i = gone[kind].indexOf(id);
    if (i === -1) return;
    gone[kind].splice(i, 1);
    saveGone();
  }

  // DELETE one cloud row, tombstoning first so a failure is retried by sweep.
  // Swallows everything but auth errors (which reject).
  function del(kind, id) {
    var table = kind === 'tasks' ? 'tasks' : 'study_blocks';
    bury(kind, id);
    return req('DELETE', '/data/' + table + '/' + id).then(function () {
      unbury(kind, id);
    }, function (e) {
      if (e && e.status === 404) { unbury(kind, id); return; }
      if (isAuthErr(e)) throw e;
      // stays tombstoned -> retried on the next push/pull
    });
  }

  // best-effort retry of every pending delete at the start of a sync round
  function sweepGone() {
    var jobs = [];
    gone.tasks.slice().forEach(function (id) { jobs.push(del('tasks', id)); });
    gone.blocks.slice().forEach(function (id) { jobs.push(del('blocks', id)); });
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).then(function () { /* swept */ }, function (e) {
      if (isAuthErr(e)) throw e;
    });
  }

  function cloudDelete(link) {
    var jobs = [];
    if (link.cid) jobs.push(del('tasks', link.cid));
    if (link.sbid) jobs.push(del('blocks', link.sbid));
    return Promise.all(jobs).then(function () { /* done */ });
  }

  // ---- local task access ----------------------------------------------------------

  function saveLinks() { TT.prefs.set(K_LINKS, links); }

  function findTask(id) {
    if (!TT.tasks) return null;
    var list = TT.tasks.list();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function saveKnown() {
    if (!TT.tasks) return;
    TT.prefs.set(K_KNOWN, TT.tasks.list().map(function (t) { return t.id; }));
  }

  // ---- push -------------------------------------------------------------------------

  // a PATCH that matched nothing server-side comes back with an empty row
  function emptyRow(res) {
    var row = res && res.row;
    if (!row) return true;
    if (Array.isArray(row)) return row.length === 0;
    return typeof row === 'object' && !row.id;
  }

  function createTaskRow(task, link) {
    return req('POST', '/data/tasks', {
      title: String(task.title || '').slice(0, 200),
      course: task.cat,
      done: !!task.done
    }).then(function (res) {
      var row = res && res.row;
      if (row && row.id) {
        link.cid = String(row.id);
        saveLinks();
        return;
      }
      var e = new Error('bad row from server');
      e.status = 502;
      throw e;
    });
  }

  function isPlannerBlock(task) {
    return task.cat === 'study' && !!task.day && !!task.start;
  }

  function blockFields(task) {
    return {
      course: sbCourse(task),
      day: weekDate(task.day),
      start_time: task.start,
      end_time: blockEnd(task),
      note: String(task.title || '').slice(0, 300),
      done: !!task.done
    };
  }

  function createBlockRow(link, fields) {
    return req('POST', '/data/study_blocks', fields).then(function (res) {
      var row = res && res.row;
      if (row && row.id) {
        link.sbid = String(row.id);
        saveLinks();
        return;
      }
      var e = new Error('bad row from server');
      e.status = 502;
      throw e;
    });
  }

  // mirror one planner block into study_blocks; un-mirror when it stops being one
  function pushBlock(task, link) {
    if (!isPlannerBlock(task)) {
      if (!link.sbid) return null;
      var sbid = link.sbid;
      delete link.sbid;
      saveLinks();
      return del('blocks', sbid);
    }
    var fields = blockFields(task);
    if (!fields.day) return null; // unmapped weekday -> nothing to mirror
    if (link.sbid) {
      return req('PATCH', '/data/study_blocks/' + link.sbid, fields).then(function (res) {
        if (emptyRow(res)) { // row vanished server-side -> re-create
          delete link.sbid;
          return createBlockRow(link, fields);
        }
      });
    }
    return createBlockRow(link, fields);
  }

  function pushTask(task) {
    var link = links[task.id];
    if (!link) link = links[task.id] = {};
    var step = link.cid
      ? req('PATCH', '/data/tasks/' + link.cid, {
          title: String(task.title || '').slice(0, 200),
          done: !!task.done,
          course: task.cat
        }).then(function (res) {
          if (emptyRow(res)) { // row vanished server-side -> re-create
            delete link.cid;
            return createTaskRow(task, link);
          }
        })
      : createTaskRow(task, link);
    return step.then(function () { return pushBlock(task, link); });
  }

  function doPush() {
    // never overlap a pull: its merge must settle before we snapshot local state
    var wait = pullInFlight || Promise.resolve();
    return wait.then(run, run);

    function run() {
      if (!enabled() || !TT.tasks) return false;
      return sweepGone().then(function () {
        var chain = Promise.resolve();
        TT.tasks.list().forEach(function (task) {
          chain = chain.then(function () { return pushTask(task); });
        });
        return chain.then(function () {
          saveLinks();
          saveKnown();
          return true;
        });
      });
    }
  }

  function pushAll() {
    if (!enabled() || !TT.tasks) return Promise.resolve(false);
    pushWanted = true;
    if (pushInFlight) return pushInFlight;
    setState('syncing');
    pushInFlight = new Promise(function (resolve, reject) {
      (function loop() {
        pushWanted = false;
        Promise.resolve(doPush()).then(function (ok) {
          if (pushWanted && enabled()) { loop(); return; } // changed mid-push -> once more
          pushInFlight = null;
          touch();
          setState('ready');
          resolve(ok);
        }, function (e) {
          pushInFlight = null;
          failState(e);
          reject(e);
        });
      })();
    });
    return pushInFlight;
  }

  function schedulePush() {
    if (!enabled()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      pushAll().then(function () { /* quiet on success */ }, function (e) {
        if (isAuthErr(e)) return; // failState already handled + toasted
        toastErr('couldn\'t sync — retrying in the background');
        // one automatic retry a few seconds later covers cold-start timeouts
        setTimeout(function () {
          if (!enabled()) return;
          pushAll().then(function () { /* recovered */ }, function (e2) {
            if (!isAuthErr(e2)) toastErr('still offline — will retry on your next change');
          });
        }, 8000);
      });
    }, DEBOUNCE);
  }

  // ---- pull ---------------------------------------------------------------------------

  // merge cloud rows into local tasks (cloud wins on content; local wins on
  // deletes — a link whose task vanished locally deletes the cloud row)
  function applyRows(rows) {
    applying = true;
    try {
      var byCid = {}; // cloud row id -> local task id
      Object.keys(links).forEach(function (id) {
        if (links[id] && links[id].cid) byCid[links[id].cid] = id;
      });

      // pass 1: local task is gone (deleted while signed out) -> kill the cloud row
      Object.keys(links).forEach(function (id) {
        if (!findTask(id)) {
          var link = links[id];
          delete links[id];
          if (link && link.cid) bury('tasks', link.cid);
          if (link && link.sbid) bury('blocks', link.sbid);
        }
      });
      saveLinks();
      saveGone();

      // pass 2: apply rows — update linked tasks, create unknown ones
      var seen = {};
      rows.forEach(function (row) {
        if (!row || !row.id) return;
        var cid = String(row.id);
        if (gone.tasks.indexOf(cid) !== -1) return; // delete pending -> no resurrection
        seen[cid] = true;
        var localId = byCid[cid];
        var t = localId ? findTask(localId) : null;
        if (t) {
          var patch = { title: row.title, done: !!row.done };
          if (VALID_CATS[row.course]) patch.cat = row.course;
          TT.tasks.update(t.id, patch);
          return;
        }
        var made = TT.tasks.add({
          title: typeof row.title === 'string' && row.title.trim() ? row.title : '(untitled)',
          cat: VALID_CATS[row.course] ? row.course : 'life'
        });
        if (!made) return;
        var created = Date.parse(row.created_at || '');
        if (!isNaN(created)) made.createdAt = created; // add() returns the live task
        TT.tasks.update(made.id, { done: !!row.done }); // persists createdAt + done
        links[made.id] = { cid: cid };
      });

      // pass 3: link whose cloud row vanished -> drop cid; next push re-creates it
      Object.keys(links).forEach(function (id) {
        var link = links[id];
        if (link && link.cid && !seen[link.cid] && gone.tasks.indexOf(link.cid) === -1) {
          delete link.cid;
        }
      });
      saveLinks();
      saveKnown();
    } finally {
      applying = false;
    }
  }

  function pullAll() {
    if (!enabled() || !TT.tasks) return Promise.resolve(false);
    if (pullInFlight) return pullInFlight;
    setState('syncing');
    // never overlap a push: its writes must land before we read cloud state
    var wait = pushInFlight || Promise.resolve();
    pullInFlight = wait.then(run, run);
    return pullInFlight;

    function run() {
      if (!enabled()) { pullInFlight = null; return false; }
      return sweepGone()
        .then(function () { return req('GET', '/data/tasks'); })
        .then(function (res) {
          applyRows(res && Array.isArray(res.rows) ? res.rows : []);
          // applyRows may bury fresh tombstones (locally-deleted rows still in
          // the cloud) — sweep again so this pull actually deletes them
          return sweepGone();
        })
        .then(function () {
          pullInFlight = null;
          touch();
          setState('ready');
          return true;
        }, function (e) {
          pullInFlight = null;
          failState(e);
          throw e;
        });
    }
  }

  // ---- auth -----------------------------------------------------------------------------

  // Hand a token straight in (the gate's /login already minted it at profile
  // sign-in) — no password round-trip. Stores the session, then runs one full
  // round: pullAll THEN pushAll, so tasks created locally before sign-in
  // upload after the merge settles. Resolves true on success; a 401/403
  // mid-adopt drops the session (failState already scrubbed the gate blob and
  // toasted) and resolves false. Never rejects — callers may fire-and-forget.
  function adoptToken(tok) {
    tok = String(tok || '');
    if (!tok) return Promise.resolve(false);
    token = tok;
    TT.prefs.set(K_TOKEN, token);
    setState('ready');
    return pullAll().then(function () {
      return pushAll();
    }).then(function () {
      return true;
    }, function (e) {
      if (isAuthErr(e)) dropSession(); // already dropped by failState — idempotent
      return false; // transient failure: token stays stored, state says 'error'
    });
  }

  function signIn(user, pass, tsToken) {
    user = String(user || '').trim();
    pass = String(pass || '');
    if (!user || !pass) {
      var bad = new Error('need both id & password');
      bad.status = 400;
      return Promise.reject(bad);
    }
    setState('syncing');
    return req('POST', '/login',
      'username=' + encodeURIComponent(user) +
      '&password=' + encodeURIComponent(pass) +
      '&turnstile_token=' + encodeURIComponent(tsToken || '')
    ).then(function (res) {
      if (!res || !res.app_token) {
        var e = new Error('no token returned');
        e.status = 502;
        throw e;
      }
      token = String(res.app_token);
      TT.prefs.set(K_TOKEN, token);
      setState('ready');
      return pullAll(); // a failed first pull rejects signIn; the token stays stored
    }).then(function (v) {
      return v;
    }, function (e) { // login http failure, missing token, or first-pull failure
      if (isAuthErr(e)) dropSession();          // bad credentials -> stay signed out
      else if (!token) setState('off');         // no session established -> 'off'
      else setState('error');                   // session kept, sync failed -> 'error'
      throw e;
    });
  }

  function signOut() {
    if (timer) { clearTimeout(timer); timer = null; }
    // gate blob holding THIS token gets scrubbed too, so sign-out sticks past
    // the next boot's auto-adopt; a blob with a different token (sync account
    // ≠ timetable account) is left alone — clearGateToken decides by matching
    clearGateToken(token);
    token = null;
    TT.prefs.remove(K_TOKEN);
    setState('off');
    // links/known/gone stay: tasks deleted while signed out are reconciled
    // against the cloud on the next sign-in's pullAll
    return Promise.resolve();
  }

  // ---- local change watcher --------------------------------------------------------------------------------

  function onTasksChanged() {
    if (!enabled() || applying || !TT.tasks) return;
    var cur = {};
    TT.tasks.list().forEach(function (t) { cur[t.id] = true; });
    var known = TT.prefs.get(K_KNOWN, []);
    var removals = [];
    if (Array.isArray(known)) {
      known.forEach(function (id) {
        if (cur[id]) return; // still here
        var link = links[id];
        delete links[id];
        if (link && (link.cid || link.sbid)) removals.push(cloudDelete(link));
      });
      if (removals.length) saveLinks();
    }
    saveKnown();
    if (removals.length) {
      Promise.all(removals).then(function () { /* deleted */ }, function () {
        dropSession(true); // only auth errors reject out of cloudDelete — a /data 401/403
      });
    }
    schedulePush();
  }

  // ---- api + init --------------------------------------------------------------------------------------------

  var api = {
    enabled: enabled,
    signIn: signIn,
    signOut: signOut,
    adoptToken: adoptToken,
    pullAll: pullAll,
    pushAll: pushAll,
    schedulePush: schedulePush
  };
  Object.defineProperty(api, 'state', { get: function () { return state; } });
  Object.defineProperty(api, 'lastSync', { get: function () { return lastSync; } });
  Object.defineProperty(api, 'token', { get: function () { return token; } });
  TT.sync = api;

  TT.on('tt:tasks-changed', function () {
    try { onTasksChanged(); } catch (e) { /* never throw into other modules */ }
  });

  // announce the initial state for anything already listening, then kick the
  // first sync round. With a session of its own: one quiet catch-up pull —
  // failures surface as state, not toasts. Without one: silently adopt the
  // gate token (profile sign-in ran /login and stashed it in the cred blob),
  // which pulls then pushes. An expired token still earns its single
  // 'session expired' toast from dropSession — that's the one loud case.
  TT.emit('tt:sync-state', { state: state, lastSync: lastSync });

  // Wake the Render free-tier backend NOW so the 1.2s sync round below doesn't
  // eat a 30-60s cold start inside its own request timeout.
  try { fetch(BASE + '/', { method: 'GET' }).then(function () { /* warm */ }, function () { /* offline */ }); } catch (e) { /* no fetch */ }

  // run fn() with retries on TRANSIENT failures (network, timeout, 5xx);
  // auth errors stop immediately (failState already handled those)
  function withRetry(fn, attempt) {
    attempt = attempt || 0;
    return fn().then(null, function (e) {
      if (isAuthErr(e) || attempt >= RETRY_DELAYS.length) throw e;
      return new Promise(function (res) {
        setTimeout(res, RETRY_DELAYS[attempt]);
      }).then(function () { return withRetry(fn, attempt + 1); });
    });
  }

  setTimeout(function () {
    if (enabled()) {
      withRetry(function () { return pullAll(); }).then(function () { /* fresh */ }, function () { /* state says it */ });
      return;
    }
    var gateToken = '';
    try {
      if (TT.profile && typeof TT.profile.current === 'function' &&
          typeof TT.profile.tokenFor === 'function') {
        var who = TT.profile.current();
        if (who) gateToken = TT.profile.tokenFor(who) || '';
      }
    } catch (e) { gateToken = ''; }
    if (!gateToken) return;
    // adoptToken resolves false (never rejects): auth failure drops the token
    // (enabled() false -> no retry); transient failure keeps it -> retry.
    withRetry(function () {
      return adoptToken(gateToken).then(function (ok) {
        if (!ok && enabled()) { var e = new Error('adopt failed'); e.status = 0; throw e; }
        return ok;
      });
    }).then(function () { /* quiet either way */ }, function () { /* still off/error — state says it */ });
  }, 1200);
})();
