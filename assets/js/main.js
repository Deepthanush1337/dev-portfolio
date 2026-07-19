// Theme toggle
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');
const html = document.documentElement;

function applyTheme(dark) {
  if (dark) {
    html.classList.add('dark');
    sunIcon?.classList.remove('hidden');
    moonIcon?.classList.add('hidden');
  } else {
    html.classList.remove('dark');
    sunIcon?.classList.add('hidden');
    moonIcon?.classList.remove('hidden');
  }
}

function toggleTheme() {
  const isDark = html.classList.contains('dark');
  const newDark = !isDark;
  applyTheme(newDark);
  try {
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  } catch (e) {
    // localStorage unavailable
  }
}

function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (e) {
    // localStorage unavailable
  }
  // Default to light theme unless the user explicitly chose dark
  const isDark = stored === 'dark';
  applyTheme(isDark);
}

initTheme();

if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

// Preloader with Cloudflare Turnstile verification
const preloader = document.getElementById('preloader');
const turnstileContainer = document.getElementById('turnstileContainer');
const turnstileError = document.getElementById('turnstileError');
const turnstileSkip = document.getElementById('turnstileSkip');
let turnstileVerified = false;

function hidePreloader() {
  if (!preloader) return;
  preloader.classList.add('opacity-0', 'pointer-events-none');
  setTimeout(() => preloader.remove(), 700);
}

window.onTurnstileSuccess = function() {
  turnstileVerified = true;
  if (turnstileError) turnstileError.classList.add('hidden');
  if (turnstileSkip) turnstileSkip.classList.add('hidden');
  setTimeout(hidePreloader, 600);
};

function showTurnstileError() {
  if (turnstileError) turnstileError.classList.remove('hidden');
  if (turnstileSkip) turnstileSkip.classList.remove('hidden');
}

window.onTurnstileError = showTurnstileError;
window.onTurnstileExpired = showTurnstileError;

if (turnstileSkip) {
  turnstileSkip.addEventListener('click', hidePreloader);
}

// Fallback: if Turnstile fails to load or takes too long, show skip option
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!turnstileVerified && preloader && preloader.parentNode) {
      showTurnstileError();
    }
  }, 5000);
});

// Live age counter — updates with millisecond precision using requestAnimationFrame
const liveAge = document.getElementById('liveAge');
if (liveAge) {
  const birthDate = new Date('2008-06-25T00:00:00');
  const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

  function updateAge() {
    const now = new Date();
    const ageYears = (now - birthDate) / MS_PER_YEAR;
    liveAge.textContent = ageYears.toFixed(9);
    requestAnimationFrame(updateAge);
  }
  updateAge();
}

// Mobile menu toggle
const menuToggle = document.getElementById('menuToggle');
const mobileMenu = document.getElementById('mobileMenu');

if (menuToggle && mobileMenu) {
  menuToggle.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.add('hidden');
    });
  });

  document.addEventListener('click', (e) => {
    if (!menuToggle.contains(e.target) && !mobileMenu.contains(e.target)) {
      mobileMenu.classList.add('hidden');
    }
  });
}

// Footer year
const yearSpan = document.getElementById('year');
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear();
}

// Email copy to clipboard with toast
const emailBtn = document.getElementById('emailBtn');
const toast = document.getElementById('toast');

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 2200);
}

if (emailBtn) {
  emailBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = 'deepthanush1337@icloud.com';
    try {
      await navigator.clipboard.writeText(email);
      showToast('Email copied to clipboard!');
    } catch (err) {
      // Fallback
      const input = document.createElement('input');
      input.value = email;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showToast('Email copied to clipboard!');
    }
  });
}

// GitHub username used for repos + contribution calendar
const GITHUB_USER = 'Deepthanush1337';

// Fetch GitHub repos for Open Source Work section
const opensourceGrid = document.getElementById('opensourceGrid');

