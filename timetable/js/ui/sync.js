/* ============================================================
   Timetable v3 — Cloud Sync UI
   Owns: #tt-sync-btn (topbar state) + #tt-sync-modal (built here).
   Two states: signed out (ERP login form + Turnstile) / signed in
   (status, sync now, sign out). Driven by TT.sync (core/sync.js);
   re-renders on 'tt:sync-state'. Never auto-opens.
   The welcome gate (ui/auth.js) already performs this same /login —
   its app_token lands in the user's cred blob and core/sync adopts it
   on boot, so this modal usually opens straight into the signed-in
   view; a hint line covers the rare divergence (gate token stored,
   sync core still 'off').
   ============================================================ */
(function () {
  'use strict';

  const TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const TS_SITEKEY = '0x4AAAAAACvzvtywbMlUWN05';

  let root = null;      // #tt-sync-modal
  let btn = null;       // #tt-sync-btn
  let overlay = null;   // .sync-overlay
  let viewOut = null;   // signed-out view
  let viewIn = null;    // signed-in view
  let form = null;
  let userInput = null;
  let passInput = null;
  let errEl = null;
  let submitBtn = null;
  let lastEl = null;    // 'last sync …' line
  let nowBtn = null;
  let outBtn = null;
  let hintEl = null;    // gate-token divergence hint (signed-out view only)

  let isOpen = false;
  let busy = false;     // local op in flight (sign in / sync now)
  let lastFocus = null; // element to refocus on close
  let curView = null;   // 'in' | 'out' — which card view is showing

  let tsPromise = null; // promise-cached script load
  let tsWidget = null;  // rendered widget id (null = not rendered)
  let tsMounting = false;
  let tsFailed = false; // widget raised error-callback (async — outside try/catch)

  const TT = () => window.TT;

  /* ---------------- core bridge (defensive — core/sync.js may be 'off') ---------------- */

  function syncApi() {
    const tt = TT();
    const s = tt && tt.sync;
    return (s && s !== 'off' && typeof s === 'object') ? s : null;
  }

  /* Normalize whatever shape core reports → 'on' | 'syncing' | 'out'. */
  function syncStatus(s) {
    let st = s.state != null ? s.state : s.status;
    if (typeof st === 'function') { try { st = st.call(s); } catch (e) { st = null; } }
    if (st && typeof st === 'object') st = st.state != null ? st.state : st.status;
    st = typeof st === 'string' ? st.toLowerCase() : '';
    if (s.syncing === true || s.busy === true ||
        st === 'syncing' || st === 'busy' || st === 'pushing' || st === 'pulling') return 'syncing';
    if (st === 'on' || st === 'in' || st === 'signed-in' || st === 'synced' ||
        st === 'idle' || st === 'ready' || st === 'error') return 'on';
    if (st === 'off' || st === 'out' || st === 'signed-out' || st === 'anon') return 'out';
    if (typeof s.enabled === 'boolean') return s.enabled ? 'on' : 'out';
    if (typeof s.signedIn === 'boolean') return s.signedIn ? 'on' : 'out';
    if (s.token) return 'on';
    return 'out';
  }

  function lastSyncOf(s) {
    let v = s.lastSync;
    if (typeof v === 'function') { try { v = v.call(s); } catch (e) { v = null; } }
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : d; // pre-formatted string passes through
    }
    return null;
  }

  function fmtLast(v) {
    if (!v) return 'not synced yet';
    if (typeof v === 'string') return 'last sync ' + v;
    const hh = String(v.getHours()).padStart(2, '0');
    const mm = String(v.getMinutes()).padStart(2, '0');
    return 'last sync ' + hh + ':' + mm;
  }

  function toast(msg, type) {
    const tt = TT();
    if (tt && typeof tt.emit === 'function') {
      tt.emit('tt:toast', type ? { msg, type } : { msg });
    }
  }

  /* ---------------- markup ---------------- */

  function build() {
    root.innerHTML =
      '<div class="sync-overlay">' +
        '<div class="sync-card" role="dialog" aria-modal="true" aria-labelledby="tt-sync-title">' +
          '<button type="button" class="icon-btn sync-x" aria-label="Close">' +
            '<i data-lucide="x"></i>' +
          '</button>' +

          '<div class="sync-view-out">' +
            '<div class="eyebrow">cloud sync</div>' +
            '<h2 class="sync-title" id="tt-sync-title">sync your shit.</h2>' +
            '<p class="sync-sub">tasks &amp; study blocks, backed up to your account. ' +
              'sign in with your ERP login once — token lives 30 days on this device.</p>' +
            '<form id="tt-sync-form" novalidate>' +
              '<label class="sr-only" for="tt-sync-user">university id</label>' +
              '<input id="tt-sync-user" class="sync-input sync-mono" type="text"' +
                ' placeholder="university id" autocomplete="username"' +
                ' spellcheck="false" autocapitalize="none">' +
              '<label class="sr-only" for="tt-sync-pass">password</label>' +
              '<input id="tt-sync-pass" class="sync-input" type="password"' +
                ' placeholder="password" autocomplete="current-password">' +
              '<div id="tt-sync-ts" class="sync-ts" role="group" aria-label="human verification"></div>' +
              '<div class="sync-err hidden" role="alert"></div>' +
              '<button type="submit" class="btn btn-acc sync-submit">sign in &amp; sync</button>' +
            '</form>' +
            // shown only when the gate stored a sync token but core is still 'off'
            '<p class="sync-sub sync-gate-hint hidden"></p>' +
          '</div>' +

          '<div class="sync-view-in hidden">' +
            '<div class="sync-state-ic"><i data-lucide="cloud-check"></i></div>' +
            '<h2 class="sync-title">sync on.</h2>' +
            '<p class="sync-last"></p>' +
            '<div class="sync-actions">' +
              '<button type="button" class="btn btn-ghost" data-sync="now">sync now</button>' +
              '<button type="button" class="btn btn-ghost sync-danger" data-sync="out">sign out</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    overlay = root.querySelector('.sync-overlay');
    viewOut = root.querySelector('.sync-view-out');
    viewIn = root.querySelector('.sync-view-in');
    form = root.querySelector('#tt-sync-form');
    userInput = root.querySelector('#tt-sync-user');
    passInput = root.querySelector('#tt-sync-pass');
    errEl = root.querySelector('.sync-err');
    submitBtn = root.querySelector('.sync-submit');
    lastEl = root.querySelector('.sync-last');
    nowBtn = root.querySelector('[data-sync="now"]');
    outBtn = root.querySelector('[data-sync="out"]');
    hintEl = root.querySelector('.sync-gate-hint');

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
    // graceful fallback if this lucide build lacks 'cloud-check'
    const stale = root.querySelector('i[data-lucide="cloud-check"]');
    if (stale && !root.querySelector('.sync-state-ic svg')) {
      stale.setAttribute('data-lucide', 'check');
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    }
  }

  /* ---------------- turnstile (load once, promise-cached) ---------------- */

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (tsPromise) return tsPromise;
    tsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else { tsPromise = null; reject(new Error('turnstile missing')); }
      };
      s.onerror = () => { tsPromise = null; reject(new Error('turnstile load failed')); };
      document.head.appendChild(s);
    });
    return tsPromise;
  }

  function resetTs() {
    if (tsWidget == null || !window.turnstile) return;
    try { window.turnstile.reset(tsWidget); } catch (e) { /* widget gone */ }
  }

  function mountTs() {
    const mount = root && root.querySelector('#tt-sync-ts');
    if (!mount) return;
    if (tsWidget != null) { resetTs(); return; } // already rendered → fresh challenge
    if (tsMounting) return;
    tsMounting = true;
    loadTurnstile().then((ts) => {
      tsMounting = false;
      if (!isOpen || tsWidget != null) return;
      try {
        tsFailed = false;
        tsWidget = ts.render(mount, {
          sitekey: TS_SITEKEY,
          theme: 'dark',
          // widget failures are async (e.g. error 110200 = untrusted domain
          // on localhost) — they never reach this try/catch, surface in-app
          'error-callback': () => {
            tsFailed = true;
            showErr('human check failed to load — try again on the live site');
          },
        });
      } catch (e) {
        tsFailed = true;
        showErr('human check failed to load — reopen the modal');
      }
    }).catch(() => {
      tsMounting = false;
      if (isOpen) showErr('couldn\'t load the human check — network?');
    });
  }

  /* ---------------- error line ---------------- */

  function showErr(msg) {
    if (!errEl) return;
    errEl.textContent = String(msg);
    errEl.classList.remove('hidden');
  }

  function hideErr() {
    if (!errEl) return;
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  function errMsg(e) {
    const st = e && (e.status != null ? e.status : e.code);
    const msg = String((e && e.message) || e || '');
    if (st === 401 || st === 403 || /\b(401|403)\b/.test(msg)) {
      return 'login failed — check id/password';
    }
    if ((e && e.name === 'TypeError') ||
        /failed to fetch|network|unreachable|timeout|timed out|abort/i.test(msg)) {
      return 'api unreachable — try later';
    }
    return 'sync failed — try again';
  }

  /* ---------------- render ---------------- */

  function paintBtn() {
    if (!btn) return;
    const s = syncApi();
    const st = s ? syncStatus(s) : 'off';
    const on = st === 'on' || st === 'syncing';
    const spinning = busy || st === 'syncing';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const svg = btn.querySelector('svg');
    if (svg) svg.classList.toggle('sync-spin', spinning);
    const ic = btn.querySelector('i[data-lucide]'); // pre-lucide fallback
    if (ic) ic.classList.toggle('sync-spin', spinning);
  }

  /* Gate sign-in already stored a sync app_token in the user's cred blob
     (core/profile.js tokenFor). When sync core still reads 'off' that's a
     rare divergence (adoption normally happens at boot) — surface it
     instead of asking for a login that's already done. '' = no hint. */
  function gateTokenHint() {
    const tt = TT();
    const p = tt && tt.profile;
    if (!p || typeof p.tokenFor !== 'function' || typeof p.current !== 'function') return '';
    try {
      const id = p.current();
      if (!id) return '';
      return p.tokenFor(id) ? 'signed in on the gate? sync was already connected there.' : '';
    } catch (e) { return ''; }
  }

  function render() {
    paintBtn();
    if (!isOpen || !root) return;
    const s = syncApi();
    const st = s ? syncStatus(s) : 'off';
    const signedIn = st === 'on' || st === 'syncing';
    const view = signedIn ? 'in' : 'out';
    if (view !== curView) {
      // view flip only — a bare state event must not wipe a filled form
      // or reset a completed turnstile challenge
      curView = view;
      if (viewOut) viewOut.classList.toggle('hidden', signedIn);
      if (viewIn) viewIn.classList.toggle('hidden', !signedIn);
      if (!signedIn) {
        hideErr();
        mountTs();
      }
    }
    if (signedIn && lastEl) lastEl.textContent = fmtLast(s ? lastSyncOf(s) : null);
    if (hintEl) {
      // evaluated every render, not just on flips — adoption mid-modal kills it
      const hint = (!signedIn && s) ? gateTokenHint() : '';
      hintEl.textContent = hint; // escaped — never innerHTML
      hintEl.classList.toggle('hidden', !hint);
    }
  }

  /* ---------------- open / close ---------------- */

  function open() {
    if (!root || isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    curView = null; // force view re-eval → fresh turnstile challenge per open
    root.classList.remove('hidden');
    render();
    const s = syncApi();
    const st = s ? syncStatus(s) : 'off';
    const signedIn = st === 'on' || st === 'syncing';
    // signed into the page already? prefill that id — password + turnstile
    // are still required, and a hand-typed id is never overwritten
    const tt = TT();
    const u = tt && tt.user;
    const prefilled = !signedIn && !!(u && u.id) && userInput && !userInput.value;
    if (prefilled) userInput.value = String(u.id);
    const target = signedIn ? nowBtn : (prefilled ? passInput : userInput);
    setTimeout(() => { if (target && typeof target.focus === 'function') target.focus(); }, 0);
  }

  function close() {
    if (!root || !isOpen) return;
    isOpen = false;
    root.classList.add('hidden');
    hideErr();
    setLoading(false);
    setNowLoading(false);
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function toggle() { if (isOpen) close(); else open(); }

  /* ---------------- loading states ---------------- */

  function setLoading(on) {
    if (!submitBtn) return;
    submitBtn.disabled = !!on;
    submitBtn.textContent = on ? 'syncing…' : 'sign in & sync';
    if (userInput) userInput.disabled = !!on;
    if (passInput) passInput.disabled = !!on;
  }

  function setNowLoading(on) {
    if (!nowBtn) return;
    nowBtn.disabled = !!on;
    nowBtn.textContent = on ? 'syncing…' : 'sync now';
    if (outBtn) outBtn.disabled = !!on;
  }

  /* ---------------- actions ---------------- */

  async function onSubmit(e) {
    e.preventDefault();
    hideErr();
    const s = syncApi();
    if (!s || typeof s.signIn !== 'function') {
      showErr('sync core offline — reload the app');
      return;
    }
    const user = userInput ? userInput.value.trim() : '';
    const pass = passInput ? passInput.value : '';
    if (!user || !pass) { showErr('need both id & password'); return; }

    let token = '';
    if (window.turnstile && tsWidget != null) {
      try { token = window.turnstile.getResponse(tsWidget) || ''; } catch (e2) { token = ''; }
    }
    if (!token) {
      showErr(tsFailed
        ? 'human check failed to load — try again on the live site'
        : 'finish the human check first');
      return;
    }

    busy = true;
    setLoading(true);
    paintBtn();
    try {
      await s.signIn(user, pass, token);
      if (passInput) passInput.value = '';
      busy = false;
      setLoading(false);
      close();
      toast('synced. your stuff is safe.');
      // timetable account and sync account can legitimately differ — legal,
      // but worth one line so tasks don't land in an unexpected cloud account
      const tt = TT();
      if (tt && tt.user && tt.user.id &&
          String(tt.user.id).toLowerCase() !== user.toLowerCase()) {
        toast('sync account ≠ timetable account', 'warn');
      }
      render();
    } catch (err) {
      busy = false;
      setLoading(false);
      paintBtn();
      showErr(errMsg(err));
      resetTs();
    }
  }

  async function onSyncNow() {
    const s = syncApi();
    if (!s) { toast('sync core offline — reload the app', 'err'); return; }
    busy = true;
    setNowLoading(true);
    paintBtn();
    let ok = true;
    try {
      if (typeof s.pushAll === 'function') await s.pushAll();
      if (typeof s.pullAll === 'function') await s.pullAll();
    } catch (e) {
      ok = false;
    }
    busy = false;
    setNowLoading(false);
    render();
    if (ok) toast('all synced.');
    else toast('sync failed — try later', 'err');
  }

  async function onSignOut() {
    const s = syncApi();
    try {
      if (s && typeof s.signOut === 'function') await s.signOut();
    } catch (e) { /* sign out locally regardless */ }
    if (passInput) passInput.value = '';
    render();
    toast('signed out — stuff stays on this device');
  }

  /* ---------------- events ---------------- */

  /* focusable elements currently visible inside the dialog card */
  function focusables(card) {
    const sel = 'a[href], button, input, select, textarea, iframe, [tabindex]';
    return Array.prototype.slice.call(card.querySelectorAll(sel)).filter((el) => {
      if (el.disabled || el.getAttribute('tabindex') === '-1') return false;
      return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    });
  }

  function onKey(e) {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // focus trap: aria-modal claims the background is inert — make that true
    // for keyboards by cycling Tab/Shift+Tab within the card
    const card = root && root.querySelector('.sync-card');
    if (!card) return;
    const els = focusables(card);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0];
    const last = els[els.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey) {
      if (cur === first || !card.contains(cur)) { e.preventDefault(); last.focus(); }
    } else if (cur === last || !card.contains(cur)) {
      e.preventDefault();
      first.focus();
    }
  }

  function bind() {
    if (btn) btn.addEventListener('click', toggle);
    if (overlay) {
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    }
    const x = root.querySelector('.sync-x');
    if (x) x.addEventListener('click', close);
    if (form) form.addEventListener('submit', onSubmit);
    if (nowBtn) nowBtn.addEventListener('click', onSyncNow);
    if (outBtn) outBtn.addEventListener('click', onSignOut);
    document.addEventListener('keydown', onKey);

    const tt = TT();
    if (tt && typeof tt.on === 'function') {
      tt.on('tt:sync-state', render);
    }
  }

  /* ---------------- init ---------------- */

  function init() {
    root = document.getElementById('tt-sync-modal');
    btn = document.getElementById('tt-sync-btn');
    if (!root) return;
    build();
    bind();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
