/* now.js — "right now" card (#tt-now-body).
 * Live: badge + course + meta chips + MM:SS countdown + SVG progress ring.
 * Idle: FREE badge, break message, next-class sub-line.
 * Full re-render only on state transitions; ticks update text node + ring. */
(() => {
  'use strict';

  const RING_C = 175.9; // 2 * pi * 28 (r = 28)
  const TYPE_LABEL = { L: 'lecture', P: 'practical', S: 'skill', T: 'tutorial' };

  let body = null;    // #tt-now-body
  let countEl = null; // .now-count (live state only)
  let ringEl = null;  // .now-ring-prog circle (live state only)
  let subEl = null;   // .now-sub (free state only)
  let lastKey = '';   // state fingerprint — re-render only when it changes
  let lastSub = '';   // last written sub-line — skip same-value per-second writes

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const pad2 = (n) => String(n).padStart(2, '0');
  const secsOf = (d) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

  const weekEmpty = () => {
    const week = (window.TT && TT.data && TT.data.week) || {};
    return Object.keys(week).every((d) => TT.util.classesOn(d).length === 0);
  };

  /* ---------- live state ---------- */

  const liveHTML = (cls) => {
    const c = TT.util.courseOf(cls);
    const chips = [TYPE_LABEL[cls.type] || cls.type, cls.section, cls.room]
      .filter(Boolean)
      .map((t) => `<span class="chip">${esc(t)}</span>`)
      .join('');
    return `
      <div class="now-badge is-live"><span class="now-badge-dot"></span>LIVE</div>
      <div class="now-main">
        <div class="now-course">${esc(cls.course)} — ${esc(c.name)}</div>
        <div class="now-meta">${chips}</div>
        <div class="now-count">ends in --:--</div>
      </div>
      <svg class="now-ring" viewBox="0 0 64 64" style="--c:${esc(c.color)}" aria-hidden="true">
        <circle class="now-ring-track" cx="32" cy="32" r="28"></circle>
        <circle class="now-ring-prog" cx="32" cy="32" r="28"
          stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"></circle>
      </svg>`;
  };

  const updateLive = (now, cls) => {
    const start = TT.util.mins(cls.start) * 60;
    const end = TT.util.mins(cls.end) * 60;
    const dur = Math.max(end - start, 1);
    const t = Math.min(Math.max(secsOf(now) - start, 0), dur);
    const left = Math.max(end - secsOf(now), 0);
    if (countEl) {
      countEl.textContent = `ends in ${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`;
    }
    if (ringEl) {
      ringEl.setAttribute('stroke-dashoffset', (RING_C * (1 - t / dur)).toFixed(1));
    }
  };

  /* ---------- free state ---------- */

  const nextSub = (now) => {
    if (weekEmpty()) {
      return (window.TT && TT.data && TT.data.error)
        ? 'timetable data didn\'t load — check back soon.'
        : 'no classes on the week yet.';
    }
    const nxt = TT.util.nextClass(now);
    if (!nxt) return 'nothing until Monday';
    const tag = esc(nxt.cls.course + (nxt.cls.type ? '-' + nxt.cls.type : ''));
    const room = nxt.cls.room ? ' · ' + esc(nxt.cls.room) : '';
    const minsLeftToday = 24 * 60 - (now.getHours() * 60 + now.getMinutes());
    const isToday = nxt.day === TT.util.todayKey() && nxt.startsInMin < minsLeftToday;
    if (isToday) {
      return `${tag} starts in ${esc(TT.util.hm(nxt.startsInMin))}${room}`;
    }
    return `${tag} · ${esc(TT.util.dayLabel(nxt.day))} ${esc(nxt.cls.start)}${room}`;
  };

  const freeHTML = (now) => `
      <div class="now-badge is-free">FREE</div>
      <div class="now-main">
        <div class="now-idle-msg">no class right now. enjoy the break.</div>
        <div class="now-sub">${nextSub(now)}</div>
      </div>`;

  /* ---------- render ---------- */

  const render = (now) => {
    if (!body || !(now instanceof Date)) return;
    const cls = TT.util.ongoing(now);
    const key = cls
      ? `live:${TT.util.dayKey(now)}:${cls.course}:${cls.start}:${cls.end}`
      : 'free';

    if (key !== lastKey) {
      lastKey = key;
      lastSub = '';
      body.dataset.state = cls ? 'live' : 'free';
      body.innerHTML = cls ? liveHTML(cls) : freeHTML(now); // also wipes skeletons
      countEl = body.querySelector('.now-count');
      ringEl = body.querySelector('.now-ring-prog');
      subEl = body.querySelector('.now-sub');
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    }
    if (cls) updateLive(now, cls);
    else if (subEl) {
      const sub = nextSub(now); // minute-granular string — write only on change
      if (sub !== lastSub) {
        lastSub = sub;
        subEl.textContent = sub; // keep "starts in Xm" fresh
      }
    }
  };

  const boot = () => {
    body = document.getElementById('tt-now-body');
    if (!body || !window.TT || !TT.util) return;
    lastKey = ''; // force first full render
    render(new Date());
    TT.on('tt:tick', render);
  };

  if (window.TT && TT.whenReady) TT.whenReady(boot);
})();
