import {
  initializeFirebase,
  saveEnglish,
  loadEnglish,
  saveGym,
  loadGym,
  saveStreaks,
  loadStreaks,
  subscribeToDocument
} from './firebase.js';

const MASTER_PASSWORD = 'before30';

const LEVELS = {
  A1: 0,
  A2: 20,
  B1: 40,
  B2: 60,
  C1: 80,
  C2: 100
};

const defaultEnglish = {
  level: 'A1',
  resources: [],
  notes: []
};

const defaultGym = {
  startWeight: '',
  goalWeight: '',
  currentWeight: '',
  prs: [],
  weightLog: []
};

const defaultStreaks = {
  best: { english: 0, gym: 0 },
  checkins: {}
};

const state = {
  english: { ...defaultEnglish },
  gym: { ...defaultGym },
  streaks: { ...defaultStreaks }
};

let firebaseReady = false;
let unsubscribeFns = [];
let focusInterval;

const today = new Date();
let calendarViewYear = today.getFullYear();
let calendarViewMonth = today.getMonth();

function $(id) {
  return document.getElementById(id);
}

function mergeData(defaultValue, incoming) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(incoming) ? incoming : defaultValue;
  }
  if (defaultValue && typeof defaultValue === 'object') {
    return { ...defaultValue, ...(incoming || {}) };
  }
  return incoming ?? defaultValue;
}

function dateKey(date) {
  return date.toISOString().split('T')[0];
}

function todayKey() {
  return dateKey(new Date());
}

function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// A day counts as "completed" for a habit if it has a positive minute value,
// or (for older check-ins recorded before minutes were tracked) a plain `true`.
// A stored 0 means the day was explicitly marked as missed (NO), which is different
// from a day that simply has no entry yet.
function isCompleted(value) {
  return (typeof value === 'number' && value > 0) || value === true;
}

function getHabitStats(habit) {
  const checkins = state.streaks.checkins || {};
  let totalDays = 0;
  let totalMinutes = 0;
  Object.keys(checkins).forEach((date) => {
    const value = checkins[date] ? checkins[date][habit] : undefined;
    if (isCompleted(value)) {
      totalDays += 1;
      if (typeof value === 'number') {
        totalMinutes += value;
      }
    }
  });
  return { totalDays, totalMinutes };
}