function createRepoCard(repo) {
  const name = repo.name || 'repo';
  const description = repo.description || 'Public repository on GitHub.';
  const language = repo.language || 'Code';
  const url = repo.html_url || `https://github.com/${GITHUB_USER}/${encodeURIComponent(name)}`;
  const colorClass = getLanguageColor(language);

  const card = document.createElement('a');
  card.href = url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'repo-card group';

  const border = document.createElement('div');
  border.className = 'repo-card-border';

  const content = document.createElement('div');
  content.className = 'repo-card-content';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-2 min-w-0';

  const githubIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  githubIcon.setAttribute('class', 'h-5 w-5 shrink-0 text-muted-foreground');
  githubIcon.setAttribute('viewBox', '0 0 24 24');
  githubIcon.setAttribute('fill', 'none');
  githubIcon.setAttribute('stroke', 'currentColor');
  githubIcon.setAttribute('stroke-width', '2');
  githubIcon.setAttribute('stroke-linecap', 'round');
  githubIcon.setAttribute('stroke-linejoin', 'round');
  githubIcon.innerHTML = '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>';

  const title = document.createElement('h3');
  title.className = 'text-base font-semibold truncate';
  title.textContent = name;

  titleWrap.appendChild(githubIcon);
  titleWrap.appendChild(title);

  const arrowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrowIcon.setAttribute('class', 'h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5');
  arrowIcon.setAttribute('viewBox', '0 0 24 24');
  arrowIcon.setAttribute('fill', 'none');
  arrowIcon.setAttribute('stroke', 'currentColor');
  arrowIcon.setAttribute('stroke-width', '2');
  arrowIcon.setAttribute('stroke-linecap', 'round');
  arrowIcon.setAttribute('stroke-linejoin', 'round');
  arrowIcon.innerHTML = '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>';

  header.appendChild(titleWrap);
  header.appendChild(arrowIcon);

  const desc = document.createElement('p');
  desc.className = 'mt-2 text-sm text-muted-foreground line-clamp-2';
  desc.textContent = description;

  const meta = document.createElement('div');
  meta.className = 'mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground';

  const langSpan = document.createElement('span');
  langSpan.className = 'flex items-center gap-1';
  const langDot = document.createElement('span');
  langDot.className = `h-2 w-2 rounded-full ${colorClass}`;
  const langText = document.createTextNode(language);
  langSpan.appendChild(langDot);
  langSpan.appendChild(langText);

  const publicSpan = document.createElement('span');
  publicSpan.className = 'flex items-center gap-1';
  const starIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  starIcon.setAttribute('class', 'h-3 w-3');
  starIcon.setAttribute('viewBox', '0 0 24 24');
  starIcon.setAttribute('fill', 'none');
  starIcon.setAttribute('stroke', 'currentColor');
  starIcon.setAttribute('stroke-width', '2');
  starIcon.setAttribute('stroke-linecap', 'round');
  starIcon.setAttribute('stroke-linejoin', 'round');
  starIcon.innerHTML = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
  const publicText = document.createTextNode('Public');
  publicSpan.appendChild(starIcon);
  publicSpan.appendChild(publicText);

  meta.appendChild(langSpan);
  meta.appendChild(publicSpan);

  content.appendChild(header);
  content.appendChild(desc);
  content.appendChild(meta);

  card.appendChild(border);
  card.appendChild(content);

  return card;
}

function getLanguageColor(language) {
  const colors = {
    Python: 'bg-blue-400',
    JavaScript: 'bg-yellow-400',
    TypeScript: 'bg-blue-500',
    HTML: 'bg-orange-500',
    CSS: 'bg-purple-400',
    Java: 'bg-red-400',
    Go: 'bg-cyan-400',
    Rust: 'bg-orange-700',
    C: 'bg-gray-500',
    'C++': 'bg-pink-500',
    Shell: 'bg-green-400',
    Jupyter: 'bg-orange-400'
  };
  return colors[language] || 'bg-gray-400';
}

function renderRepos(repos) {
  if (!opensourceGrid) return;
  const nonForks = repos.filter(r => !r.fork);
  const sorted = nonForks
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
    .slice(0, 3);
  opensourceGrid.innerHTML = '';
  sorted.forEach(repo => {
    opensourceGrid.appendChild(createRepoCard(repo));
  });
}

