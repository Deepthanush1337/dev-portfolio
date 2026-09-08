/* select.js — custom dropdowns (.ttsel) over the native selects
   (#tt-task-cat, #tt-focus-task). Progressive enhancement, vanilla IIFE.

   The native <select> stays in the DOM as the single source of truth:
   value, options, form participation. It is visually hidden (.ttsel-src,
   sr-only clip — never display:none) and taken out of tab order; the
   replacement button carries the full listbox ARIA instead.

   Two-way sync:
   • user picks from the custom UI → select.value is set and a bubbling
     'change' Event is dispatched, so existing listeners fire untouched
   • anything rebuilds the native options (focus.js refills #tt-focus-task
     on every tt:tasks-changed) or flips disabled → MutationObserver +
     'change' listener rebuild/refresh the custom UI. */
(() => {
  'use strict';

  const IDS = ['tt-task-cat', 'tt-focus-task'];

  /* ms — grace window after open during which scroll events can't close the
     list. Must outlive the open-time scrollIntoView: 'instant' behavior is
     requested, but engines that ignore it fall back to the page's smooth
     scroll-behavior (base.css) and keep firing scroll events for a few
     hundred ms (v3-smoke issue 1 — the list self-closed near the viewport
     bottom when the grace was 150ms) */
  const SCROLL_GRACE = 450;
  const DROP_GAP = 6;  // px — mirrors .ttsel-list's top: calc(100% + 6px)
  const DROP_EDGE = 8; // px of breathing room kept from the clip edge/viewport

  function enhance(select) {
    if (!select || select.tagName !== 'SELECT') return;
    if (select.classList.contains('ttsel-src')) return; // already enhanced
    const parent = select.parentNode;
    if (!parent) return;

    const id = select.id || 'sel';
    const uid = 'ttsel-' + id;
    const purpose = select.getAttribute('aria-label') || 'choose an option';

    /* ---------- hide the native select, keep it form-compatible ---------- */
    select.classList.add('ttsel-src');
    select.setAttribute('tabindex', '-1');   // no invisible tab stop
    select.setAttribute('aria-hidden', 'true'); // the button carries the ARIA

    /* ---------- wrapper (positioning context, takes the select's place) ---------- */
    const wrap = document.createElement('div');
    wrap.className = 'ttsel';
    wrap.setAttribute('data-ttsel', id);

    /* ---------- trigger button ---------- */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ttsel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', uid + '-list');

    const sr = document.createElement('span'); // announced before the value
    sr.className = 'sr-only';
    sr.id = uid + '-lbl';
    sr.textContent = purpose;

    const label = document.createElement('span');
    label.className = 'ttsel-label';
    label.id = uid + '-val';

    const chev = document.createElement('i');
    chev.setAttribute('data-lucide', 'chevron-down');
    chev.setAttribute('aria-hidden', 'true');

    btn.setAttribute('aria-labelledby', sr.id + ' ' + label.id);
    btn.appendChild(sr);
    btn.appendChild(label);
    btn.appendChild(chev);

    /* ---------- listbox ---------- */
    const list = document.createElement('ul');
    list.className = 'ttsel-list';
    list.id = uid + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', purpose);
    list.hidden = true;

    parent.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(btn);
    wrap.appendChild(list);

    /* ---------- state ---------- */
    let open = false;
    let optEls = [];        // li elements, aligned with select.options
    let activeIdx = -1;     // keyboard/hover-active option while open
    let typeBuf = '';       // type-ahead accumulator
    let typeTimer = 0;
    let suppressClick = false; // Enter/Space handled in keydown — swallow the native click
    let openedAt = 0;       // grace window so open-time scrollIntoView can't self-close

    const isDisabled = (i) => {
      const o = select.options[i];
      return !o || o.disabled;
    };

    /* next enabled option, cyclical; -1 when there are none */
    function move(from, dir) {
      const n = optEls.length;
      if (!n) return -1;
      let i = from;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!isDisabled(i)) return i;
      }
      return -1;
    }
    const firstEnabled = () => move(-1, 1);
    const lastEnabled = () => move(optEls.length, -1);

    /* ---------- render ---------- */
    function syncLabel() {
      const sel = select.selectedIndex;
      const o = sel >= 0 ? select.options[sel] : null;
      label.textContent = o ? o.textContent : '';
      for (let i = 0; i < optEls.length; i++) {
        const on = i === sel;
        optEls[i].classList.toggle('sel', on);
        optEls[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }

    /* rebuild the custom list from the native options (all text via
       textContent — task titles are user input, never innerHTML) */
    function buildList() {
      const keepActive = open ? activeIdx : -1;
      list.innerHTML = '';
      optEls = [];
      const opts = select.options;
      for (let i = 0; i < opts.length; i++) {
        const li = document.createElement('li');
        li.className = 'ttsel-opt';
        li.id = uid + '-opt-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.idx = String(i);
        if (opts[i].disabled) li.classList.add('dis');

        const txt = document.createElement('span');
        txt.className = 'ttsel-opt-text';
        txt.textContent = opts[i].textContent;
        li.appendChild(txt);

        const chk = document.createElement('span'); // shown only on .sel (css)
        chk.className = 'ttsel-check';
        chk.setAttribute('aria-hidden', 'true');
        const ci = document.createElement('i');
        ci.setAttribute('data-lucide', 'check');
        chk.appendChild(ci);
        li.appendChild(chk);

        list.appendChild(li);
        optEls.push(li);
      }
      btn.disabled = select.disabled;
      syncLabel();
      if (open) {
        // options were rebuilt under an open list — keep a sane active row
        if (keepActive >= 0 && keepActive < optEls.length && !isDisabled(keepActive)) {
          setActive(keepActive, false);
        } else {
          setActive(select.selectedIndex >= 0 && !isDisabled(select.selectedIndex)
            ? select.selectedIndex : firstEnabled(), false);
        }
        placeList(); // height may have changed — re-fit against card/viewport
      }
      if (window.lucide) window.lucide.createIcons();
    }

    function clearActive() {
      if (activeIdx >= 0 && optEls[activeIdx]) optEls[activeIdx].classList.remove('active');
      activeIdx = -1;
    }

    function setActive(i, scroll) {
      clearActive();
      if (i < 0 || i >= optEls.length) {
        btn.removeAttribute('aria-activedescendant');
        return;
      }
      activeIdx = i;
      const li = optEls[i];
      li.classList.add('active');
      btn.setAttribute('aria-activedescendant', li.id);
      if (scroll && li.scrollIntoView) {
        // behavior:'instant' overrides the page's smooth scroll-behavior — an
        // animated document scroll from here keeps firing scroll events past
        // the open grace and self-closes the list (v3-smoke issue 1)
        try { li.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } catch (e) { /* older engines */ }
      }
    }

    /* ---------- open / close ---------- */
    function onDocPointer(e) {
      if (!wrap.contains(e.target)) closeList(false);
    }

    function onDocScroll(e) {
      // opening scrollIntoView may scroll ancestors — see SCROLL_GRACE
      if (Date.now() - openedAt < SCROLL_GRACE) return;
      // any scroll outside the dropdown closes it; scrolling the list itself doesn't
      if (e.target !== list && !list.contains(e.target)) closeList(false);
    }

    /* nearest ancestor that can clip the list vertically — .bento is
       overflow:hidden, so on mobile the card edge, not the viewport, is what
       slices the open list (v3-a11yresp issue 1). null = only the viewport
       bounds us. */
    function clipAncestor() {
      let el = wrap.parentElement;
      while (el && el !== document.body && el !== document.documentElement) {
        const o = window.getComputedStyle(el).overflowY;
        if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return el;
        el = el.parentElement;
      }
      return null;
    }

    /* fit the open list into the space actually available: flip it above the
       button (inline bottom/top — the CSS files own the default downward
       look) when it doesn't fit below and there's more room above, and cap
       its max-height so neither the card nor the viewport can clip it */
    function placeList() {
      list.style.top = '';
      list.style.bottom = '';
      list.style.maxHeight = '';
      list.style.transformOrigin = '';

      const r = btn.getBoundingClientRect();
      let below = window.innerHeight - r.bottom;
      let above = r.top;
      const clipper = clipAncestor();
      if (clipper) {
        const cr = clipper.getBoundingClientRect();
        below = Math.min(below, cr.bottom - r.bottom);
        above = Math.min(above, r.top - cr.top);
      }
      below = Math.max(0, below - DROP_GAP - DROP_EDGE);
      above = Math.max(0, above - DROP_EDGE);

      const cssMax = parseFloat(window.getComputedStyle(list).maxHeight);
      const natural = Math.min(isFinite(cssMax) ? cssMax : 260, list.scrollHeight + 2); // + borders

      if (below < natural && above > below) {
        list.style.top = 'auto';
        list.style.bottom = 'calc(100% + ' + DROP_GAP + 'px)'; // drop up
        list.style.transformOrigin = 'bottom center';
        if (above < natural) list.style.maxHeight = above + 'px';
      } else if (below < natural) {
        list.style.maxHeight = below + 'px';
      }
    }

    function openList() {
      if (open || btn.disabled) return;
      open = true;
      openedAt = Date.now();
      wrap.classList.add('open');
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      placeList(); // flip up / cap height before anything measures or scrolls
      let idx = select.selectedIndex;
      if (idx < 0 || isDisabled(idx)) idx = firstEnabled();
      setActive(idx, true);
      document.addEventListener('pointerdown', onDocPointer, true);
      document.addEventListener('scroll', onDocScroll, true);
    }

    function closeList(refocus) {
      if (!open) return;
      open = false;
      wrap.classList.remove('open');
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
      clearActive();
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('scroll', onDocScroll, true);
      if (refocus) btn.focus();
    }

    /* ---------- commit a pick back to the native select ---------- */
    function commit(i) {
      if (i < 0 || i >= optEls.length || isDisabled(i)) return;
      const changed = select.selectedIndex !== i;
      select.value = select.options[i].value;
      syncLabel();
      if (changed) {
        // bubbling 'change' so the page's existing listeners fire untouched
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    function pick(i) {
      commit(i);
      closeList(true); // return focus to the trigger
    }

    /* ---------- type-ahead (open: move active; closed: commit, like native) ---------- */
    function onTypeAhead(ch) {
      const cycling = typeBuf.length > 0 && typeBuf.split('').every((c) => c === ch);
      typeBuf += ch;
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => { typeBuf = ''; }, 600);
      const buf = (cycling ? ch : typeBuf).toLowerCase(); // "sss" cycles the s-options
      const n = optEls.length;
      if (!n) return;
      const cur = open ? activeIdx : select.selectedIndex;
      for (let k = 1; k <= n; k++) {
        const i = ((cur < 0 ? -1 : cur) + k) % n;
        if (isDisabled(i)) continue;
        const t = (select.options[i].textContent || '').trim().toLowerCase();
        if (t.indexOf(buf) === 0) {
          if (open) setActive(i, true);
          else commit(i);
          return;
        }
      }
    }

    /* ---------- events ---------- */
    function onBtnClick(e) {
      // Swallow only the keyboard-origin click (detail 0) that Enter/Space can
      // still produce after we handled keydown. Real mouse clicks (detail ≥ 1)
      // and assistive-tech clicks (detail 0, no preceding keydown) always work.
      if (suppressClick && (!e || !e.detail)) { suppressClick = false; return; }
      suppressClick = false;
      if (open) closeList(false);
      else openList();
    }

    function onBtnKeydown(e) {
      const k = e.key;
      if (k === 'Escape') {
        if (open) {
          e.preventDefault();
          e.stopPropagation(); // we consumed it — don't close anything behind us
          closeList(true);     // return focus to the trigger
        }
        return;
      }

      if (open) {
        switch (k) {
          case 'ArrowDown':
            e.preventDefault();
            setActive(move(activeIdx, 1), true);
            break;
          case 'ArrowUp':
            e.preventDefault();
            setActive(move(activeIdx, -1), true);
            break;
          case 'Home':
            e.preventDefault();
            setActive(firstEnabled(), true);
            break;
          case 'End':
            e.preventDefault();
            setActive(lastEnabled(), true);
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            suppressClick = true; // Enter/Space also produce a native click — ignore it
            if (activeIdx >= 0) pick(activeIdx);
            else closeList(true); // nothing active (all options disabled) — just close
            break;
          case 'Tab':
            closeList(false); // let focus move on naturally
            break;
          default:
            if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onTypeAhead(k.toLowerCase());
        }
        return;
      }

      // closed — native-like keys; Enter/Space fall through to the native click toggle
      switch (k) {
        case 'ArrowDown':
          e.preventDefault();
          openList();
          if (select.selectedIndex >= 0) setActive(move(activeIdx, 1), true);
          break;
        case 'ArrowUp':
          e.preventDefault();
          openList();
          setActive(select.selectedIndex >= 0 ? move(activeIdx, -1) : lastEnabled(), true);
          break;
        case 'Home':
          e.preventDefault();
          commit(firstEnabled());
          break;
        case 'End':
          e.preventDefault();
          commit(lastEnabled());
          break;
        default:
          if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onTypeAhead(k.toLowerCase());
      }
    }

    btn.addEventListener('click', onBtnClick);
    btn.addEventListener('keydown', onBtnKeydown);
    btn.addEventListener('blur', () => { closeList(false); });

    // pick on pointerdown + preventDefault: focus never leaves the button
    list.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const li = e.target && e.target.closest ? e.target.closest('.ttsel-opt') : null;
      if (!li || !list.contains(li)) return;
      pick(Number(li.dataset.idx));
    });

    // hover tracks the keyboard-active row (no scroll hijack)
    list.addEventListener('mouseover', (e) => {
      if (!open) return;
      const li = e.target && e.target.closest ? e.target.closest('.ttsel-opt') : null;
      if (!li || !list.contains(li)) return;
      const i = Number(li.dataset.idx);
      if (i !== activeIdx && !isDisabled(i)) setActive(i, false);
    });

    /* ---------- two-way sync with the native select ---------- */
    // value set programmatically (or our own dispatch) → refresh label/selection
    select.addEventListener('change', syncLabel);

    // options rebuilt (focus.js refills #tt-focus-task on tt:tasks-changed),
    // option relabeled/disabled, or the select itself disabled → full refresh
    const mo = new MutationObserver(buildList);
    mo.observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'label', 'selected']
    });

    /* ---------- init ---------- */
    buildList();
  }

  for (let i = 0; i < IDS.length; i++) {
    enhance(document.getElementById(IDS[i])); // guard nulls — missing ids are fine
  }
})();
