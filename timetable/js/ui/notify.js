/* notify.js — toasts + class/task-start reminders.
 * Toasts: 'tt:toast' ({msg, type?}) → .toast in #tt-toasts ('err' → .err),
 * max 3 (drop oldest), click dismiss, auto-dismiss 3.5s (opacity fade → remove).
 * Reminders: #tt-remind-btn toggles pref 'remind' (default off) with .is-on +
 * bell/bell-ring swap; when granted, 'tt:tick' (minute-throttled) fires a
 * Notification + toast 10 min before TT.util.nextClass, and for today's timed
 * tasks (TT.tasks: day === today && start): 5 min ahead ('task: … in 5 min'),
 * at the exact start ('task: … starting now') and, when task.end exists, at the
 * exact end ('wrap up: … ended') — once each per day, deduped in a daily-reset
 * Set ('day|start' classes, 't:<id>|<time>:pre|:start|:end' task keys). */
(() => {
  'use strict';

  const TT = window.TT; // created by core/store.js (loaded first)
  if (!TT || !TT.on || !TT.emit || !TT.prefs) return;

  /* ================= toasts ================= */

  const TOAST_MS = 3500;  // visible time before fade starts
  const FADE_MS = 320;    // opacity fade before removal
  const MAX_TOASTS = 3;

  const toastBox = document.getElementById('tt-toasts');

  const dismissToast = (el) => {
    if (!el || el._out) return; // idempotent: auto-timer and click can race
    el._out = true;
    // components.css gives .toast no opacity transition, so set one inline —
    // guarantees the contracted fade regardless of stylesheet internals.
    el.style.transition = 'opacity .3s var(--ease)';
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), FADE_MS);
  };

  const pushToast = (detail) => {
    if (!toastBox || !detail || !detail.msg) return;
    while (toastBox.children.length >= MAX_TOASTS) {
      const oldest = toastBox.firstElementChild; // oldest = first (stack grows down)
      if (!oldest) break;
      oldest.remove();
    }
    const el = document.createElement('div');
    el.className = 'toast' + (detail.type === 'err' ? ' err' : '');
    el.setAttribute('role', 'status');
    el.textContent = String(detail.msg); // textContent, never innerHTML
    el.addEventListener('click', () => dismissToast(el));
    toastBox.appendChild(el);
    window.setTimeout(() => dismissToast(el), TOAST_MS);
  };

  TT.on('tt:toast', pushToast);

  const toast = (msg, type) => TT.emit('tt:toast', type ? { msg, type } : { msg });

  /* ================= reminders ================= */

  const PREF_KEY = 'remind';
  const AHEAD_MIN = 10;      // classes: warn this many minutes before start
  const TASK_AHEAD_MIN = 5;  // timed tasks: tighter window, they're short-fuse

  const btn = document.getElementById('tt-remind-btn');
  const supported = () => typeof window.Notification !== 'undefined';

  let on = TT.prefs.get(PREF_KEY, false) === true;
  const notified = new Set(); // 'day|start' keys already alerted
  let notifiedDay = null;     // day stamp `notified` belongs to (reset daily)
  let lastMinute = -1;        // minute-granularity throttle for 'tt:tick'

  const renderBtn = () => {
    if (!btn) return;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('data-tip', on ? 'reminders on' : 'remind me 10 min before class');
    btn.innerHTML = '<i data-lucide="' + (on ? 'bell-ring' : 'bell') + '"></i>';
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  };

  const setOn = (v) => {
    on = !!v;
    TT.prefs.set(PREF_KEY, on);
    renderBtn();
  };

  // Promise-based in modern browsers, legacy callback in old Safari — settle once.
  const requestPerm = (cb) => {
    let settled = false;
    const done = (perm) => {
      if (settled) return;
      settled = true;
      cb(perm || Notification.permission);
    };
    try {
      const p = Notification.requestPermission(done);
      if (p && typeof p.then === 'function') p.then(done, () => done(Notification.permission));
    } catch (e) {
      done('denied');
    }
  };

  const blocked = () => {
    setOn(false);
    toast('notifications blocked — reminders off', 'err');
  };

  const enable = () => {
    if (!supported()) { toast('not supported here', 'err'); return; }
    if (Notification.permission === 'granted') { setOn(true); return; }
    if (Notification.permission === 'denied') { blocked(); return; }
    requestPerm((perm) => { if (perm === 'granted') setOn(true); else blocked(); });
  };

  const fireReminder = (nxt) => {
    const cls = nxt.cls || {};
    const code = String(cls.course || 'CLASS') + '-' + String(cls.type || '?').charAt(0);
    const title = code + ' in 10 min';
    const body = 'Room ' + (cls.room || '?') + ' · ' + (cls.section || '');
    try {
      new Notification(title, { body }); // eslint-disable-line no-new
      toast(title + ' — ' + body);
    } catch (e) {
      blocked(); // constructor threw (revoked mid-session, insecure ctx) → revert
    }
  };

  // the dedupe Set belongs to one calendar day — clear it when the day flips
  const resetDaily = (now) => {
    const stamp = (TT.util && typeof TT.util.todayKey === 'function')
      ? TT.util.todayKey()
      : now.toDateString();
    if (stamp !== notifiedDay) { notified.clear(); notifiedDay = stamp; }
  };

  const checkReminder = (now) => {
    if (!TT.dataReady || !TT.util || typeof TT.util.nextClass !== 'function') return;
    resetDaily(now);
    const nxt = TT.util.nextClass(now);
    if (!nxt || !nxt.cls) return;
    if (nxt.startsInMin < 0 || nxt.startsInMin > AHEAD_MIN) return;
    const key = nxt.day + '|' + nxt.cls.start;
    if (notified.has(key)) return;
    notified.add(key);
    fireReminder(nxt);
  };

  const fireTaskReminder = (text) => {
    try {
      new Notification(text); // eslint-disable-line no-new
      toast(text);
    } catch (e) {
      blocked(); // constructor threw (revoked mid-session, insecure ctx) → revert
    }
  };

  // dedupe guard: one alert per key per day (Set resets daily in resetDaily)
  const notifyTaskOnce = (key, text) => {
    if (notified.has(key)) return;
    notified.add(key);
    fireTaskReminder(text);
  };

  // timed tasks (day + start) due today get the same treatment as classes —
  // a heads-up window plus exact start/end pings. keys carry :pre/:start/:end
  // suffixes so the three never collide, and a 't:' prefix vs. class keys.
  const checkTaskReminders = (now) => {
    if (!TT.tasks || typeof TT.tasks.list !== 'function') return;
    if (!TT.util || typeof TT.util.todayKey !== 'function') return;
    const today = TT.util.todayKey();
    if (!today) return;
    resetDaily(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let list;
    try { list = TT.tasks.list(); } catch (e) { return; }
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t.done || t.day !== today || !t.start) continue;
      const title = String(t.title || '(untitled)');
      const startMin = typeof TT.util.mins === 'function' ? TT.util.mins(t.start) : NaN;
      if (!isFinite(startMin)) continue;
      const inMin = startMin - nowMin;
      // heads-up: strictly ahead of the start minute (0 belongs to 'starting now')
      if (inMin >= 1 && inMin <= TASK_AHEAD_MIN) {
        notifyTaskOnce('t:' + String(t.id) + '|' + String(t.start) + ':pre',
          'task: ' + title + ' in 5 min');
      }
      // exact start — minute-throttled ticks evaluate this minute exactly once
      if (nowMin === startMin) {
        notifyTaskOnce('t:' + String(t.id) + '|' + String(t.start) + ':start',
          'task: ' + title + ' starting now');
      }
      // exact end, when the task is a time range (v5: end > start, or null)
      if (t.end) {
        const endMin = typeof TT.util.mins === 'function' ? TT.util.mins(t.end) : NaN;
        if (isFinite(endMin) && nowMin === endMin) {
          notifyTaskOnce('t:' + String(t.id) + '|' + String(t.end) + ':end',
            'wrap up: ' + title + ' ended');
        }
      }
    }
  };

  TT.on('tt:tick', (now) => {
    if (!on) return;
    if (!supported() || Notification.permission !== 'granted') return;
    if (!(now instanceof Date)) now = new Date();
    const minute = Math.floor(now.getTime() / 60000);
    if (minute === lastMinute) return; // 1s ticks → evaluate once per minute
    lastMinute = minute;
    checkReminder(now);
    checkTaskReminders(now);
  });

  if (btn) btn.addEventListener('click', () => { if (on) setOn(false); else enable(); });

  /* init: silently revert a stale 'on' pref that can no longer work,
   * then paint the button to match the stored state. */
  if (on && (!supported() || Notification.permission === 'denied')) {
    on = false;
    TT.prefs.set(PREF_KEY, false);
  }
  renderBtn();
})();