async function fetchRepos() {
  if (!opensourceGrid) return;
  try {
    const response = await fetch(`https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`);
    if (!response.ok) throw new Error('GitHub API failed');
    const repos = await response.json();
    renderRepos(repos);
  } catch (e) {
    console.log('Using fallback repos');
    const fallback = JSON.parse(opensourceGrid.dataset.fallback || '[]');
    renderRepos(fallback.map(r => ({
      name: r.name,
      description: r.description,
      language: r.language,
      html_url: `https://github.com/${GITHUB_USER}/${r.name}`,
      fork: false,
      updated_at: new Date().toISOString()
    })));
  }
}

fetchRepos();

// GitHub contribution calendar — fetched client-side on page load.
// Note: GitHub's official API only exposes the contribution graph through
// authenticated GraphQL (a token can't be shipped in client JS), so we use
// the public contributions API, which serves GitHub's exact calendar data
// (per-day counts, GitHub's own 0-4 levels, and the official yearly total).
const activityTotal = document.getElementById('activityTotal');
const activityTotalText = document.getElementById('activityTotalText');
const activityChart = document.getElementById('activityChart');
const activityCalendar = document.querySelector('.activity-calendar');
const activityMonths = document.getElementById('activityMonths');
const activityGrid = document.getElementById('activityGrid');
const activityDaysLabel = document.getElementById('activityDaysLabel');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

let activityData = null;      // { days: {iso: {count, level}}, total: number }
let activityState = 'loading'; // 'loading' | 'ready' | 'error'

function getISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setActivityStatus(ok) {
  if (!activityTotal) return;
  const ping = activityTotal.querySelector('.animate-ping');
  const dot = activityTotal.querySelector('.relative.inline-flex');
  if (ping) ping.style.display = ok ? '' : 'none';
  if (dot) {
    dot.classList.toggle('bg-green-500', ok);
    dot.classList.toggle('bg-gray-400', !ok);
  }
}

function createActivityCalendar() {
  if (!activityChart || !activityMonths || !activityGrid || !activityDaysLabel) return;

  const days = activityData ? activityData.days : {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Responsive sizing: fit as many week columns as possible at a comfortable
  // cell size (capped at a full year), then stretch cells to fill the width.
  const isMobile = window.innerWidth < 640;
  const gap = isMobile ? 3 : 4;
  const labelWidth = isMobile ? 16 : 20; // matches .activity-days-label width
  const chartWidth = activityChart.clientWidth || activityChart.getBoundingClientRect().width;
  const available = Math.max(0, chartWidth - labelWidth - gap);
  const minDay = isMobile ? 9 : 10;
  const maxWeeks = 53; // full year
  let totalWeeks = Math.floor((available + gap) / (minDay + gap));
  totalWeeks = Math.max(4, Math.min(maxWeeks, totalWeeks));
  const daySize = Math.max(minDay, Math.floor((available - (totalWeeks - 1) * gap) / totalWeeks));

  const calendarWidth = labelWidth + gap + totalWeeks * daySize + (totalWeeks - 1) * gap;
  activityChart.style.setProperty('--activity-day', `${daySize}px`);
  activityChart.style.setProperty('--activity-gap', `${gap}px`);
  if (activityCalendar) {
    activityCalendar.style.width = `${calendarWidth}px`;
  }

  activityMonths.innerHTML = '';
  activityGrid.innerHTML = '';
  activityDaysLabel.innerHTML = '';

  // Day labels
  DAY_LABELS.forEach(label => {
    const span = document.createElement('span');
    span.textContent = label;
    activityDaysLabel.appendChild(span);
  });

  // Last column is the current (partial) week ending today — no future cells.
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - startDate.getDay() - (totalWeeks - 1) * 7);

  const weeks = [];
  let currentWeek = [];
  for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
    const iso = getISODate(d);
    const info = days[iso];
    currentWeek.push({
      date: iso,
      count: info ? info.count : 0,
      level: info ? info.level : 0
    });
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }
  if (currentWeek.length) weeks.push(currentWeek);

  // Month labels — each label spans the week columns it covers
  const monthSpans = [];
  weeks.forEach(week => {
    const month = parseInt(week[0].date.split('-')[1], 10) - 1;
    if (monthSpans.length === 0 || monthSpans[monthSpans.length - 1].month !== month) {
      monthSpans.push({ month, count: 1 });
    } else {
      monthSpans[monthSpans.length - 1].count++;
    }
  });

  monthSpans.forEach((span, index) => {
    const monthEl = document.createElement('div');
    monthEl.className = 'activity-month';
    const textSpan = document.createElement('span');
    textSpan.className = 'activity-month-text';
    textSpan.textContent = MONTH_NAMES[span.month];
    monthEl.appendChild(textSpan);
    monthEl.style.width = `calc(${span.count} * var(--activity-day) + ${span.count - 1} * var(--activity-gap))`;
    // Hide labels that only cover a sliver of a month to avoid overlap
    if (span.count <= 1 && (index === 0 || index === monthSpans.length - 1)) {
      textSpan.style.visibility = 'hidden';
    }
    activityMonths.appendChild(monthEl);
  });

  // Grid
  weeks.forEach(week => {
    const weekEl = document.createElement('div');
    weekEl.className = 'activity-week';
    week.forEach(day => {
      const dayEl = document.createElement('div');
      dayEl.className = 'activity-day';
      dayEl.dataset.level = day.level;
      dayEl.title = `${day.count} contribution${day.count === 1 ? '' : 's'} on ${day.date}`;
      weekEl.appendChild(dayEl);
    });
    activityGrid.appendChild(weekEl);
  });

  // Total pill — always GitHub's official yearly total, independent of how
  // many weeks are visible at the current screen size.
  if (activityTotalText) {
    if (activityState === 'ready' && activityData) {
      activityTotalText.textContent = `${activityData.total.toLocaleString()} contributions in the last year`;
    } else if (activityState === 'error') {
      activityTotalText.textContent = 'Contributions unavailable';
    } else {
      activityTotalText.textContent = 'Loading...';
    }
  }
}

