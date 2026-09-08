/* ui/goals.js — #tt-goals card: day/week scope seg, progress bar, checklist,
   add form (cap 12), footer with reset note + day streak.
   Renders off TT.goals (core/goals.js); re-renders on 'tt:goals-changed'.
   Scope pref 'goals.view' is per-user via TT.prefs. Emits nothing global. */
(function () {
  'use strict';

  const TT = window.TT;
  if (!TT || !TT.goals || !TT.prefs) return;

  const section = document.getElementById('tt-goals');
  const seg = document.getElementById('tt-goals-seg');
  const body = document.getElementById('tt-goals-body');
  if (!section || !seg || !body) return;

  const SCOPES = ['day', 'week'];
  const CAP = 12;

  let scope = TT.prefs.get('goals.view', 'day');
  if (SCOPES.indexOf(scope) === -1) scope = 'day';

  const icons = () => { if (window.lucide) window.lucide.createIcons(); };
  const toast = (msg) => TT.emit('tt:toast', { msg: msg });

  /* tiny DOM helper — user text always lands via textContent, never HTML */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* goal text field — contract says add(text, scope); tolerate a parallel
     core build that stored it as .title instead */
  const goalText = (g) => String(g.text != null ? g.text : (g.title != null ? g.title : ''));

  const items = () => TT.goals.items(scope) || [];

  /* ---------- persistent skeleton (form survives re-renders: keeps focus
     and any half-typed goal when the list updates underneath it) ---------- */
  body.innerHTML = '';
  const head = document.createElement('div'); // .goal-progress slot
  const list = el('div', 'goal-list');
  const foot = el('div', 'goal-foot');
  const form = el('form', 'goal-form');
  const input = el('input', 'goal-input');
  input.type = 'text';
  /* shared hook — palette 'new goal' (ui/palette.js) and the 'o' shortcut
     (ui/shortcuts.js) both focus this input via #tt-goal-input */
  input.id = 'tt-goal-input';
  input.setAttribute('aria-label', 'new goal');
  input.autocomplete = 'off';
  const addBtn = el('button', 'btn-acc goal-add');
  addBtn.type = 'submit';
  addBtn.setAttribute('aria-label', 'add goal');
  addBtn.innerHTML = '<i data-lucide="plus"></i>';
  form.appendChild(input);
  form.appendChild(addBtn);
  body.appendChild(head);
  body.appendChild(list);
  body.appendChild(form);
  body.appendChild(foot);

  /* ---------- seg control (today / this week) ---------- */
  function syncSeg() {
    seg.querySelectorAll('button[data-scope]').forEach((b) => {
      const on = b.dataset.scope === scope;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scope]');
    if (!btn) return;
    const next = btn.dataset.scope;
    if (SCOPES.indexOf(next) === -1 || next === scope) return;
    scope = next;
    TT.prefs.set('goals.view', scope);
    syncSeg();
    render();
  });

  /* ---------- pieces ---------- */
  function progressRow(listItems) {
    const p = TT.goals.progress(scope) || { done: 0, total: 0, all: false };
    const total = p.total != null ? p.total : listItems.length;
    const done = p.done != null ? p.done : 0;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const row = el('div', 'goal-progress');
    const bar = el('div', 'goal-progress-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-label', 'goals progress');
    const fill = el('span', 'goal-progress-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(el('span', 'goal-progress-num', done + '/' + total));
    if ((p.all || (total > 0 && done === total)) && total > 0) {
      const all = el('span', 'goal-progress-all');
      all.title = 'all done';
      all.innerHTML = '<i data-lucide="check-circle"></i>';
      row.appendChild(all);
    }
    return row;
  }

  function goalRow(g, i) {
    const row = el('div', 'goal reveal d' + Math.min(i + 1, 8) + (g.done ? ' is-done' : ''));
    row.dataset.id = g.id;

    const check = el('button', 'goal-check');
    check.type = 'button';
    check.setAttribute('aria-label', (g.done ? 'mark active' : 'mark done') + ': ' + goalText(g));
    check.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';

    const del = el('button', 'goal-del');
    del.type = 'button';
    del.setAttribute('aria-label', 'delete goal');
    del.innerHTML = '<i data-lucide="x"></i>';

    row.appendChild(check);
    row.appendChild(el('span', 'goal-text', goalText(g)));
    row.appendChild(del);
    return row;
  }

  function fillFoot() {
    if (scope === 'week') {
      foot.appendChild(el('span', 'goal-foot-note', 'resets monday 00:00'));
      return;
    }
    foot.appendChild(el('span', 'goal-foot-note', 'resets at midnight'));
    let streak = 0;
    try { streak = Number(TT.goals.streak()) || 0; } catch (e) { streak = 0; }
    if (streak >= 1) {
      const chip = el('span', 'goal-streak');
      chip.innerHTML = '<i data-lucide="flame"></i>';
      chip.appendChild(document.createTextNode(streak + ' day streak'));
      foot.appendChild(chip);
    }
  }

  /* ---------- render ---------- */
  function render() {
    const listItems = items();

    head.innerHTML = '';
    if (listItems.length) head.appendChild(progressRow(listItems));

    list.innerHTML = '';
    if (!listItems.length) {
      const empty = el('div', 'bento-empty');
      empty.innerHTML = '<i data-lucide="target"></i>';
      empty.appendChild(el('span', null, 'no goals yet. aim small.'));
      list.appendChild(empty);
    } else {
      listItems.forEach((g, i) => list.appendChild(goalRow(g, i)));
    }

    input.placeholder = scope === 'day' ? 'add a daily goal…' : 'add a weekly goal…';

    foot.innerHTML = '';
    fillFoot();

    icons();
  }

  /* ---------- interactions ---------- */
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.goal');
    if (!row) return;
    /* pass the item's own id (not the dataset string) — id type stays
       whatever core/goals.js chose, same as ui/tasks.js */
    const g = items().find((x) => String(x.id) === String(row.dataset.id));
    if (!g) return;
    if (e.target.closest('.goal-check')) TT.goals.toggle(g.id, scope);
    else if (e.target.closest('.goal-del')) TT.goals.remove(g.id, scope);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (items().length >= CAP) {
      toast('keep it to 12 goals');
      input.focus();
      return;
    }
    TT.goals.add(text, scope);
    input.value = '';
    input.focus();
  });

  /* ---------- boot ---------- */
  TT.on('tt:goals-changed', render);
  /* streak + reset note go stale across midnight — re-render on day flip */
  let lastDay = (TT.util && typeof TT.util.todayKey === 'function') ? TT.util.todayKey() : '';
  TT.on('tt:tick', () => {
    if (!TT.util || typeof TT.util.todayKey !== 'function') return;
    const d = TT.util.todayKey();
    if (d !== lastDay) { lastDay = d; render(); }
  });

  syncSeg();
  render();
})();