function calcCurrentStreak(habit) {
  const checkins = state.streaks.checkins || {};
  const cursor = new Date();
  const todaysValue = checkins[todayKey()] ? checkins[todayKey()][habit] : undefined;

  // An explicit "NO" today is a real miss - streak is broken right away.
  if (todaysValue === 0) return 0;

  // Today just hasn't been logged yet - don't punish it until the day is over.
  // Start counting from yesterday instead.
  if (!isCompleted(todaysValue)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  for (;;) {
    const value = checkins[dateKey(cursor)] ? checkins[dateKey(cursor)][habit] : undefined;
    if (!isCompleted(value)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function refreshBestStreaks() {
  ['english', 'gym'].forEach((habit) => {
    const current = calcCurrentStreak(habit);
    const best = (state.streaks.best && state.streaks.best[habit]) || 0;
    if (current > best) {
      state.streaks.best = { ...state.streaks.best, [habit]: current };
    }
  });
}

function normalizeGymPrs(prs) {
  if (Array.isArray(prs)) {
    return prs;
  }
  if (prs && typeof prs === 'object') {
    return Object.entries(prs).map(([workout, value]) => ({
      workout,
      weight: value?.weight ?? value ?? '',
      reps: value?.reps ?? '',
      date: value?.date ?? new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }));
  }
  return [];
}

function showBanner(message, type = 'info') {
  const banner = $('syncStatus');
  if (!banner) return;
  banner.textContent = message;
  banner.className = `status-banner ${type}`;
  banner.hidden = false;
}

function clearBanner() {
  const banner = $('syncStatus');
  if (!banner) return;
  banner.hidden = true;
  banner.textContent = '';
  banner.className = 'status-banner';
}

function setLoadingVisible(visible, message = 'Loading your data...') {
  const loadingScreen = $('loadingScreen');
  const loadingText = $('loadingText');
  const banner = $('syncStatus');

  if (loadingScreen) {
    loadingScreen.hidden = true;
    loadingScreen.style.display = 'none';
  }

  if (loadingText) {
    loadingText.textContent = message;
  }

  if (banner) {
    if (visible) {
      banner.textContent = message;
      banner.className = 'status-banner info';
      banner.hidden = false;
    } else {
      banner.hidden = true;
      banner.textContent = '';
      banner.className = 'status-banner';
    }
  }
}

function setAppLocked(locked) {
  const lockScreen = $('lockScreen');
  const appShell = $('appShell');
  if (!lockScreen || !appShell) return;

  if (locked) {
    lockScreen.hidden = false;
    lockScreen.style.display = 'flex';
    appShell.hidden = true;
    appShell.style.display = 'none';
    document.body.style.overflow = 'hidden';
  } else {
    lockScreen.hidden = true;
    lockScreen.style.display = 'none';
    appShell.hidden = false;
    appShell.style.display = 'block';
    document.body.style.overflow = 'auto';
  }
}

function showLockMessage(message, type = 'info') {
  const lockMessage = $('lockMessage');
  if (!lockMessage) return;
  lockMessage.textContent = message;
  lockMessage.className = `lock-message ${type}`;
}

function createParticles() {
  const container = $('particles');
  if (!container) return;
  for (let i = 0; i < 50; i += 1) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${Math.random() * 100}%`;
    p.style.animationDelay = `${Math.random() * 15}s`;
    p.style.animationDuration = `${10 + Math.random() * 20}s`;
    container.appendChild(p);
  }
}

function updateAge() {
  const birthDate = new Date(2001, 7, 22);
  const now = new Date();
  const diff = now - birthDate;
  const years = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor((diff % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
  const days = Math.floor((diff % (30.44 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((diff % (60 * 1000)) / 1000);
  const ageDisplay = $('ageDisplay');
  if (ageDisplay) {
    ageDisplay.innerHTML = `<span>${years}</span>y <span>${months}</span>m <span>${days}</span>d <span>${hours}</span>h <span>${minutes}</span>m <span>${seconds}</span>s`;
  }
}

function updateCountdown() {
  const birthDate = new Date(2001, 7, 22);
  const thirtyDate = new Date(birthDate);
  thirtyDate.setFullYear(birthDate.getFullYear() + 30);
  const now = new Date();
  const diff = thirtyDate - now;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const countdownDisplay = $('countdownDisplay');
  if (countdownDisplay) {
    countdownDisplay.textContent = days;
  }
}

function initObservers() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.timeline-item').forEach((item) => observer.observe(item));
}

function revealLetter() {
  const hiddenLetter = $('hiddenLetter');
  if (hiddenLetter) {
    hiddenLetter.classList.toggle('visible');
  }
}

const quotes = [
  'The pain of discipline is nothing compared to the pain of regret',
  'Your 13-year-old self would be proud of how far you have come',
  'Germany won\'t wait forever. But it will wait for someone who tries.',
  'Discipline is choosing your future self over your current pain',
  'I was never given a clear road. So I became someone who keeps walking anyway.',
  'You don’t always get to choose the load, but you can choose how to carry it.',
  'You remain dead for eternity, but you are alive for only a brief moment.',
];

let currentQuote = 0;
let quoteOrder = [];

function shuffleQuotes() {
  quoteOrder = [...Array(quotes.length).keys()]
    .sort(() => Math.random() - 0.5);
}

function showQuote(index) {
  currentQuote = index;
  const quoteText = $('quoteText');
  if (quoteText) {
    const quoteIndex = quoteOrder[index] ?? index;
    quoteText.textContent = `"${quotes[quoteIndex]}"`;
  }
  document.querySelectorAll('.quote-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

function nextQuote() {
  currentQuote = (currentQuote + 1) % quotes.length;
  if (currentQuote === 0) {
    shuffleQuotes();
  }
  showQuote(currentQuote);
}

function renderEnglish() {
  const englishLevel = $('englishLevel');
  if (englishLevel) {
    englishLevel.value = state.english.level || 'A1';
  }
  const progress = LEVELS[state.english.level] || 0;
  const progressBar = $('englishProgress');
  const progressText = $('englishProgressText');
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }
  if (progressText) {
    progressText.textContent = `${progress}%`;
  }

  const resourcesList = $('resourcesList');
  if (resourcesList) {
    const resources = state.english.resources || [];
    resourcesList.innerHTML = resources.length
      ? resources.map((resource) => `<span style="display:inline-block;padding:4px 12px;background:var(--bg-elevated);border-radius:20px;font-size:0.8rem;margin:3px;">${resource}</span>`).join('')
      : '<span style="color:var(--text-muted);font-size:0.9rem;">No resources added yet.</span>';
  }

  const notesList = $('notesList');
  if (notesList) {
    const notes = state.english.notes || [];
    if (!notes.length) {
      notesList.innerHTML = '<div class="notes-empty">No notes yet. Start writing...</div>';
      return;
    }
    notesList.innerHTML = notes.map((note, index) => `
      <div class="note-item" data-index="${index}" data-number="${String(index + 1).padStart(2, '0')}">
        ${note.text || 'Note'}
        <span class="note-date">${note.date} &middot; ${note.time}</span>
      </div>
    `).join('');
    attachNoteSwipeHandlers();
  }
}

function attachNoteSwipeHandlers() {
  document.querySelectorAll('.note-item').forEach((item) => {
    const index = Number(item.getAttribute('data-index'));
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let dragging = false;

    const resetPosition = () => {
      item.style.transition = 'transform 0.2s ease';
      item.style.transform = 'translateX(0)';
    };

    const onPointerDown = (event) => {
      startX = event.clientX;
      startY = event.clientY;
      currentX = 0;
      dragging = true;
      item.style.transition = 'none';
      item.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        event.preventDefault();
        currentX = Math.max(-140, Math.min(140, deltaX));
        item.style.transform = `translateX(${currentX}px)`;
      }
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      if (Math.abs(currentX) > 90) {
        state.english.notes = (state.english.notes || []).filter((_, noteIndex) => noteIndex !== index);
        renderEnglish();
        saveEnglishData();
        showBanner('Note deleted.', 'info');
      } else {
        resetPosition();
      }
    };

    item.addEventListener('pointerdown', onPointerDown);
    item.addEventListener('pointermove', onPointerMove);
    item.addEventListener('pointerup', onPointerUp);
    item.addEventListener('pointercancel', onPointerUp);
    item.addEventListener('pointerleave', onPointerUp);
  });
}

function renderGym() {
  const startWeight = $('startWeight');
  const goalWeight = $('goalWeight');
  const currentWeight = $('currentWeight');
  if (startWeight) startWeight.value = state.gym.startWeight || '';
  if (goalWeight) goalWeight.value = state.gym.goalWeight || '';
  if (currentWeight) currentWeight.value = state.gym.currentWeight || '';

  const displayStart = $('displayStartWeight');
  const displayGoal = $('displayGoalWeight');
  const displayCurrent = $('displayCurrentWeight');
  if (displayStart) displayStart.textContent = state.gym.startWeight || '--';
  if (displayGoal) displayGoal.textContent = state.gym.goalWeight || '--';
  if (displayCurrent) displayCurrent.textContent = state.gym.currentWeight || '--';

  const weightProgress = $('weightProgress');
  const weightProgressText = $('weightProgressText');
  if (state.gym.startWeight && state.gym.goalWeight && state.gym.currentWeight) {
    const s = parseFloat(state.gym.startWeight);
    const g = parseFloat(state.gym.goalWeight);
    const c = parseFloat(state.gym.currentWeight);
    let progress = 0;
    if (g < s) {
      progress = ((s - c) / (s - g)) * 100;
    } else {
      progress = ((c - s) / (g - s)) * 100;
    }
    progress = Math.max(0, Math.min(100, progress));
    if (weightProgress) weightProgress.style.width = `${progress}%`;
    if (weightProgressText) weightProgressText.textContent = `${Math.round(progress)}%`;
  } else {
    if (weightProgress) weightProgress.style.width = '0%';
    if (weightProgressText) weightProgressText.textContent = '0%';
  }

  const prLog = $('prLog');
  if (prLog) {
    const prs = normalizeGymPrs(state.gym.prs || []);
    prLog.innerHTML = prs.length
      ? prs.map((entry, index) => `
          <div class="pr-item">
            <div>
              <strong>${entry.workout}</strong><br>
              <span>${entry.weight} kg × ${entry.reps} reps</span>
              <div class="pr-actions">
                <button type="button" data-pr-edit="${index}">Edit</button>
                <button type="button" class="pr-delete" data-pr-delete="${index}">Delete</button>
              </div>
            </div>
            <div style="text-align:right;color:var(--accent);font-size:0.8rem;white-space:nowrap;">${entry.date}</div>
          </div>
        `).join('')
      : '<div class="notes-empty">No personal records yet.</div>';
  }

  renderWeightLog();
}

function renderWeightLog() {
  const log = $('weightLog');
  if (!log) return;
  const entries = Array.isArray(state.gym.weightLog) ? state.gym.weightLog : [];
  if (!entries.length) {
    log.innerHTML = '<div class="weight-log-empty">No weigh-ins logged yet. Save a current weight above to start your log.</div>';
    return;
  }
  const ordered = [...entries].slice().reverse(); // newest first
  log.innerHTML = ordered.map((entry, i) => {
    const originalIndex = entries.length - 1 - i;
    const prev = entries[originalIndex - 1];
    let deltaHtml = '';
    if (prev) {
      const diff = parseFloat(entry.weight) - parseFloat(prev.weight);
      if (!Number.isNaN(diff) && diff !== 0) {
        const cls = diff < 0 ? 'down' : 'up';
        const arrow = diff < 0 ? '&darr;' : '&uarr;';
        deltaHtml = `<span class="wl-delta ${cls}">${arrow} ${Math.abs(diff).toFixed(1)}kg</span>`;
      }
    } else {
      deltaHtml = '<span class="wl-delta">Start</span>';
    }
    return `
      <div class="weight-log-item">
        <div><strong>${entry.weight} kg</strong> <span class="wl-date">&middot; ${entry.date}</span></div>
        ${deltaHtml}
      </div>`;
  }).join('');
}

function editPr(index) {
  const prs = normalizeGymPrs(state.gym.prs || []);
  const entry = prs[index];
  if (!entry) return;

  const newWeight = window.prompt('Weight (kg):', entry.weight);
  if (newWeight === null) return;
  const newReps = window.prompt('Reps:', entry.reps);
  if (newReps === null) return;
  const newDate = window.prompt('Date (e.g. Jul 5, 2026):', entry.date);
  if (newDate === null) return;

  prs[index] = { ...entry, weight: newWeight, reps: newReps, date: newDate || entry.date };
  state.gym.prs = prs;
  renderGym();
  saveGymData();
}

function deletePr(index) {
  const prs = normalizeGymPrs(state.gym.prs || []);
  prs.splice(index, 1);
  state.gym.prs = prs;
  renderGym();
  saveGymData();
}

function renderGerman() {
  const germanLevel = $('germanLevel');
  const germanProgress = $('germanProgress');
  const germanProgressText = $('germanProgressText');
  if (germanLevel) {
    germanLevel.value = state.english.germanLevel || 'A1';
  }
  const progress = LEVELS[state.english.germanLevel] || 0;
  if (germanProgress) germanProgress.style.width = `${progress}%`;
  if (germanProgressText) germanProgressText.textContent = `${progress}%`;
}

function renderThenNow() {
  const el = $('tvnNowText');
  if (!el) return;
  const level = state.english.level || 'A1';
  const engStreak = calcCurrentStreak('english');
  const gymStreak = calcCurrentStreak('gym');
  const weight = state.gym.currentWeight;
  const parts = [`English at <strong>${level}</strong>`];
  if (engStreak > 0 || gymStreak > 0) {
    parts.push(`a <strong>${Math.max(engStreak, gymStreak)}</strong> day streak`);
  }
  if (weight) {
    parts.push(`training logged at <strong>${weight}kg</strong>`);
  }
  parts.push('a plan, and a door still open to Germany.');
  el.innerHTML = parts.join(', ');
}

function renderStreakDetails() {
  const engCurrent = calcCurrentStreak('english');
  const gymCurrent = calcCurrentStreak('gym');
  const engStats = getHabitStats('english');
  const gymStats = getHabitStats('gym');
  const engBest = (state.streaks.best && state.streaks.best.english) || 0;
  const gymBest = (state.streaks.best && state.streaks.best.gym) || 0;

  const studyStreak = $('studyStreak');
  if (studyStreak) studyStreak.textContent = engCurrent;
  const gymStreakEl = $('gymStreak');
  if (gymStreakEl) gymStreakEl.textContent = gymCurrent;

  const studyBest = $('studyBestStreak');
  if (studyBest) studyBest.textContent = `🏆 Best streak: ${engBest} day${engBest === 1 ? '' : 's'}`;
  const gymBestEl = $('gymBestStreak');
  if (gymBestEl) gymBestEl.textContent = `🏆 Best streak: ${gymBest} day${gymBest === 1 ? '' : 's'}`;

  const studyTotalDays = $('studyTotalDays');
  if (studyTotalDays) studyTotalDays.textContent = `📅 Total days completed: ${engStats.totalDays}`;
  const gymTotalDays = $('gymTotalDays');
  if (gymTotalDays) gymTotalDays.textContent = `📅 Total days completed: ${gymStats.totalDays}`;

  const englishTimeInvested = $('englishTimeInvested');
  if (englishTimeInvested) englishTimeInvested.textContent = `⏳ ${formatMinutes(engStats.totalMinutes)}`;
  const gymTimeInvested = $('gymTimeInvested');
  if (gymTimeInvested) gymTimeInvested.textContent = `⏳ ${formatMinutes(gymStats.totalMinutes)}`;

  return { engStats, gymStats };
}

function renderHoursInvested() {
  const { engStats, gymStats } = renderStreakDetails();
  const englishHoursTotal = $('englishHoursTotal');
  const gymHoursTotal = $('gymHoursTotal');
  const combinedHoursTotal = $('combinedHoursTotal');
  if (englishHoursTotal) englishHoursTotal.textContent = formatMinutes(engStats.totalMinutes);
  if (gymHoursTotal) gymHoursTotal.textContent = formatMinutes(gymStats.totalMinutes);
  if (combinedHoursTotal) combinedHoursTotal.textContent = formatMinutes(engStats.totalMinutes + gymStats.totalMinutes);
}

function getWeekKey(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toISOString().split('T')[0];
}

function renderProgressChart() {
  const container = $('progressChart');
  if (!container) return;
  const checkins = state.streaks.checkins || {};
  const weeks = [];
  const now = new Date();
  for (let i = 7; i >= 0; i -= 1) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (i * 7));
    weeks.push(getWeekKey(weekStart));
  }
  const counts = weeks.map((weekStart) => {
    const start = new Date(weekStart);
    let count = 0;
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(start);
      day.setDate(day.getDate() + d);
      const key = day.toISOString().split('T')[0];
      const data = checkins[key];
      if (data && (data.english || data.gym)) count += 1;
    }
    return count;
  });
  container.innerHTML = counts.map((count, i) => {
    const pct = Math.max(4, (count / 7) * 100);
    const label = i === counts.length - 1 ? 'Now' : `W${i + 1}`;
    return `
      <div class="chart-col">
        <div class="chart-bar" style="height:${pct}%"></div>
        <div class="chart-bar-label">${label}</div>
      </div>`;
  }).join('');
}

function renderStreaks() {
  renderStreakDetails();
  renderCalendar();
}

function getEarliestCheckinMonth() {
  const checkins = state.streaks.checkins || {};
  const dates = Object.keys(checkins).sort();
  if (!dates.length) return null;
  const [year, month] = dates[0].split('-').map(Number);
  return { year, month: month - 1 };
}

function renderCalendar() {
  const grid = $('calendarGrid');
  const label = $('calendarMonthLabel');
  const prevButton = $('calendarPrevButton');
  const nextButton = $('calendarNextButton');
  if (!grid) return;

  const checkins = state.streaks.checkins || {};
  const year = calendarViewYear;
  const month = calendarViewMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  grid.innerHTML = '';
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayData = checkins[dateStr] || {};
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    cell.textContent = d;
    if (dayData.english && dayData.gym) cell.classList.add('both');
    else if (dayData.english) cell.classList.add('english');
    else if (dayData.gym) cell.classList.add('gym');
    grid.appendChild(cell);
  }

  if (label) {
    const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    label.textContent = monthName;
  }

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  if (nextButton) nextButton.disabled = isCurrentMonth;

  const earliest = getEarliestCheckinMonth();
  if (prevButton) {
    if (earliest) {
      const atEarliest = year < earliest.year || (year === earliest.year && month <= earliest.month);
      prevButton.disabled = atEarliest;
    } else {
      prevButton.disabled = false;
    }
  }
}

function changeCalendarMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth > 11) {
    calendarViewMonth = 0;
    calendarViewYear += 1;
  } else if (calendarViewMonth < 0) {
    calendarViewMonth = 11;
    calendarViewYear -= 1;
  }
  renderCalendar();
}

function evaluateCheckin() {
  const todayData = (state.streaks.checkins || {})[todayKey()] || {};
  const result = $('checkinResult');
  if (!result) return;
  if (isCompleted(todayData.english) && isCompleted(todayData.gym)) {
    result.className = 'checkin-result success';
    result.innerHTML = '<strong>🔥 Both done today.</strong><br>Your old self would be proud.';
  } else if (todayData.english === 0 || todayData.gym === 0) {
    result.className = 'checkin-result fail';
    result.innerHTML = '<strong>Not today.</strong><br>One small action still counts.';
  } else {
    result.className = '';
    result.innerHTML = '';
  }
}

function updateStreaks() {
  renderStreaks();
  renderProgressChart();
  renderThenNow();
}

function saveEnglishData() {
  return saveEnglish(state.english)
    .then(() => {
      showBanner('English progress saved to Firestore.', 'success');
      window.setTimeout(clearBanner, 1200);
    })
    .catch((error) => {
      console.error(error);
      showBanner('Could not save English progress. Please try again.', 'error');
    });
}

function saveGymData() {
  return saveGym(state.gym)
    .then(() => {
      showBanner('Gym progress saved to Firestore.', 'success');
      window.setTimeout(clearBanner, 1200);
    })
    .catch((error) => {
      console.error(error);
      showBanner('Could not save gym progress. Please try again.', 'error');
    });
}

function saveStreaksData() {
  return saveStreaks(state.streaks)
    .then(() => {
      showBanner('Streaks saved to Firestore.', 'success');
      window.setTimeout(clearBanner, 1200);
    })
    .catch((error) => {
      console.error(error);
      showBanner('Could not save streaks. Please try again.', 'error');
    });
}

async function persistEnglishNote(noteText = '') {
  const notesArea = $('englishNotes');
  const text = noteText.trim();

  if (!text) {
    showBanner('Write a note first.', 'info');
    return false;
  }

  const newNote = {
    text,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };
  state.english.notes = [newNote, ...(state.english.notes || [])];
  if (notesArea) notesArea.value = '';
  renderEnglish();
  await saveEnglishData();
  showBanner('Note saved.', 'success');
  return true;
}

function bindRealtime() {
  unsubscribeFns.forEach((unsubscribe) => unsubscribe());
  unsubscribeFns = [
    subscribeToDocument('english', defaultEnglish, (data) => {
      state.english = mergeData(defaultEnglish, data);
      renderEnglish();
      renderGerman();
      renderThenNow();
      renderHoursInvested();
    }, (error) => {
      console.error(error);
      showBanner('Live sync paused. Refresh or check your connection.', 'error');
    }),
    subscribeToDocument('gym', defaultGym, (data) => {
      state.gym = { ...defaultGym, ...(data || {}) };
      state.gym.prs = normalizeGymPrs(state.gym.prs);
      state.gym.weightLog = Array.isArray(state.gym.weightLog) ? state.gym.weightLog : [];
      renderGym();
      renderThenNow();
      renderHoursInvested();
    }, (error) => {
      console.error(error);
      showBanner('Live sync paused. Refresh or check your connection.', 'error');
    }),
    subscribeToDocument('streaks', defaultStreaks, (data) => {
      state.streaks = mergeData(defaultStreaks, data);
      renderStreaks();
      evaluateCheckin();
      updateStreaks();
      renderThenNow();
      renderProgressChart();
    }, (error) => {
      console.error(error);
      showBanner('Live sync paused. Refresh or check your connection.', 'error');
    })
  ];
}

async function loadAllData() {
  setLoadingVisible(true, 'Loading your data from Firestore...');
  renderAll();

  let completed = false;
  const fallbackTimer = window.setTimeout(() => {
    if (!completed) {
      setLoadingVisible(false);
      showBanner('Firestore is taking a while. Showing your current view now.', 'error');
      window.setTimeout(clearBanner, 2500);
    }
  }, 6000);

  try {
    const [english, gym, streaks] = await Promise.all([
      loadEnglish(defaultEnglish),
      loadGym(defaultGym),
      loadStreaks(defaultStreaks)
    ]);

    completed = true;
    clearTimeout(fallbackTimer);

    state.english = mergeData(defaultEnglish, english);
    state.gym = { ...defaultGym, ...(gym || {}) };
    state.gym.prs = normalizeGymPrs(state.gym.prs);
    state.gym.weightLog = Array.isArray(state.gym.weightLog) ? state.gym.weightLog : [];
    state.streaks = mergeData(defaultStreaks, streaks);
    refreshBestStreaks();

    renderAll();
    bindRealtime();
    setLoadingVisible(false);
    showBanner('All data loaded from Firestore.', 'success');
    window.setTimeout(clearBanner, 1500);
  } catch (error) {
    completed = true;
    clearTimeout(fallbackTimer);
    console.error(error);
    setLoadingVisible(false);
    showBanner('Could not load data from Firestore yet. Your page is still available.', 'error');
  }
}

function renderAll() {
  renderEnglish();
  renderGym();
  renderGerman();
  renderStreaks();
  evaluateCheckin();
  renderThenNow();
  renderHoursInvested();
  renderProgressChart();
}

function handleUnlock(event) {
  if (event && !event.isTrusted) {
    event.preventDefault();
    return;
  }

  const passwordInput = $('passwordInput');
  const password = passwordInput ? passwordInput.value.trim() : '';
  if (!password) {
    showLockMessage('Please enter the master password.', 'error');
    return;
  }
  if (password !== MASTER_PASSWORD) {
    showLockMessage('Incorrect password. The website stays locked.', 'error');
    return;
  }
  if (event && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  showLockMessage('Unlocking your private dashboard...', 'info');
  initializeFirebase();
  firebaseReady = true;
  setAppLocked(false);
  renderAll();
  loadAllData();
}

function attachEvents() {
  const unlockButton = $('unlockButton');
  const passwordInput = $('passwordInput');
  if (unlockButton) {
    unlockButton.addEventListener('click', (event) => handleUnlock(event));
  }
  if (passwordInput) {
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        handleUnlock(event);
      }
    });
  }

  const englishLevel = $('englishLevel');
  if (englishLevel) {
    englishLevel.addEventListener('change', () => {
      state.english.level = englishLevel.value;
      renderEnglish();
      saveEnglishData();
    });
  }

  const saveEnglishLevelButton = $('saveEnglishLevelButton');
  if (saveEnglishLevelButton && englishLevel) {
    saveEnglishLevelButton.addEventListener('click', () => {
      state.english.level = englishLevel.value;
      renderEnglish();
      saveEnglishData();
    });
  }

  const resourceInput = $('resourceInput');
  const addResourceButton = $('addResourceButton');
  const addResource = () => {
    const value = resourceInput ? resourceInput.value.trim() : '';
    if (!value) return;
    state.english.resources = [...(state.english.resources || []), value];
    if (resourceInput) resourceInput.value = '';
    renderEnglish();
    saveEnglishData();
  };
  if (addResourceButton) {
    addResourceButton.addEventListener('click', addResource);
  }
  if (resourceInput) {
    resourceInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addResource();
      }
    });
  }

  const saveEnglishNotesButton = $('saveEnglishNotesButton');
  if (saveEnglishNotesButton) {
    saveEnglishNotesButton.addEventListener('click', async () => {
      const notesArea = $('englishNotes');
      const noteText = notesArea ? notesArea.value : '';
      await persistEnglishNote(noteText);
    });
  }

  const saveWeightButton = $('saveWeightButton');
  if (saveWeightButton) {
    saveWeightButton.addEventListener('click', () => {
      state.gym.startWeight = $('startWeight') ? $('startWeight').value : '';
      state.gym.goalWeight = $('goalWeight') ? $('goalWeight').value : '';
      state.gym.currentWeight = $('currentWeight') ? $('currentWeight').value : '';

      const log = Array.isArray(state.gym.weightLog) ? state.gym.weightLog : [];
      const last = log[log.length - 1];
      const newWeight = state.gym.currentWeight;
      if (newWeight && (!last || String(last.weight) !== String(newWeight))) {
        state.gym.weightLog = [
          ...log,
          {
            weight: newWeight,
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          }
        ];
      }

      renderGym();
      renderThenNow();
      saveGymData();
    });
  }

  const saveEnglishHoursButton = $('saveEnglishHoursButton');
  if (saveEnglishHoursButton) {
    saveEnglishHoursButton.addEventListener('click', () => {
      const input = $('englishHoursInput');
      state.english.hours = input ? input.value : 0;
      renderHoursInvested();
      saveEnglishData();
    });
  }

  const saveGymHoursButton = $('saveGymHoursButton');
  if (saveGymHoursButton) {
    saveGymHoursButton.addEventListener('click', () => {
      const input = $('gymHoursInput');
      state.gym.hours = input ? input.value : 0;
      renderHoursInvested();
      saveGymData();
    });
  }

  const tvnSlider = $('tvnSlider');
  if (tvnSlider) {
    const tvnNowPanel = $('tvnNowPanel');
    const tvnDivider = $('tvnDivider');
    tvnSlider.addEventListener('input', () => {
      const v = tvnSlider.value;
      if (tvnNowPanel) tvnNowPanel.style.clipPath = `inset(0 0 0 ${v}%)`;
      if (tvnDivider) tvnDivider.style.left = `${v}%`;
    });
  }

  const calendarPrevButton = $('calendarPrevButton');
  const calendarNextButton = $('calendarNextButton');
  if (calendarPrevButton) {
    calendarPrevButton.addEventListener('click', () => changeCalendarMonth(-1));
  }
  if (calendarNextButton) {
    calendarNextButton.addEventListener('click', () => changeCalendarMonth(1));
  }

  const prLog = $('prLog');
  if (prLog) {
    prLog.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-pr-edit]');
      const deleteButton = event.target.closest('[data-pr-delete]');
      if (editButton) {
        editPr(Number(editButton.getAttribute('data-pr-edit')));
      } else if (deleteButton) {
        deletePr(Number(deleteButton.getAttribute('data-pr-delete')));
      }
    });
  }

  const addPrButton = $('addPrButton');
  if (addPrButton) {
    addPrButton.addEventListener('click', () => {
      const prLift = $('prLift');
      const prWeight = $('prWeight');
      const prReps = $('prReps');
      if (!prLift || !prWeight || !prReps || !prWeight.value || !prReps.value) return;
      const newPr = {
        workout: prLift.value,
        weight: prWeight.value,
        reps: prReps.value,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      };
      state.gym.prs = [newPr, ...(normalizeGymPrs(state.gym.prs || []))];
      if (prWeight) prWeight.value = '';
      if (prReps) prReps.value = '';
      renderGym();
      saveGymData();
    });
  }

  function refreshCheckinButtonStates() {
    const todayData = (state.streaks.checkins || {})[todayKey()] || {};
    const engYes = $('engYes');
    const engNo = $('engNo');
    const gymYes = $('gymYes');
    const gymNo = $('gymNo');
    if (engYes) engYes.classList.toggle('active', isCompleted(todayData.english));
    if (engNo) engNo.classList.toggle('active', todayData.english === 0);
    if (gymYes) gymYes.classList.toggle('active', isCompleted(todayData.gym));
    if (gymNo) gymNo.classList.toggle('active', todayData.gym === 0);
  }

  function commitCheckin(habit, minutes) {
    const key = todayKey();
    const nextCheckins = { ...(state.streaks.checkins || {}) };
    nextCheckins[key] = { ...(nextCheckins[key] || {}), [habit]: minutes };
    state.streaks.checkins = nextCheckins;
    refreshBestStreaks();
    refreshCheckinButtonStates();
    updateStreaks();
    evaluateCheckin();
    saveStreaksData();
  }

  function handleYesClick(habit) {
    const label = habit === 'english' ? 'study' : 'train';
    const todayData = (state.streaks.checkins || {})[todayKey()] || {};
    const existing = todayData[habit];

    if (isCompleted(existing)) {
      const wantsUpdate = window.confirm(
        `You already completed this habit today.\nWould you like to update today's minutes? (Currently ${existing} min)`
      );
      if (!wantsUpdate) return;
      const raw = window.prompt(`Update today's ${label} minutes:`, String(existing));
      if (raw === null) return;
      const minutes = Number(raw);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        showBanner('Please enter a valid number of minutes.', 'error');
        return;
      }
      // Editing an already-completed day only replaces the minutes -
      // it does not increase Total Days or the streak.
      commitCheckin(habit, Math.round(minutes));
      showBanner("Today's minutes updated.", 'success');
      window.setTimeout(clearBanner, 1200);
      return;
    }

    const raw = window.prompt(`How many minutes did you ${label === 'study' ? 'study English' : 'train'} today?`);
    if (raw === null) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      showBanner('Please enter a valid number of minutes.', 'error');
      return;
    }
    commitCheckin(habit, Math.round(minutes));
  }

  function handleNoClick(habit) {
    commitCheckin(habit, 0);
  }

  const engYesButton = $('engYes');
  const engNoButton = $('engNo');
  const gymYesButton = $('gymYes');
  const gymNoButton = $('gymNo');
  if (engYesButton) engYesButton.addEventListener('click', () => handleYesClick('english'));
  if (engNoButton) engNoButton.addEventListener('click', () => handleNoClick('english'));
  if (gymYesButton) gymYesButton.addEventListener('click', () => handleYesClick('gym'));
  if (gymNoButton) gymNoButton.addEventListener('click', () => handleNoClick('gym'));
  refreshCheckinButtonStates();

  const resetEnglishBestButton = $('resetEnglishBestButton');
  if (resetEnglishBestButton) {
    resetEnglishBestButton.addEventListener('click', () => {
      const sure = window.confirm('Reset your English best streak record? This cannot be undone.');
      if (!sure) return;
      state.streaks.best = { ...state.streaks.best, english: 0 };
      renderStreaks();
      saveStreaksData();
    });
  }

  const resetGymBestButton = $('resetGymBestButton');
  if (resetGymBestButton) {
    resetGymBestButton.addEventListener('click', () => {
      const sure = window.confirm('Reset your Gym best streak record? This cannot be undone.');
      if (!sure) return;
      state.streaks.best = { ...state.streaks.best, gym: 0 };
      renderStreaks();
      saveStreaksData();
    });
  }

  const revealButton = $('revealButton');
  if (revealButton) {
    revealButton.addEventListener('click', revealLetter);
  }

  const nextQuoteButton = $('quoteCarousel');
  if (nextQuoteButton) {
    nextQuoteButton.addEventListener('click', nextQuote);
  }

  document.querySelectorAll('.quote-dot').forEach((dot) => {
    dot.addEventListener('click', (event) => {
      showQuote(Number(event.currentTarget.getAttribute('data-index')));
    });
  });

  const closeFocusButton = $('closeFocusButton');
  if (closeFocusButton) {
    closeFocusButton.addEventListener('click', closeFocus);
  }

  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    switch (event.key.toLowerCase()) {
      case 'e':
        document.getElementById('trackers').scrollIntoView({ behavior: 'smooth' });
        break;
      case 'g':
        document.getElementById('trackers').scrollIntoView({ behavior: 'smooth' });
        break;
      case 'd':
        document.getElementById('dream').scrollIntoView({ behavior: 'smooth' });
        break;
      case 'f':
        openFocus('FOCUS');
        break;
      default:
        break;
    }
  });

  const focusButton = $('focusButton');
  if (focusButton) {
    focusButton.addEventListener('click', () => openFocus(focusButton.dataset.title || 'FOCUS'));
  }

  window.addEventListener('focus', () => {
    if (firebaseReady) {
      loadAllData();
    }
  });
}

function openFocus(title) {
  const focusTitle = $('focusTitle');
  const focusOverlay = $('focusOverlay');
  if (focusTitle) focusTitle.textContent = title;
  if (focusOverlay) focusOverlay.classList.add('active');
  startFocusTimer();
}

function closeFocus() {
  const focusOverlay = $('focusOverlay');
  if (focusOverlay) focusOverlay.classList.remove('active');
  clearInterval(focusInterval);
}

function startFocusTimer() {
  let minutes = 25;
  let seconds = 0;
  clearInterval(focusInterval);
  focusInterval = window.setInterval(() => {
    if (seconds === 0) {
      if (minutes === 0) {
        clearInterval(focusInterval);
        return;
      }
      minutes -= 1;
      seconds = 59;
    } else {
      seconds -= 1;
    }
    const focusTimer = $('focusTimer');
    if (focusTimer) {
      focusTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
  }, 1000);
}

function init() {
  createParticles();
  updateAge();
  updateCountdown();
  initObservers();
  shuffleQuotes();
  showQuote(0);
  setAppLocked(true);
  setLoadingVisible(false);
  attachEvents();
  clearBanner();
  window.setInterval(updateAge, 1000);
  updateCountdown();
  renderAll();
}

init();
