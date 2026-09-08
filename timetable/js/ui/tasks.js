/* ui/tasks.js — #tt-tasks card: filters, list (active + collapsible done), form, progress ring */
(function () {
  'use strict';

  const TT = window.TT;
  if (!TT || !TT.tasks || !TT.prefs) return;

  const section = document.getElementById('tt-tasks');
  const body = document.getElementById('tt-tasks-body');
  const form = document.getElementById('tt-task-form');
  const input = document.getElementById('tt-task-input');
  const catSel = document.getElementById('tt-task-cat');
  const listEl = document.getElementById('tt-task-list');
  const addBtn = document.getElementById('tt-task-add');
  if (!section || !body || !listEl) return;

  const CATS = { study: '#8b5cf6', class: '#2dd4ff', life: '#ff2d7e' };
  const FILTERS = ['all', 'active', 'done'];
  const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // mon-first, matches the schema whitelist

  let filter = TT.prefs.get('taskFilter', 'all');
  if (FILTERS.indexOf(filter) === -1) filter = 'all';
  let doneOpen = false;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  const icons = () => { if (window.lucide) window.lucide.createIcons(); };

  /* lowercase 3-letter key for today ('mon'…'sun') — core/time.js owns todayKey() */
  const todayKey = () =>
    (TT.util && typeof TT.util.todayKey === 'function' ? TT.util.todayKey() : '');

  /* 0 = today … 5 = five days out in the mon→sat week; sunday/unknown-safe */
  function dayOffset(day, today) {
    const di = WEEK_DAYS.indexOf(day);
    if (di === -1) return WEEK_DAYS.length;
    const ti = WEEK_DAYS.indexOf(today);
    if (ti === -1) return di; // today is sunday — plain week order
    return (di - ti + WEEK_DAYS.length) % WEEK_DAYS.length;
  }

  /* active order: timed-and-today first (by start) → other scheduled (day
     order from today; within a day, timed by start before day-only) →
     untimed (newest first). the done group keeps its own sort in render() */
  function cmpActive(a, b, today) {
    const aTT = !!(a.day && a.start) && a.day === today;
    const bTT = !!(b.day && b.start) && b.day === today;
    if (aTT !== bTT) return aTT ? -1 : 1;
    if (aTT) {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return b.createdAt - a.createdAt;
    }
    if (!!a.day !== !!b.day) return a.day ? -1 : 1;
    if (a.day && b.day) {
      const d = dayOffset(a.day, today) - dayOffset(b.day, today);
      if (d) return d;
      if (!!a.start !== !!b.start) return a.start ? -1 : 1;
      if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    }
    return b.createdAt - a.createdAt;
  }

  /* ---------- filter pills (after the form, before the list) ---------- */
  const filtersEl = document.createElement('div');
  filtersEl.className = 'task-filters';
  filtersEl.innerHTML = FILTERS.map(
    (f) => `<button type="button" class="task-filter" data-filter="${f}">${f}</button>`
  ).join('');
  body.insertBefore(filtersEl, listEl);

  filtersEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.task-filter');
    if (!btn) return;
    filter = btn.dataset.filter;
    TT.prefs.set('taskFilter', filter);
    if (filter === 'done') doneOpen = true;
    render();
  });

  /* ---------- progress ring in .bento-actions ---------- */
  const actions = section.querySelector('.bento-actions');
  let ringFg = null, ringNum = null, ringC = 0;
  if (actions) {
    const r = 8;
    ringC = 2 * Math.PI * r;
    const wrap = document.createElement('div');
    wrap.className = 'task-ring';
    wrap.innerHTML =
      `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">` +
      `<circle cx="11" cy="11" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2.5"/>` +
      `<circle class="task-ring-fg" cx="11" cy="11" r="${r}" fill="none" stroke="var(--acc)" stroke-width="2.5"` +
      ` stroke-linecap="round" stroke-dasharray="${ringC.toFixed(2)}" stroke-dashoffset="${ringC.toFixed(2)}"` +
      ` transform="rotate(-90 11 11)" style="transition:stroke-dashoffset .6s var(--ease)"/>` +
      `</svg>` +
      `<span class="task-ring-num" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums">0/0</span>`;
    actions.prepend(wrap);
    ringFg = wrap.querySelector('.task-ring-fg');
    ringNum = wrap.querySelector('.task-ring-num');
  }

  function renderRing() {
    if (!ringFg || !ringNum) return;
    const c = TT.tasks.counts();
    ringNum.textContent = c.done + '/' + c.total;
    const p = c.total ? c.done / c.total : 0;
    ringFg.style.strokeDashoffset = (ringC * (1 - p)).toFixed(2);
  }

  /* ---------- rows ---------- */
  /* valid range length in minutes (end must be after start) — core enforces
     this on write; stay defensive against legacy or cloud-synced rows where
     'end' never made the trip */
  function rangeMins(t) {
    if (!t.start || !t.end) return 0;
    const d = TT.util.mins(t.end) - TT.util.mins(t.start);
    return d > 0 ? d : 0;
  }

  /* day/time chip before the title: 'wed 14:30' (timed), 'wed 14:30–15:00'
     (range, en-dash) or 'wed' (day only); timed-and-today gets the accent */
  function badge(t) {
    if (!t.day) return '';
    const time = t.start ? (rangeMins(t) ? t.start + '–' + t.end : t.start) : '';
    const label = time ? t.day + ' ' + time : t.day;
    return `<span class="task-badge${t.start && t.day === todayKey() ? ' is-today' : ''}">${esc(label)}</span>`;
  }

  function row(t) {
    const meta = [];
    const range = rangeMins(t);
    if (range) meta.push(esc(TT.util.hm(range)));
    if (t.mins) meta.push(esc(TT.util.hm(t.mins)));
    const pomos = Math.floor(Number(t.pomos)) || 0;
    if (pomos > 0) {
      meta.push(
        `<span class="task-pomo">` +
        `<i data-lucide="timer" class="task-pomo-ic" aria-hidden="true"></i>` +
        `<span class="task-pomo-n">×${pomos}</span></span>`
      );
    }
    const cat = CATS[t.cat] ? t.cat : 'study';
    return (
      `<div class="task-row${t.done ? ' is-done' : ''}" data-id="${esc(t.id)}" data-cat="${cat}">` +
      `<button type="button" class="task-check" aria-label="${t.done ? 'mark active' : 'mark done'}: ${esc(t.title)}">` +
      `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
      `<path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg></button>` +
      `<span class="task-cat-dot" style="background:${CATS[cat]}" aria-hidden="true"></span>` +
      badge(t) +
      `<span class="task-title">${esc(t.title)}</span>` +
      (meta.length ? `<span class="task-meta">${meta.join(' · ')}</span>` : '') +
      `<button type="button" class="task-del" aria-label="delete task"><i data-lucide="x"></i></button>` +
      `</div>`
    );
  }

  /* ---------- render ---------- */
  function render() {
    const tasks = TT.tasks.list();
    const today = todayKey();
    const active = tasks.filter((t) => !t.done).sort((a, b) => cmpActive(a, b, today));
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

    filtersEl.querySelectorAll('.task-filter').forEach((b) => {
      const on = b.dataset.filter === filter;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    let html = '';
    if (!tasks.length) {
      html = `<div class="bento-empty">nothing to do. add something ↑</div>`;
    } else {
      if (filter !== 'done') {
        html += active.length
          ? active.map(row).join('')
          : (filter === 'active' ? `<div class="bento-empty">no active tasks</div>` : '');
      }
      if (filter !== 'active') {
        html += done.length
          ? `<button type="button" class="task-done-head${doneOpen ? ' is-open' : ''}" aria-expanded="${doneOpen}">` +
            `<i data-lucide="chevron-right"></i><span>DONE · ${done.length}</span></button>` +
            `<div class="task-done-list"${doneOpen ? '' : ' hidden'}>${done.map(row).join('')}</div>`
          : (filter === 'done' ? `<div class="bento-empty">nothing done yet</div>` : '');
      }
    }
    listEl.innerHTML = html;
    icons();
    renderRing();
  }

  /* ---------- list interactions (delegated) ---------- */
  listEl.addEventListener('click', (e) => {
    const head = e.target.closest('.task-done-head');
    if (head) {
      doneOpen = !doneOpen;
      render();
      return;
    }
    const rowEl = e.target.closest('.task-row');
    if (!rowEl) return;
    const t = TT.tasks.list().find((x) => String(x.id) === String(rowEl.dataset.id));
    if (!t) return;
    if (e.target.closest('.task-check')) {
      const completing = !t.done;
      TT.tasks.toggle(t.id);
      if (completing) {
        /* keyboard/synthetic clicks carry clientX/Y 0,0 — burst from the
           checkbox instead of the viewport corner; no coords at all →
           confetti.js picks a random spot */
        let pt = null;
        if (e.clientX || e.clientY) {
          pt = { x: e.clientX, y: e.clientY };
        } else {
          const chk = rowEl.querySelector('.task-check');
          const r = chk ? chk.getBoundingClientRect() : null;
          if (r && (r.width || r.height)) pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        TT.emit('tt:celebrate', pt || {});
      }
    } else if (e.target.closest('.task-del')) {
      TT.tasks.remove(t.id);
    }
  });

  /* ---------- form ---------- */
  /* second row (.task-when): optional day select + start–end time range,
     injected after the existing row so the v3 markup stays untouched. native
     dark select on purpose — select.js only enhances #tt-task-cat / #tt-focus-task */
  let daySel = null, timeInp = null, timeEnd = null;
  if (form) {
    const when = document.createElement('div');
    when.className = 'task-when';

    daySel = document.createElement('select');
    daySel.className = 'task-day';
    daySel.id = 'tt-task-day';
    daySel.setAttribute('aria-label', 'Task day (optional)');
    [['', 'no day']].concat(WEEK_DAYS.map((d) => [d, d])).forEach((pair) => {
      const o = document.createElement('option');
      o.value = pair[0];
      o.textContent = pair[1];
      daySel.appendChild(o);
    });
    /* 'no day' reads as a placeholder, not a value */
    const syncDayEmpty = () => daySel.classList.toggle('is-empty', !daySel.value);
    daySel.addEventListener('change', syncDayEmpty);
    syncDayEmpty();

    timeInp = document.createElement('input');
    timeInp.type = 'time';
    timeInp.className = 'task-time';
    timeInp.id = 'tt-task-start';
    timeInp.name = 'tt-task-start';
    timeInp.setAttribute('aria-label', 'Start time (optional)');

    const sep = document.createElement('span');
    sep.className = 'task-when-sep';
    sep.textContent = '–'; // en-dash, mirrors the badge's range format
    sep.setAttribute('aria-hidden', 'true');

    timeEnd = document.createElement('input');
    timeEnd.type = 'time';
    timeEnd.className = 'task-time-end';
    timeEnd.id = 'tt-task-end';
    timeEnd.name = 'tt-task-end';
    timeEnd.setAttribute('aria-label', 'End time (optional)');
    timeEnd.setAttribute('placeholder', '—');

    when.appendChild(daySel);
    when.appendChild(timeInp);
    when.appendChild(sep);
    when.appendChild(timeEnd);
    form.appendChild(when);
  }

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      const start = timeInp && timeInp.value ? timeInp.value : null;
      const end = timeEnd && timeEnd.value ? timeEnd.value : null;
      /* an end without a start is meaningless — refuse instead of guessing */
      if (end && !start) {
        TT.emit('tt:toast', { msg: 'set a start time first', type: 'err' });
        if (timeInp) timeInp.focus();
        return;
      }
      /* inverted range — core would null the end silently; complain instead */
      if (start && end && end <= start) {
        TT.emit('tt:toast', { msg: 'end must be after start', type: 'err' });
        if (timeEnd) timeEnd.focus();
        return;
      }
      TT.tasks.add({
        title: title,
        cat: catSel ? catSel.value : 'study',
        day: daySel && daySel.value ? daySel.value : null,
        start: start,
        end: start ? end : null // start without end → open-ended (end:null)
      });
      input.value = '';
      /* reset the when-row too — silently inheriting the last day/time is
         a worse surprise than re-picking it for a batch */
      if (daySel) { daySel.value = ''; daySel.classList.add('is-empty'); }
      if (timeInp) timeInp.value = '';
      if (timeEnd) timeEnd.value = '';
      input.focus();
    });
  }
  if (addBtn && input) {
    addBtn.addEventListener('click', () => input.focus());
  }

  /* ---------- boot ---------- */
  TT.on('tt:tasks-changed', render);
  /* today-first sort + accent badge go stale across midnight — re-render on day flip */
  let lastDay = todayKey();
  TT.on('tt:tick', () => {
    const d = todayKey();
    if (d !== lastDay) { lastDay = d; render(); }
  });
  render();
})();
