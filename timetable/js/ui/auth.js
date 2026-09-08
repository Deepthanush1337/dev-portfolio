/* ui/auth.js — owns #tt-auth (welcome gate) + #tt-user-btn (account menu).
 *
 * WELCOME GATE: on load, when there is no signed-in user
 * (TT.profile.current()) and the RAW localStorage flag 'deeptt.v2.demo'
 * is not '1', builds a full-screen overlay inside #tt-auth and unhides it.
 * One submit performs BOTH logins: POST /login on the buddy API (form:
 * username, password, turnstile_token — the Cloudflare Turnstile widget
 * mounts above the submit button) returns the sync app_token + the ERP
 * session cookies; then TT.erp.fetchTimetable(user, pass, year, sem,
 * session) pulls the grid and TT.profile.signIn stores creds + app_token +
 * timetable (terminal — it reloads; core/sync.js adopts the stored token
 * on boot, so cloud sync comes up already connected). Nothing is stored
 * unless both steps succeed. 'just look around (demo)' calls
 * TT.profile.demoEnter() (also terminal). When signed in or in demo,
 * #tt-auth stays hidden and is emptied.
 *
 * ACCOUNT MENU: popover panel built under the topbar account button;
 * closes on outside click / Escape / scroll. Signed in: refresh timetable
 * (TT.erp.fetchTimetable with stored creds from TT.profile.credsFor →
 * TT.profile.refreshTimetable; failures toast + restore the row), switch
 * account (TT.profile.signOut), wipe device data (confirm() →
 * TT.profile.wipeUser()). Demo: 'sign in with your ERP' (TT.profile.demoExit
 * → reload → gate returns) + a disabled 'demo data' hint row. The topbar
 * button carries .is-on while signed in. Every profile action is terminal
 * (it reloads the page), so nothing here re-renders after calling one.
 *
 * Only static markup is injected via innerHTML; the user id and ERP error
 * messages always go in through textContent. Styles live in css/auth.css
 * (the gate's turnstile mount reuses .sync-ts from css/sync.css).
 */
