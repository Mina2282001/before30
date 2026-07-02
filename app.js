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
  prs: []
};

const defaultStreaks = {
  english: 0,
  gym: 0,
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
      ? prs.map((entry) => `
          <div class="pr-item">
            <div><strong>${entry.workout}</strong><br><span>${entry.weight} kg × ${entry.reps} reps</span></div>
            <div style="text-align:right;color:var(--accent);font-size:0.8rem;">${entry.date}</div>
          </div>
        `).join('')
      : '<div class="notes-empty">No personal records yet.</div>';
  }
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

function renderStreaks() {
  const checkins = state.streaks.checkins || {};
  const dates = Object.keys(checkins).sort();
  let engStreak = 0;
  let gymStreak = 0;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (checkins[dates[i]].english) {
      engStreak += 1;
    } else {
      break;
    }
  }
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (checkins[dates[i]].gym) {
      gymStreak += 1;
    } else {
      break;
    }
  }
  const studyStreak = $('studyStreak');
  const gymStreakEl = $('gymStreak');
  if (studyStreak) studyStreak.textContent = engStreak;
  if (gymStreakEl) gymStreakEl.textContent = gymStreak;

  const grid = $('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
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
}

function evaluateCheckin() {
  const today = new Date().toISOString().split('T')[0];
  const todayData = (state.streaks.checkins || {})[today] || {};
  const result = $('checkinResult');
  if (!result) return;
  if (todayData.english === true && todayData.gym === true) {
    result.className = 'checkin-result success';
    result.innerHTML = '<strong>🔥 Both done today.</strong><br>Your old self would be proud.';
  } else if (todayData.english === false || todayData.gym === false) {
    result.className = 'checkin-result fail';
    result.innerHTML = '<strong>Not today.</strong><br>One small action still counts.';
  } else {
    result.className = '';
    result.innerHTML = '';
  }
}

function updateStreaks() {
  state.streaks.english = 0;
  state.streaks.gym = 0;
  const checkins = state.streaks.checkins || {};
  const dates = Object.keys(checkins).sort();
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (checkins[dates[i]].english) {
      state.streaks.english += 1;
    } else {
      break;
    }
  }
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (checkins[dates[i]].gym) {
      state.streaks.gym += 1;
    } else {
      break;
    }
  }
  renderStreaks();
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
    }, (error) => {
      console.error(error);
      showBanner('Live sync paused. Refresh or check your connection.', 'error');
    }),
    subscribeToDocument('gym', defaultGym, (data) => {
      state.gym = { ...defaultGym, ...(data || {}) };
      state.gym.prs = normalizeGymPrs(state.gym.prs);
      renderGym();
    }, (error) => {
      console.error(error);
      showBanner('Live sync paused. Refresh or check your connection.', 'error');
    }),
    subscribeToDocument('streaks', defaultStreaks, (data) => {
      state.streaks = mergeData(defaultStreaks, data);
      renderStreaks();
      evaluateCheckin();
      updateStreaks();
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
    state.streaks = mergeData(defaultStreaks, streaks);

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
      renderGym();
      saveGymData();
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

  document.querySelectorAll('.checkin-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.id.includes('eng') ? 'english' : 'gym';
      const done = button.classList.contains('yes');
      const today = new Date().toISOString().split('T')[0];
      const nextCheckins = { ...(state.streaks.checkins || {}) };
      nextCheckins[today] = { ...(nextCheckins[today] || {}), [type]: done };
      state.streaks.checkins = nextCheckins;
      $('engYes').classList.toggle('active', (nextCheckins[today].english || false));
      $('engNo').classList.toggle('active', nextCheckins[today].english === false);
      $('gymYes').classList.toggle('active', (nextCheckins[today].gym || false));
      $('gymNo').classList.toggle('active', nextCheckins[today].gym === false);
      updateStreaks();
      evaluateCheckin();
      saveStreaksData();
    });
  });

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
