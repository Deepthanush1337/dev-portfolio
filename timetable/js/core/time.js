/* time.js — clock + heartbeat.
   Fills #tt-clock (HH:MM:SS) and #tt-date ('FRI · AUG 15'), emits 'tt:tick'
   with the current Date every 1s. Extends TT.util with greet() / todayKey(). */
(function () {
  'use strict';

  var TT = window.TT; // created by core/store.js (loaded first)
  if (!TT) return;

  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clockText(d) {
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function dateText(d) {
    return DAYS[d.getDay()] + ' · ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  var clockEl = document.getElementById('tt-clock');
  var dateEl = document.getElementById('tt-date');
  var lastClock = '';
  var lastDate = '';

  function tick() {
    var now = new Date();
    if (clockEl) {
      var c = clockText(now);
      if (c !== lastClock) { clockEl.textContent = c; lastClock = c; }
    }
    if (dateEl) {
      var d = dateText(now);
      if (d !== lastDate) { dateEl.textContent = d; lastDate = d; }
    }
    if (typeof TT.emit === 'function') TT.emit('tt:tick', now);
  }

  // ---- TT.util extensions -------------------------------------------------

  TT.util = TT.util || {};

  // 'morning' 5–12, 'afternoon' 12–17, 'evening' 17–22, else 'night'
  TT.util.greet = function (now) {
    // cross-realm-safe Date check (same duck-type as core/data.js isDate)
    if (!(now instanceof Date) && !(now && typeof now.getTime === 'function')) now = new Date();
    var h = now.getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
  };

  TT.util.todayKey = function () {
    return TT.util.dayKey(new Date());
  };

  // ---- heartbeat ----------------------------------------------------------

  tick(); // paint immediately, no 1s blank
  // Align the interval to the next wall-clock second so digits flip cleanly.
  setTimeout(function () {
    tick();
    setInterval(tick, 1000);
  }, 1000 - (Date.now() % 1000));
})();
