/* confetti.js — canvas #tt-confetti particle bursts on 'tt:celebrate' */
(() => {
  'use strict';

  const canvas = document.getElementById('tt-confetti');
  if (!canvas || !window.TT || !TT.on) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let dpr = 1;
  let particles = [];
  let rafId = 0;
  let sized = false;    // canvas backing store allocated lazily on first burst
  let resizeTimer = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }
  window.addEventListener('resize', () => {
    if (!sized) return; // nothing allocated yet — the first burst sizes it
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150); // debounced
  }, { passive: true });

  function colors() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fb) => (cs.getPropertyValue(name).trim() || fb);
    return [pick('--acc', '#c8ff00'), pick('--acc2', '#8b5cf6'), pick('--live', '#ff4d8d'), '#fff'];
  }

  function spawn(x, y) {
    const palette = colors();
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 7;
      const circle = Math.random() < 0.25; // a few circles among the squares
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3.5,
        size: circle ? 2 + Math.random() * 2.5 : 4 + Math.random() * 3, // 4–7px squares
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.28,
        color: palette[(Math.random() * palette.length) | 0],
        circle,
        life: 70 + ((Math.random() * 40) | 0), // 70–110 frames
        age: 0,
      });
    }
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.age < p.life && p.y < canvas.height / dpr + 40);

    if (!particles.length) {
      rafId = 0;
      return;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    for (const p of particles) {
      p.age++;
      p.vx *= 0.985; // drag
      p.vy = p.vy * 0.985 + 0.12; // drag + gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
    ctx.restore();
    rafId = requestAnimationFrame(tick);
  }

  TT.on('tt:celebrate', (detail) => {
    if (!sized) { sized = true; resize(); } // allocate the backing store on first burst
    const d = detail || {};
    const x = typeof d.x === 'number' ? d.x : window.innerWidth * (0.2 + Math.random() * 0.6);
    const y = typeof d.y === 'number' ? d.y : window.innerHeight * 0.35;
    spawn(x, y);
  });
})();