async function fetchGitHubActivity() {
  if (!activityChart) return;
  try {
    const response = await fetch(`https://github-contributions-api.jogruber.de/v4/${GITHUB_USER}?y=last`);
    if (!response.ok) throw new Error(`Contributions API failed: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.contributions)) throw new Error('Unexpected contributions API response');

    const days = {};
    let sum = 0;
    data.contributions.forEach(c => {
      days[c.date] = { count: c.count, level: c.level };
      sum += c.count;
    });
    const total = data.total && typeof data.total.lastYear === 'number' ? data.total.lastYear : sum;

    activityData = { days, total };
    activityState = 'ready';
  } catch (e) {
    console.error('GitHub contributions fetch failed:', e);
    activityState = 'error';
  }
  createActivityCalendar();
  setActivityStatus(activityState === 'ready');
}

// Re-render on any size change so the calendar always fits its container.
let activityResizeTimer = null;
function handleActivityResize() {
  clearTimeout(activityResizeTimer);
  activityResizeTimer = setTimeout(createActivityCalendar, 150);
}
if (activityChart) {
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(handleActivityResize).observe(activityChart);
  } else {
    window.addEventListener('resize', handleActivityResize);
  }
}

// Render empty skeleton immediately so the chart is never blank,
// then fetch live data and update.
createActivityCalendar();
fetchGitHubActivity();

// Skills filtering — All Skills excludes Libraries to keep the list clean
const filterButtons = document.querySelectorAll('.filter-btn');
const skillTags = document.querySelectorAll('.skill-tag');

function animateSkillFilter(visibleTags) {
  visibleTags.forEach((tag, index) => {
    tag.classList.remove('skill-animate-in');
    tag.style.animationDelay = `${index * 0.06}s`;
    // Force reflow so animation restarts
    void tag.offsetWidth;
    tag.classList.add('skill-animate-in');
  });
}

filterButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter;
    filterButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const visibleTags = [];
    skillTags.forEach(tag => {
      const category = tag.dataset.category;
      let show = false;
      if (filter === 'all') {
        show = category !== 'libraries';
      } else if (filter === 'libraries') {
        show = category === 'libraries';
      } else {
        show = category === filter;
      }
      tag.style.display = show ? 'inline-flex' : 'none';
      if (show) visibleTags.push(tag);
    });

    animateSkillFilter(visibleTags);
  });
});

// Trigger initial All Skills filter (hide libraries)
const allSkillsBtn = document.querySelector('.filter-btn[data-filter="all"]');
if (allSkillsBtn) allSkillsBtn.click();