(function () {
  'use strict';

  var TT = window.TT;
  if (!TT) return;

  var DEMO_KEY = 'deeptt.v2.demo'; // raw global key — NOT TT.prefs (that store is per-user scoped)
  var SUBMIT_LABEL = 'pull my timetable';
  var BUSY_LABEL = 'talking to ERP…';
  var TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var TS_SITEKEY = '0x4AAAAAACvzvtywbMlUWN05';
  var LOGIN_URL = 'https://kl-erp-buddy-api.onrender.com/login';
  var LOGIN_TIMEOUT = 60000; // render free-tier cold start + server-side ERP login — same budget as erp.js

  var root = document.getElementById('tt-auth');
  var btn = document.getElementById('tt-user-btn');
  var profile = TT.profile || null;

  /* ---------------- small helpers ---------------- */

  function toast(msg, type) {
    if (typeof TT.emit === 'function') {
      TT.emit('tt:toast', type ? { msg: msg, type: type } : { msg: msg });
    }
  }

  function icons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  }

  function demoFlag() {
    try { return window.localStorage.getItem(DEMO_KEY) === '1'; } catch (e) { return false; }
  }

  /* Signed-in user id, '' when anon. core/profile.js returns the plain id
   * string; the {id, name} object lives on TT.user — tolerate both shapes. */
  function meId() {
    try {
      var c = (profile && typeof profile.current === 'function') ? profile.current() : null;
      if (c && typeof c === 'object') return String(c.id || '');
      return c ? String(c) : '';
    } catch (e) { return ''; }
  }

  function errMsg(err) {
    var m = err && err.message ? err.message : String(err || '');
    m = String(m).trim();
    return m || 'something went wrong — try again';
  }

  function erp() {
    return (TT.erp && typeof TT.erp.fetchTimetable === 'function') ? TT.erp : null;
  }

  /* Stored creds for a user id — read defensively; the record shape is
   * owned by core/profile.js. Falls back to the fetchTimetable defaults. */
  function creds(id) {
    var c = {};
    try { c = (profile && typeof profile.credsFor === 'function') ? (profile.credsFor(id) || {}) : {}; }
    catch (e) { c = {}; }
    return {
      pass: c.password || c.pass || '',
      year: c.year || c.yearCode || '29',
      sem: c.sem || c.semId || '1'
    };
  }

  /* ==================== (a) welcome gate ==================== */

  var gateForm = null;
  var gateUser = null;
  var gatePass = null;
  var gateYear = null;
  var gateSem = null;
  var gateErr = null;
  var gateSubmit = null;
  var gateBusy = false;

  /* turnstile (human check): script loaded once + promise-cached; the widget
     is re-rendered each time the gate shows (its mount dies with the markup) */
  var tsPromise = null;
  var tsWidget = null;
  var tsMounting = false;
  var tsFailed = false; // widget error-callback fired (async — outside any try/catch)

  function gateMarkup() {
    return '' +
      '<div class="auth-overlay">' +
        '<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="tt-auth-title">' +
          '<div class="auth-brand">' +
            '<span class="brand-tile" aria-hidden="true">kl</span>' +
            '<span class="brand-word">timetable<span class="pdot">.</span></span>' +
          '</div>' +
          '<h2 class="auth-title" id="tt-auth-title">your week, live<span class="pdot">.</span></h2>' +
          '<p class="auth-sub">sign in with your KL ERP login — we pull your class timetable ' +
            'straight from the portal. creds stay on this device.</p>' +
          '<form id="tt-auth-form" class="auth-form" novalidate>' +
            '<label class="sr-only" for="tt-auth-user">university id</label>' +
            '<input id="tt-auth-user" class="auth-input auth-mono" type="text"' +
              ' placeholder="university id · 26XXXXXXXX" autocomplete="username"' +
              ' inputmode="numeric" spellcheck="false" autocapitalize="none">' +
            '<label class="sr-only" for="tt-auth-pass">password</label>' +
            '<input id="tt-auth-pass" class="auth-input" type="password"' +
              ' placeholder="password" autocomplete="current-password">' +
            '<div class="auth-fields">' +
              '<label class="sr-only" for="tt-auth-year">academic year</label>' +
              '<select id="tt-auth-year" class="auth-select" aria-label="academic year">' +
                '<option value="29" selected>2026-27</option>' +
                '<option value="28">2025-26</option>' +
                '<option value="27">2024-25</option>' +
              '</select>' +
              '<label class="sr-only" for="tt-auth-sem">semester</label>' +
              '<select id="tt-auth-sem" class="auth-select" aria-label="semester">' +
                '<option value="1" selected>Odd</option>' +
                '<option value="2">Even</option>' +
                '<option value="3">Summer</option>' +
              '</select>' +
            '</div>' +
            // turnstile mount — .sync-ts (css/sync.css) centers it + reserves its 65px height
            '<div id="tt-auth-ts" class="sync-ts" role="group" aria-label="human verification"></div>' +
            '<p class="auth-err hidden" role="alert"></p>' +
            '<button type="submit" class="btn btn-acc btn-block">' + SUBMIT_LABEL + '</button>' +
          '</form>' +
          '<button type="button" class="auth-demo">just look around (demo)</button>' +
        '</div>' +
      '</div>';
  }

  /* Page chrome behind the gate overlay — removed from the a11y tree (and
     from focus, where inert is supported) while the aria-modal gate owns the
     screen. #tt-toasts stays reachable so errors can still surface. */
  var BG_SEL = '.topbar, .bento-grid, .footer';

  function setBackgroundHidden(on) {
    var els = document.querySelectorAll(BG_SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (on) {
        el.setAttribute('aria-hidden', 'true');
        if ('inert' in el) el.inert = true;
      } else {
        el.removeAttribute('aria-hidden');
        if ('inert' in el) el.inert = false;
      }
    }
  }

  function showGate() {
    if (!root) return;
    root.innerHTML = gateMarkup();
    root.classList.remove('hidden');
    gateForm = document.getElementById('tt-auth-form');
    gateUser = document.getElementById('tt-auth-user');
    gatePass = document.getElementById('tt-auth-pass');
    gateYear = document.getElementById('tt-auth-year');
    gateSem = document.getElementById('tt-auth-sem');
    gateErr = root.querySelector('.auth-err');
    gateSubmit = gateForm ? gateForm.querySelector('button[type="submit"]') : null;
    if (gateForm) gateForm.addEventListener('submit', onGateSubmit);
    var demoBtn = root.querySelector('.auth-demo');
    if (demoBtn) demoBtn.addEventListener('click', onDemoEnter);
    icons();
    mountTs(); // async — widget pops in under the selects once the script lands
    if (document.body) document.body.style.overflow = 'hidden'; // page reloads to leave the gate
    setBackgroundHidden(true);
    /* no autofocus on touch devices: focusing this sub-16px input on load
       triggers iOS auto-zoom and pops the keyboard over the gate */
    var coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); } catch (e) { /* noop */ }
    if (gateUser && !coarse) gateUser.focus();
  }

  function hideGate() {
    if (!root) return;
    root.classList.add('hidden');
    root.innerHTML = ''; // keep the mount empty when signed in / in demo
    gateForm = gateUser = gatePass = gateYear = gateSem = gateErr = gateSubmit = null;
    gateBusy = false;
    tsWidget = null; // the widget's iframe died with the markup — re-render on next show
    tsFailed = false;
    setBackgroundHidden(false);
  }

  function setGateBusy(on) {
    gateBusy = on;
    [gateUser, gatePass, gateYear, gateSem].forEach(function (el) {
      if (el) el.disabled = on;
    });
    if (gateSubmit) {
      gateSubmit.disabled = on;
      gateSubmit.textContent = on ? BUSY_LABEL : SUBMIT_LABEL;
    }
  }

  function showGateErr(msg) {
    if (!gateErr) return;
    gateErr.textContent = msg; // escaped — never innerHTML
    gateErr.classList.remove('hidden');
  }

  function hideGateErr() {
    if (!gateErr) return;
    gateErr.textContent = '';
    gateErr.classList.add('hidden');
  }

  /* ---------------- turnstile (load once, promise-cached) ---------------- */

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsPromise) return tsPromise;
    tsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () {
        if (window.turnstile) resolve(window.turnstile);
        else { tsPromise = null; reject(new Error('turnstile missing')); }
      };
      s.onerror = function () { tsPromise = null; reject(new Error('turnstile load failed')); };
      document.head.appendChild(s);
    });
    return tsPromise;
  }

  function resetTs() {
    if (tsWidget == null || !window.turnstile) return;
    try { window.turnstile.reset(tsWidget); } catch (e) { /* widget gone */ }
  }

  function mountTs() {
    if (!root || root.classList.contains('hidden')) return;
    var mount = root.querySelector('#tt-auth-ts');
    if (!mount) return;
    if (tsWidget != null) { resetTs(); return; } // already rendered → fresh challenge
    if (tsMounting) return;
    tsMounting = true;
    loadTurnstile().then(function (ts) {
      tsMounting = false;
      if (tsWidget != null) return;
      // re-query: the gate may have hidden or rebuilt its markup mid-load
      if (!root || root.classList.contains('hidden')) return;
      var fresh = root.querySelector('#tt-auth-ts');
      if (!fresh) return;
      try {
        tsFailed = false;
        tsWidget = ts.render(fresh, {
          sitekey: TS_SITEKEY,
          theme: 'dark',
          // widget failures are async (e.g. error 110200 = untrusted domain
          // on localhost) — they never reach this try/catch, surface in-app.
          // Submit stays clickable meanwhile; it just errors (see onGateSubmit).
          'error-callback': function () {
            tsFailed = true;
            showGateErr('human check failed to load — try again on the live site');
          }
        });
      } catch (e) {
        tsFailed = true;
        showGateErr('human check failed to load — try again on the live site');
      }
    }).catch(function () {
      tsMounting = false;
      tsFailed = true;
      showGateErr('human check failed to load — try again on the live site');
    });
  }

  /* ---------------- buddy-api login (doubles as the sync login) ---------------- */

  /* /login failure → gate copy: 401/403 = bad creds or a rejected turnstile
   * token (same siteverify gate the sync modal has), 5xx/network/timeout =
   * the api itself is down. Other statuses pass a short server detail through. */
  function loginErr(status, detail) {
    var msg;
    if (status === 401 || status === 403) msg = 'wrong id or password? or failed the human check — retry';
    else if (!status || status >= 500) msg = 'api unreachable — try later';
    else if (typeof detail === 'string' && detail && detail.length <= 140) msg = detail;
    else msg = 'login failed — try again';
    var err = new Error(msg);
    err.status = status;
    return err;
  }

  /* POST /login (form: username, password, turnstile_token) → parsed json
   * { success, profile, app_token, cookies }. Rejects only with friendly
   * Errors carrying .status (0 = network/timeout). */
  function apiLogin(user, pass, tsToken) {
    var body = 'username=' + encodeURIComponent(user) +
      '&password=' + encodeURIComponent(pass) +
      '&turnstile_token=' + encodeURIComponent(tsToken || '');
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var killer = ctrl
      ? setTimeout(function () { try { ctrl.abort(); } catch (e) { /* noop */ } }, LOGIN_TIMEOUT)
      : null;
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    };
    if (ctrl) opts.signal = ctrl.signal;

    function done() { if (killer) clearTimeout(killer); }

    return fetch(LOGIN_URL, opts).then(function (res) {
      return res.json()
        .catch(function () { return null; }) // non-json error pages still map by status
        .then(function (data) {
          done();
          if (!res.ok) throw loginErr(res.status, data && data.detail);
          if (!data || data.success === false || !data.app_token) {
            throw loginErr(res.status, data && data.detail);
          }
          return data;
        });
    }, function (e) {
      done();
      throw loginErr(0); // TypeError (network) and AbortError (timeout) read the same
    });
  }

  /* ERP session cookies from /login → the session shape TT.erp.fetchTimetable
     can pass through to /fetch-timetable (skips the second server-side ERP
     login when erp.js supports it). */
  function sessionFrom(cookies) {
    var c = cookies && typeof cookies === 'object' ? cookies : {};
    return {
      php_sess_id: c.PHPSESSID || '',
      csrf_cookie: c._csrf || c._csrf_token || '',
      device_id: c.kl_erp_device_id || '',
      server_id: c.SERVERID || ''
    };
  }

  function onGateSubmit(e) {
    e.preventDefault();
    if (gateBusy) return;
    var u = gateUser && gateUser.value ? gateUser.value.trim() : '';
    var p = gatePass && gatePass.value ? gatePass.value : '';
    if (!u || !p) { showGateErr('enter your university id and password'); return; }
    var api = erp();
    if (!api) { showGateErr('erp module not loaded — reload and try again'); return; }
    var year = gateYear && gateYear.value ? gateYear.value : '29';
    var sem = gateSem && gateSem.value ? gateSem.value : '1';
    var tsToken = '';
    if (window.turnstile && tsWidget != null) {
      try { tsToken = window.turnstile.getResponse(tsWidget) || ''; } catch (e2) { tsToken = ''; }
    }
    if (!tsToken) {
      showGateErr(tsFailed
        ? 'human check failed to load — try again on the live site'
        : 'finish the human check first');
      return;
    }
    hideGateErr();
    setGateBusy(true);
    apiLogin(u, p, tsToken).then(function (data) {
      // erp.js today takes (user, pass, year, sem) and ignores this 5th arg —
      // the second ERP login then just happens server-side (acceptable). A
      // session-aware erp.js picks the cookies up and skips that login.
      return api.fetchTimetable(u, p, year, sem, sessionFrom(data.cookies)).then(function (tt) {
        var prof = data.profile;
        // terminal on success: signIn stores creds + sync token + timetable,
        // then reloads (core/sync.js adopts the token from the cred blob on
        // boot). false = storage refused the identity write (signIn already
        // surfaced the gate error) — re-enable so the user can fix and retry.
        var ok = profile.signIn({
          id: u,
          name: prof && prof.name ? String(prof.name) : u,
          password: p,
          year: year,
          sem: sem,
          timetable: tt,
          token: String(data.app_token)
        });
        if (ok === false) setGateBusy(false);
      });
    }).catch(function (err) {
      // login failed — or the timetable fetch failed AFTER a good login;
      // either way nothing was stored. The turnstile token is spent, so the
      // widget resets on every failure and the user simply retries.
      setGateBusy(false);
      resetTs();
      showGateErr(errMsg(err));
      if (gatePass) gatePass.focus();
    });
  }

  function onDemoEnter() {
    if (profile && typeof profile.demoEnter === 'function') profile.demoEnter(); // terminal — reloads
  }

  /* ==================== (b) account menu ==================== */

  var menu = null;       // .auth-menu panel (appended to <body>, built lazily)
  var menuOpen = false;
  var refreshing = false;

  function ensureMenu() {
    if (menu) return;
    menu = document.createElement('div');
    menu.className = 'auth-menu hidden';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'account');
    menu.addEventListener('click', onMenuClick);
    document.body.appendChild(menu);
  }

  function buildMenu() {
    ensureMenu();
    var id = meId();
    if (id) {
      menu.innerHTML =
        '<div class="auth-menu-head">' +
          '<i data-lucide="user-round"></i>' +
          '<span class="auth-menu-who">' +
            '<span class="auth-menu-label">signed in as</span>' +
            '<span class="auth-menu-id"></span>' +
          '</span>' +
        '</div>' +
        '<button type="button" class="auth-row" role="menuitem" data-act="sync">' +
          '<i data-lucide="cloud"></i><span class="auth-menu-sync-text">sync…</span></button>' +
        '<button type="button" class="auth-row" role="menuitem" data-act="refresh">' +
          '<i data-lucide="refresh-cw"></i><span>refresh my timetable</span></button>' +
        '<button type="button" class="auth-row" role="menuitem" data-act="switch">' +
          '<i data-lucide="log-out"></i><span>switch account</span></button>' +
        '<button type="button" class="auth-row auth-row-danger" role="menuitem" data-act="wipe">' +
          '<i data-lucide="trash-2"></i><span>wipe my data on this device</span></button>';
      var idEl = menu.querySelector('.auth-menu-id');
      if (idEl) idEl.textContent = id; // user text — textContent only
      updateSyncLine();
    } else {
      menu.innerHTML =
        '<button type="button" class="auth-row" role="menuitem" data-act="signin">' +
          '<i data-lucide="log-in"></i><span>sign in with your ERP</span></button>' +
        '<button type="button" class="auth-row" disabled aria-disabled="true">' +
          '<i data-lucide="user-round"></i><span>you\u2019re viewing demo data</span></button>';
    }
    icons();
  }

  function menuRows() {
    if (!menu) return [];
    return Array.prototype.slice.call(menu.querySelectorAll('.auth-row:not(:disabled)'));
  }

  function positionMenu() {
    if (!menuOpen || !menu || !btn) return;
    var r = btn.getBoundingClientRect();
    var pw = menu.offsetWidth || 230;
    var left = r.right - pw;                    // right-align under the button
    var max = window.innerWidth - pw - 12;
    if (left < 12) left = 12;
    if (left > max) left = Math.max(12, max);
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    menu.style.left = Math.round(left) + 'px';
  }

  function openMenu() {
    buildMenu();
    menu.classList.remove('hidden');
    menuOpen = true;
    positionMenu();
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', positionMenu);
    var rows = menuRows();
    if (rows.length) rows[0].focus(); // menu-button pattern: focus lands inside
  }

  function closeMenu() {
    if (!menuOpen || !menu) return;
    menuOpen = false;
    menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', positionMenu);
    if (btn && menu.contains(document.activeElement)) btn.focus(); // never strand focus
  }

  function onDocClick(e) {
    if (!menu) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    closeMenu();
  }

  function onMenuKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
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

  // live sync status line inside the account menu — the user should never have
  // to guess whether their tasks actually reached the cloud
  function updateSyncLine() {
    if (!menu) return;
    var el = menu.querySelector('.auth-menu-sync-text');
    if (!el) return;
    var s = window.TT && TT.sync;
    if (!s) { el.textContent = 'sync unavailable'; return; }
    var st = s.state;
    if (st === 'ready') {
      var t = '';
      if (s.lastSync) {
        var d = new Date(s.lastSync);
        t = ' · ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      }
      el.textContent = 'synced' + t;
    } else if (st === 'syncing') {
      el.textContent = 'syncing… (first sync can take a minute)';
    } else if (st === 'error') {
      el.textContent = 'sync offline — tap to retry';
    } else {
      el.textContent = 'sync off — tap to connect';
    }
  }
  TT.on('tt:sync-state', function () { if (menuOpen) updateSyncLine(); });

  function onMenuClick(e) {
    var t = e.target;
    var row = t && t.closest ? t.closest('.auth-row[data-act]') : null;
    if (!row || row.disabled) return;
    var act = row.getAttribute('data-act');
    if (act === 'refresh') { doRefresh(row); return; } // stays open — row shows its own loading state
    closeMenu();
    if (act === 'sync') {
      var sb = document.getElementById('tt-sync-btn');
      if (sb) sb.click(); // opens the sync modal (connect / sync now / sign out)
    } else if (act === 'switch') {
      if (profile && typeof profile.signOut === 'function') profile.signOut(); // terminal — reloads
    } else if (act === 'wipe') {
      doWipe();
    } else if (act === 'signin') {
      if (profile && typeof profile.demoExit === 'function') profile.demoExit(); // terminal — reloads into the gate
    }
  }

  function doRefresh(row) {
    if (refreshing) return;
    var id = meId();
    if (!id) return;
    var api = erp();
    if (!api) { toast('erp module not loaded — reload and try again', 'err'); return; }
    var c = creds(id);
    if (!c.pass) { toast('no saved login for this account — switch account and sign in again', 'err'); return; }
    refreshing = true;
    row.classList.add('is-loading');
    row.setAttribute('aria-busy', 'true');
    var label = row.querySelector('span');
    var old = label ? label.textContent : '';
    if (label) label.textContent = BUSY_LABEL;
    api.fetchTimetable(id, c.pass, c.year, c.sem).then(function (tt) {
      // terminal: refreshTimetable stores the fresh timetable, then reloads
      profile.refreshTimetable(tt);
    }).catch(function (err) {
      refreshing = false;
      row.classList.remove('is-loading');
      row.removeAttribute('aria-busy');
      if (label) label.textContent = old;
      toast(errMsg(err), 'err');
    });
  }

  function doWipe() {
    var id = meId();
    var who = id ? ' for ' + id : '';
    var ok = window.confirm(
      'wipe all timetable data' + who + ' on this device?\n\n' +
      'this removes the saved login, timetable, tasks, plans and prefs stored here. this cannot be undone.'
    );
    if (ok && profile && typeof profile.wipeUser === 'function') profile.wipeUser(); // terminal — reloads
  }

  function onBtnClick(e) {
    e.stopPropagation();
    if (menuOpen) closeMenu(); else openMenu();
  }

  /* ---------------- init ---------------- */

  function init() {
    // profile core missing → auth stays inert: gate hidden+empty, no menu
    if (!profile || typeof profile.current !== 'function') {
      hideGate();
      return;
    }
    var id = meId();
    if (id || demoFlag()) hideGate();
    else showGate();
    if (btn) {
      btn.classList.toggle('is-on', !!id);
      btn.setAttribute('aria-haspopup', 'menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', onBtnClick);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
