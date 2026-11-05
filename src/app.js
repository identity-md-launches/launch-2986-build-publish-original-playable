// Hamster Pacer: Echo. DOM, canvas and game loop. Pure rules live in logic.js.
import {
  API,
  DAY_MS,
  REST_RPM,
  STATUS_MAX_AGE_MS,
  accuracy,
  buildRuns,
  cleanName,
  clamp,
  createScore,
  frameGrade,
  letterGrade,
  liveOf,
  makeTrack,
  nextStreak,
  pacerNumber,
  penalizeRestTap,
  pickDaily,
  playerRpm,
  readAllPages,
  readingOnline,
  readingUsable,
  rpmAt,
  scoreFrame,
  segmentGrades,
  shareText,
  utcDay,
  withTimeout,
} from './logic.js';

const STORE_KEY = 'hamster-pacer-echo.v1';
const PAGE_TIMEOUT_MS = 20000;
const PAGE_RETRY_DELAYS_MS = [1000, 3000];
const RUNS_MAX_AGE_MS = 60000; // opening Daily reads newer pages once the list is this old
const STATUS_EVERY_MS = 5000;
const STATUS_TIMEOUT_MS = 8000;
const LULLABY_S = 60;
const SETLIST_SIZE = 20;

const STICKERS = [
  { id: 'first-track', name: 'First echo', how: 'Finish any track.', hue: '#ffb547' },
  { id: 'first-gold', name: 'Gold run', how: 'Finish a track with half its time in gold.', hue: '#ffd36b' },
  { id: 'flow5', name: 'Full flow', how: 'Reach Flow x5.', hue: '#74f0c4' },
  { id: 'perfect', name: 'Perfect pace', how: 'Score 100% on a track.', hue: '#fff1c2' },
  { id: 'daily1', name: 'Daily pacer', how: 'Finish a Daily Track.', hue: '#ff9f6b' },
  { id: 'streak5', name: 'Five-day streak', how: 'Finish the Daily Track 5 days in a row.', hue: '#ff7a6b' },
  { id: 'setlist5', name: 'Crate digger', how: 'Finish 5 different Setlist tracks.', hue: '#c9a3ff' },
  { id: 'duet2', name: 'Duet partner', how: 'Keep a Live Duet going for 2 minutes.', hue: '#8fd3ff' },
  { id: 'block', name: 'Block witness', how: 'See a Squeek block land during a Duet.', hue: '#b9f27a' },
  { id: 'lullaby', name: 'Good roommate', how: 'Stay quiet for 60 seconds in Lullaby.', hue: '#f3e3b0' },
];

const TUTORIAL = [
  ['Trace his speed', "The amber line is a real run from Squeektoshi's wheel. Tap Space or the pad to draw your own mint line."],
  ['Keep it close', 'Within 8% of his speed is gold, within 20% is silver. Hold gold to build Flow up to x5.'],
  ['Let him rest', 'When his line drops to zero he paused. Stop tapping until he runs again; taps during a pause cost Flow.'],
];

const $ = (sel) => document.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

// ---------- storage ----------

function defaults() {
  return {
    name: '',
    best: {},
    stickers: {},
    daily: { last: null, streak: 0 },
    setlistDone: [],
    sound: true,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    tutorial: false,
  };
}

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...defaults(), ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return defaults();
  }
}

const store = loadStore();
store.name = cleanName(store.name || '');

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or full storage: progress lives for this visit only.
  }
}

function award(id) {
  if (store.stickers[id]) return;
  store.stickers[id] = new Date().toISOString();
  save();
  const s = STICKERS.find((x) => x.id === id);
  toast(`Sticker earned: ${s ? s.name : id}`);
  renderStickers();
}

// ---------- formatting ----------

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const fmtDate = (ms) => dateFmt.format(ms);
const fmtWhen = (ms) => `${dateFmt.format(ms)}, ${timeFmt.format(ms)} UTC`;
const fmtLen = (s) => {
  const total = Math.max(1, Math.round(s));
  const m = Math.floor(total / 60);
  const r = total % 60;
  return m ? `${m} min ${r} s` : `${r} s`;
};
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

// ---------- toast, sound, motion ----------

// Toasts wait their turn, so one announcement never replaces another before it can be read.
const toastQueue = [];
let toastBusy = false;
function toast(text) {
  if (toastQueue.includes(text)) return;
  toastQueue.push(text);
  if (!toastBusy) nextToast();
}

function nextToast() {
  const t = $('#toast');
  if (!toastQueue.length) {
    toastBusy = false;
    t.classList.remove('show');
    return;
  }
  toastBusy = true;
  t.textContent = toastQueue.shift();
  t.classList.add('show');
  setTimeout(nextToast, 2800);
}

let audio = null;
function tick() {
  if (!store.sound) return;
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch {
    // No Web Audio: play silently.
  }
}

function applySettings() {
  $('#sound-btn').setAttribute('aria-pressed', String(store.sound));
  $('#motion-btn').setAttribute('aria-pressed', String(store.reduced));
  document.documentElement.classList.toggle('reduce-motion', store.reduced);
  updateWheel();
}

// ---------- data ----------

const state = {
  runs: [],
  pages: [],
  daily: null,
  dailyDay: null, // the UTC day state.daily was chosen for
  runsLoading: true,
  runsPage: 0,
  runsError: null,
  runsAt: 0,
  live: null,
  liveAt: 0,
  statusError: null,
};

async function getJSON(url, timeoutMs) {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Network errors, timeouts, rate limits and server errors get two more tries; a bad request does not.
async function readRunsPage(cursor) {
  const q = new URLSearchParams({ limit: '100' });
  if (cursor != null) q.set('cursor', cursor);
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJSON(`${API}/measurement/runs?${q}`, PAGE_TIMEOUT_MS);
    } catch (err) {
      const retryable = err.status == null || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= PAGE_RETRY_DELAYS_MS.length) throw err;
      await wait(PAGE_RETRY_DELAYS_MS[attempt]);
    }
  }
}

const runsSignature = () => {
  const newest = state.runs[state.runs.length - 1];
  return [state.runs.length, state.daily && state.daily.id, state.daily && state.daily.durS, newest && newest.id, newest && newest.durS].join('|');
};

let runsJob = null;

// Reads the full history once, then only the newest pages. A new UTC day or a retry blocks Daily and
// Setlist until the read ends, so no track is offered under a Pacer number it does not belong to.
function refreshRuns({ blocking = false } = {}) {
  if (runsJob) return runsJob;
  const today = utcDay(Date.now());
  const block = blocking || state.dailyDay !== today;
  if (block) {
    state.dailyDay = today;
    state.daily = null;
    state.runsLoading = true;
    state.runsError = null;
    state.runsPage = 0;
    renderDaily();
    renderSetlist();
  }
  runsJob = (async () => {
    const before = runsSignature();
    try {
      const read = (known) =>
        readAllPages(readRunsPage, known, (count) => {
          state.runsPage = count;
          if (state.runsLoading && count % 5 === 0) renderDaily();
        });
      // If the API refuses a remembered cursor, read the history again from its start.
      const { pages, meta } = await read(state.pages).catch((err) => {
        if (!state.pages.length || !(err.status >= 400 && err.status < 500)) throw err;
        return read([]);
      });
      state.pages = pages;
      state.runs = buildRuns(pages.flatMap((p) => p.items));
      const observed = Date.parse(meta.latestObservedAt || meta.coverageThroughAt) || Date.now();
      state.daily = pickDaily(state.runs, today * DAY_MS, observed);
      state.dailyDay = today;
      state.runsAt = Date.now();
      state.runsError = null;
    } catch (err) {
      // A failed background read keeps the list on screen; a blocking one says the modes are off.
      if (block) state.runsError = err instanceof Error ? err.message : String(err);
    }
    state.runsLoading = false;
    runsJob = null;
    if (block || before !== runsSignature()) {
      renderDaily();
      renderSetlist();
    }
  })();
  return runsJob;
}

// Runs when Daily opens, so it never offers a selection another tab would no longer make.
function syncDaily() {
  if (state.dailyDay !== utcDay(Date.now())) refreshRuns();
  else if (!state.runsError && Date.now() - state.runsAt > RUNS_MAX_AGE_MS) refreshRuns();
}

function startDaily() {
  if (state.dailyDay !== utcDay(Date.now())) {
    refreshRuns();
    return;
  }
  if (state.daily) startTrack(state.daily, 'daily');
}

const retryRuns = () => refreshRuns({ blocking: true });

async function pollStatus() {
  const started = Date.now();
  try {
    const json = await getJSON(`${API}/status`, STATUS_TIMEOUT_MS);
    const live = liveOf(json);
    state.live = live;
    state.liveAt = Date.now();
    state.statusError = live.core ? null : 'the status response had no coreStatus';
  } catch (err) {
    state.live = null;
    state.statusError = err instanceof Error ? err.message : String(err);
  }
  try {
    onStatus();
  } finally {
    setTimeout(pollStatus, Math.max(0, STATUS_EVERY_MS - (Date.now() - started)));
  }
}

const liveUsable = () => !state.statusError && readingUsable(state.live, state.liveAt, Date.now());
const liveFresh = () => !state.statusError && readingOnline(state.live, state.liveAt, Date.now());
const duetReady = () => liveFresh() && state.live.core === 'ACTIVE' && state.live.rpm != null;
const lullabyReady = () => liveFresh() && state.live.core === 'IDLE';

function onStatus() {
  updateWheel();
  if (game && game.mode === 'duet' && !game.ended) duetStatus();
  if (currentView === 'live' && !game) renderLive();
}

// Runs every second: drops a reading once updates stop, and notices a new UTC day.
function clockTick() {
  if (state.live && !liveUsable()) {
    state.live = null;
    state.statusError = state.statusError || `no update for ${STATUS_MAX_AGE_MS / 1000} seconds`;
    onStatus();
  }
  if (!runsJob && state.dailyDay !== utcDay(Date.now())) refreshRuns();
}

function updateWheel() {
  const label = $('#wheel-label');
  const spokes = $('#wheel-spokes');
  const rpm = liveFresh() && state.live.rpm ? state.live.rpm : 0;
  if (!liveUsable()) label.textContent = 'Live data unavailable';
  else if (!liveFresh()) label.textContent = `Live data ${state.live.freshness || 'not fresh'}`;
  else if (state.live.core === 'ACTIVE') label.textContent = `Running ${Math.round(rpm)} RPM`;
  else if (state.live.core === 'IDLE') label.textContent = 'Resting';
  else if (state.live.core === 'COUNTER_FAULT') label.textContent = 'Counter fault';
  else label.textContent = state.live.core;
  const spin = rpm > 0 && !store.reduced;
  spokes.classList.toggle('spin', spin);
  spokes.style.animationDuration = spin ? `${clamp(60 / rpm, 0.2, 6).toFixed(2)}s` : '';
}

// ---------- views ----------

const VIEWS = ['daily', 'setlist', 'live', 'stickers'];
let currentView = 'daily';

function showView(name) {
  if (!VIEWS.includes(name)) name = 'daily';
  if (game) quitGame(false);
  currentView = name;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
  for (const a of document.querySelectorAll('.modes a')) {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (name === 'live') renderLive();
  else stopLullaby();
  if (name === 'stickers') renderStickers();
  if (name === 'setlist') renderSetlist();
  if (name === 'daily') {
    syncDaily();
    renderDaily(); // sparklines need a visible box to size against
  }
}

function bestLine(run) {
  const b = store.best[run.id];
  return b ? `Your best: ${b.grade}, ${b.acc}%, ${fmtInt(b.score)} points` : 'Not played yet';
}

function runFacts(run) {
  return `${fmtWhen(run.start)}. ${fmtLen(run.durS)}, top ${Math.round(run.top)} RPM.`;
}

function renderDaily() {
  const root = $('#view-daily');
  root.replaceChildren();
  const day = state.dailyDay ?? utcDay(Date.now());
  root.append(h('h2', { text: `Pacer #${pacerNumber(day * DAY_MS)}` }));
  if (state.runsLoading) {
    root.append(h('p', { class: 'muted', text: `Loading recorded runs${state.runsPage ? ` (page ${state.runsPage})` : ''}…` }));
    root.append(h('button', { type: 'button', class: 'btn', disabled: true, text: 'Play Daily Track' }));
    return;
  }
  if (state.runsError) {
    root.append(
      h('p', { class: 'warn', text: `Recorded runs could not be loaded (${state.runsError}). Daily Track and Setlist need them, so they are off for now.` }),
      h('button', { type: 'button', class: 'btn', text: 'Try loading again', onclick: retryRuns }),
    );
    return;
  }
  const run = state.daily;
  if (run) {
    const card = h(
      'div',
      { class: 'daily' },
      h(
        'div',
        { class: 'daily-copy' },
        h('p', { text: `Yesterday’s longest run. ${runFacts(run)}` }),
        h('button', { type: 'button', class: 'btn big', text: 'Play Daily Track', onclick: startDaily }),
        h('p', { class: 'muted small', text: 'Tap Space or the pad. Stop when he pauses.' }),
        h('p', { class: 'muted small', text: `${bestLine(run)}. Daily streak: ${store.daily.streak} days.` }),
      ),
      sparkCanvas(run, 'spark big-spark'),
    );
    root.append(card);
    return;
  }
  const yesterday = (day - 1) * DAY_MS;
  const newest = state.runs[state.runs.length - 1];
  const kids = [
    h('p', { class: 'warn', text: `No completed run on ${fmtDate(yesterday)} (UTC), so no Daily Track today.` }),
  ];
  if (newest) {
    kids.push(
      h('p', { text: `His newest run: ${runFacts(newest)}` }),
      h('button', { type: 'button', class: 'btn big', text: 'Play newest run', onclick: () => startTrack(newest, 'setlist') }),
      h('p', { class: 'muted small', text: 'Tap Space or the pad. Stop when he pauses.' }),
    );
  } else {
    kids.push(h('p', { class: 'muted', text: 'The API has no recorded runs yet. Check Live to see what he is doing now.' }));
  }
  root.append(h('div', { class: 'daily' }, h('div', { class: 'daily-copy' }, kids), newest ? sparkCanvas(newest, 'spark big-spark') : null));
}

function renderSetlist() {
  const root = $('#view-setlist');
  root.replaceChildren(h('h2', { text: 'Setlist' }));
  if (state.runsLoading) {
    root.append(h('p', { class: 'muted', text: 'Loading recorded runs…' }));
    return;
  }
  if (state.runsError) {
    root.append(
      h('p', { class: 'warn', text: `Recorded runs could not be loaded (${state.runsError}).` }),
      h('button', { type: 'button', class: 'btn', text: 'Try loading again', onclick: retryRuns }),
    );
    return;
  }
  const runs = state.runs.slice(-SETLIST_SIZE).reverse();
  if (!runs.length) {
    root.append(h('p', { class: 'muted', text: 'The API has no recorded runs yet.' }));
    return;
  }
  root.append(h('p', { class: 'muted', text: `His last ${runs.length} recorded runs, newest first.` }));
  const list = h('ul', { class: 'setlist' });
  for (const run of runs) {
    const best = store.best[run.id];
    list.append(
      h(
        'li',
        {},
        sparkCanvas(run, 'spark'),
        h(
          'div',
          { class: 'set-copy' },
          h('b', { text: fmtWhen(run.start) }),
          h('span', { class: 'muted small', text: `${fmtLen(run.durS)}, top ${Math.round(run.top)} RPM` }),
        ),
        h('span', { class: 'badge', 'data-grade': best ? best.grade : 'none', text: best ? `Best ${best.grade}` : 'New' }),
        h('button', {
          type: 'button',
          class: 'btn small-btn',
          'aria-label': `Play run from ${fmtWhen(run.start)}`,
          text: 'Play',
          onclick: () => startTrack(run, 'setlist'),
        }),
      ),
    );
  }
  root.append(list);
}

function sparkCanvas(run, cls) {
  const c = h('canvas', { class: cls, 'aria-hidden': 'true' });
  requestAnimationFrame(() => drawSpark(c, run.rpm));
  return c;
}

function fitCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const hgt = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== hgt) {
    c.width = w;
    c.height = hgt;
  }
  return { w: r.width, h: r.height, dpr };
}

function drawSpark(c, values) {
  if (!c.isConnected) return;
  const { w, h: ht, dpr } = fitCanvas(c);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, ht);
  const max = Math.max(1, ...values) * 1.15;
  ctx.strokeStyle = '#ffb547';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const n = values.length;
  for (let x = 0; x <= w; x += 2) {
    const v = values[Math.min(n - 1, Math.floor((x / w) * n))];
    const y = ht - 3 - (v / max) * (ht - 6);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---------- live: duet or lullaby ----------

let lullaby = null;

function renderLive() {
  const root = $('#view-live');
  if (!state.live && !state.statusError) {
    root.replaceChildren(h('h2', { text: 'Live' }), h('p', { class: 'muted', text: 'Checking what the wheel is doing…' }));
    return;
  }
  if (!liveUsable()) {
    stopLullaby();
    root.replaceChildren(
      h('h2', { text: 'Live' }),
      h('p', { class: 'warn', text: `Live status is unavailable right now (${state.statusError || 'no recent update'}). Live Duet and Lullaby are off until it returns. Checking again every 5 seconds.` }),
    );
    return;
  }
  const live = state.live;
  if (!liveFresh() && live.core !== 'COUNTER_FAULT') {
    stopLullaby();
    root.replaceChildren(
      h('h2', { text: 'Live' }),
      h('p', { class: 'warn', text: `The wheel's data is ${live.freshness || 'of unknown freshness'}, not online, so it may be out of date. Live Duet and Lullaby are off until fresh readings return. Checking again every 5 seconds.` }),
    );
    return;
  }
  if (live.core === 'ACTIVE') {
    stopLullaby();
    const ready = duetReady();
    root.replaceChildren(
      h('h2', { text: 'Live Duet' }),
      h('p', { text: ready ? `He is running right now at ${Math.round(live.rpm)} RPM. Pace him as it happens. Every new Squeek block during the duet pays 250 points times your Flow.` : 'He is running, but the status API sent no speed reading.' }),
      h('button', { type: 'button', class: 'btn big', disabled: !ready, text: 'Start Live Duet', onclick: startDuet }),
      h('p', {
        class: 'muted small',
        text: ready ? `Data is ${live.freshness}. The curve updates every 5 seconds from the status API.` : 'The duet waits for a speed reading.',
      }),
    );
    return;
  }
  if (live.core === 'IDLE') {
    if (!lullaby) startLullaby();
    else updateLullaby();
    return;
  }
  stopLullaby();
  root.replaceChildren(
    h('h2', { text: live.core === 'COUNTER_FAULT' ? 'Counter fault' : 'Live' }),
    h('p', {
      class: 'warn',
      text:
        live.core === 'COUNTER_FAULT'
          ? 'The wheel counter reports a fault, so live play is off. Recorded tracks in Daily and Setlist still work.'
          : `The wheel reports an unknown state (${live.core}), so live play is off.`,
    }),
  );
}

function startLullaby() {
  const root = $('#view-live');
  root.replaceChildren(
    h(
      'div',
      { class: 'lullaby' },
      moonSvg(),
      h('div', { class: 'breath', 'aria-hidden': 'true' }),
      h('h2', { text: 'Lullaby' }),
      h('p', { text: 'He is resting, so Live Duet sleeps too. Stay quiet with him for one minute: no taps, no keys.' }),
      h('p', { class: 'lull-time num', id: 'lull-time', text: '1:00' }),
      h('p', { class: 'muted small', id: 'lull-note', text: 'Breathe with the circle. Nothing here is timed against you.' }),
    ),
  );
  lullaby = { since: performance.now(), timer: setInterval(updateLullaby, 1000) };
  updateLullaby();
}

function updateLullaby() {
  if (!lullaby) return;
  if (!lullabyReady()) {
    renderLive(); // replaces the moon with the reason, and no sticker is earned on old data
    return;
  }
  const left = Math.max(0, LULLABY_S - (performance.now() - lullaby.since) / 1000);
  const time = $('#lull-time');
  const note = $('#lull-note');
  if (!time || !note) return;
  if (store.stickers.lullaby && left === 0) {
    time.textContent = 'Sweet dreams';
  } else {
    time.textContent = `0:${String(Math.ceil(left)).padStart(2, '0')}`.replace('0:60', '1:00');
  }
  if (left === 0 && !store.stickers.lullaby) {
    award('lullaby');
    note.textContent = 'You earned the Good roommate sticker. Stay as long as you like.';
  }
}

function hushLullaby() {
  if (!lullaby || (performance.now() - lullaby.since) / 1000 >= LULLABY_S) return;
  lullaby.since = performance.now();
  const note = $('#lull-note');
  if (note) note.textContent = 'No rush. The quiet minute starts again whenever you are ready.';
  updateLullaby();
}

function stopLullaby() {
  if (!lullaby) return;
  clearInterval(lullaby.timer);
  lullaby = null;
}

function moonSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'moon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<circle cx="32" cy="32" r="22" fill="#f3e3b0"/><circle cx="42" cy="24" r="20" fill="#2a1d15"/>' +
    '<rect x="50" y="44" width="3" height="3" fill="#f3e3b0"/><rect x="8" y="10" width="2" height="2" fill="#f3e3b0"/>';
  return svg;
}

// ---------- stickers ----------

function renderStickers() {
  const list = $('#sticker-list');
  list.replaceChildren();
  let got = 0;
  for (const s of STICKERS) {
    const when = store.stickers[s.id];
    if (when) got++;
    list.append(
      h(
        'li',
        { class: when ? 'got' : 'locked', style: `--hue:${s.hue}` },
        h('span', { class: 'sticker-art', 'aria-hidden': 'true' }),
        h('b', { text: s.name }),
        h('span', { class: 'muted small', text: when ? `Earned ${fmtDate(Date.parse(when))}` : s.how }),
      ),
    );
  }
  $('#sticker-count').textContent = `${got} of ${STICKERS.length} collected`;
  $('#streak-line').textContent = `Daily streak: ${store.daily.streak} ${store.daily.streak === 1 ? 'day' : 'days'}`;
}

// ---------- game ----------

let game = null;

function enterPlay(title) {
  document.body.classList.add('is-playing');
  $('#play').hidden = false;
  $('#play-title').textContent = title;
  $('#result').hidden = true;
  $('#pad').hidden = false;
  $('#play-hint').hidden = false;
  $('#hud-grade').textContent = 'Get ready';
  $('#hud-grade').dataset.grade = 'ready';
  $('#pad').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function startTrack(run, kind) {
  stopLullaby();
  const track = makeTrack(run);
  // A session keeps its day: finishing after UTC midnight still credits the Pacer it started as.
  const startedAt = Date.now();
  const pacer = pacerNumber(startedAt);
  const title = kind === 'daily' ? `Pacer #${pacer}` : `Run of ${fmtWhen(run.start)}`;
  game = {
    mode: 'track',
    kind,
    title,
    day: utcDay(startedAt),
    pacer,
    track,
    maxRpm: track.maxRpm,
    taps: [],
    hist: [],
    s: createScore(10, track.playS),
    t: -3,
    last: performance.now(),
    target: null,
    restStart: null,
    lastTapT: -Infinity,
    lastPenalty: 0,
    ended: false,
    raf: 0,
  };
  enterPlay(title);
  $('#play-hint').textContent = 'Tap Space or the pad to match the amber line. Stop tapping when it drops to zero.';
  game.raf = requestAnimationFrame(frame);
}

function startDuet() {
  if (!duetReady()) return;
  stopLullaby();
  game = {
    mode: 'duet',
    kind: 'duet',
    title: 'Live Duet',
    maxRpm: Math.max(60, state.live.rpm * 1.4),
    samples: [{ t: 0, rpm: state.live.rpm }],
    lastBlock: state.live.block,
    blocks: [],
    bonus: 0,
    taps: [],
    hist: [],
    s: createScore(0, 0),
    t: 0,
    last: performance.now(),
    target: null,
    restStart: null,
    lastTapT: -Infinity,
    lastPenalty: 0,
    ended: false,
    raf: 0,
  };
  enterPlay('Live Duet');
  $('#play-hint').textContent = 'Live from the wheel, updated every 5 seconds. Tap Space or the pad to pace him. Use Quit to end the duet.';
  game.raf = requestAnimationFrame(frame);
}

function duetStatus() {
  if (!duetReady()) {
    let reason = 'He stopped running, so the duet is over.';
    if (!liveUsable()) reason = `Live data is unavailable (${state.statusError || 'no recent update'}), so the duet is over.`;
    else if (!liveFresh()) reason = `The wheel's data went ${state.live.freshness || 'out of date'}, so the duet is over.`;
    else if (state.live.core === 'ACTIVE') reason = 'The status API stopped sending his speed, so the duet is over.';
    finish(reason);
    return;
  }
  game.samples.push({ t: game.t, rpm: state.live.rpm });
  game.maxRpm = Math.max(game.maxRpm, state.live.rpm * 1.3);
  const b = state.live.block;
  if (b != null && game.lastBlock != null && b > game.lastBlock) {
    const count = b - game.lastBlock;
    const bonus = 250 * game.s.flow * count;
    game.s.score += bonus;
    game.bonus += bonus;
    for (let n = game.lastBlock + 1; n <= b; n++) game.blocks.push(n);
    toast(count === 1 ? `Squeek block #${b} landed. +${fmtInt(bonus)}` : `Squeek blocks #${game.lastBlock + 1} to #${b} landed. +${fmtInt(bonus)}`);
    award('block');
  }
  if (b != null) game.lastBlock = b;
}

function duetTarget(t) {
  const s = game.samples;
  const b = s[s.length - 1];
  const a = s[s.length - 2] || b;
  const f = clamp((t - b.t) / 1.5, 0, 1);
  return a.rpm + (b.rpm - a.rpm) * f;
}

function onTap() {
  if (!game || game.ended) return;
  const now = performance.now();
  game.taps.push(now);
  if (game.taps.length > 64) game.taps.splice(0, game.taps.length - 64);
  game.lastTapT = game.t;
  tick();
  const pad = $('#pad');
  pad.classList.remove('hit');
  void pad.offsetWidth;
  pad.classList.add('hit');
  if (game.t >= 0 && game.target != null && game.target < REST_RPM && now - game.lastPenalty > 600) {
    game.lastPenalty = now;
    penalizeRestTap(game.s);
    toast('Shh, he paused. Tapping now costs Flow.');
  }
}

function frame(now) {
  if (!game || game.ended) return;
  const dt = Math.min(0.1, (now - game.last) / 1000);
  game.last = now;
  game.t += dt;
  const p = playerRpm(game.taps, now);
  let grade = 'ready';
  if (game.mode === 'track') {
    if (game.t >= game.track.playS) {
      finish();
      return;
    }
    game.target = game.t >= 0 ? rpmAt(game.track, game.t) : rpmAt(game.track, 0);
  } else {
    game.target = duetTarget(game.t);
  }
  if (game.t >= 0) {
    if (game.target < REST_RPM) {
      if (game.restStart === null) game.restStart = game.t;
      grade = game.lastTapT >= game.restStart && game.t - game.lastTapT < 1.5 ? 'miss' : 'rest';
    } else {
      game.restStart = null;
      grade = frameGrade(game.target, p);
    }
    scoreFrame(game.s, grade === 'rest' ? 'gold' : grade, dt, game.t);
    if (game.s.flow === 5) award('flow5');
  }
  game.hist.push({ t: game.t, p, target: game.target });
  while (game.hist.length && game.hist[0].t < game.t - 12) game.hist.shift();
  updateHud(p, grade);
  drawScope();
  game.raf = requestAnimationFrame(frame);
}

const GRADE_TEXT = { ready: 'Get ready', gold: 'Gold', silver: 'Silver', miss: 'Miss', rest: 'He paused, stay still' };

function updateHud(p, grade) {
  $('#hud-score').textContent = fmtInt(game.s.score);
  $('#hud-flow').textContent = `x${game.s.flow}`;
  $('#hud-you').textContent = String(Math.round(p));
  $('#hud-him').textContent = String(Math.round(game.target || 0));
  const g = $('#hud-grade');
  const text = game.t < 0 ? `Starts in ${Math.ceil(-game.t)}` : GRADE_TEXT[grade];
  if (g.textContent !== text) g.textContent = text;
  g.dataset.grade = game.t < 0 ? 'ready' : grade;
  const pct = game.mode === 'track' ? clamp(game.t / game.track.playS, 0, 1) * 100 : 100;
  $('#hud-progress').style.width = `${pct}%`;
}

function drawScope() {
  const c = $('#scope');
  const { w, h: ht, dpr } = fitCanvas(c);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, ht);
  const span = w < 600 ? 9 : 14;
  const pps = w / span;
  const headX = game.mode === 'track' ? w * 0.35 : w * 0.82;
  const top = 16;
  const bottom = ht - 22;
  const maxY = game.maxRpm;
  const y = (v) => bottom - (clamp(v, 0, maxY) / maxY) * (bottom - top);
  const tAt = (x) => game.t + (x - headX) / pps;

  // seismograph grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,181,71,0.09)';
  ctx.beginPath();
  const firstSec = Math.floor(tAt(0));
  for (let s = firstSec; s <= tAt(w) + 1; s++) {
    const x = headX + (s - game.t) * pps;
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
  }
  const stepY = maxY > 150 ? 50 : 20;
  for (let v = 0; v <= maxY; v += stepY) {
    ctx.moveTo(0, Math.round(y(v)) + 0.5);
    ctx.lineTo(w, Math.round(y(v)) + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(245,233,216,0.6)';
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  for (let v = stepY; v <= maxY; v += stepY) ctx.fillText(`${v}`, 6, y(v) - 4);
  ctx.fillText('RPM', 6, ht - 6);

  // his curve with the gold band
  const pts = [];
  if (game.mode === 'track') {
    for (let x = 0; x <= w; x += 3) {
      const t = tAt(x);
      if (t < 0 || t > game.track.playS) pts.push(null);
      else pts.push({ x, v: rpmAt(game.track, t) });
    }
  } else {
    for (const s of game.hist) pts.push({ x: headX + (s.t - game.t) * pps, v: s.target });
  }
  ctx.fillStyle = 'rgba(243,227,176,0.07)';
  for (const p of pts) if (p && p.v < REST_RPM) ctx.fillRect(p.x - 2, top, 4, bottom - top);
  ctx.fillStyle = 'rgba(255,181,71,0.14)';
  let open = false;
  const band = [];
  for (const p of pts) {
    if (!p || p.v < REST_RPM) {
      if (band.length) drawBand(ctx, band, y);
      band.length = 0;
      continue;
    }
    band.push(p);
  }
  if (band.length) drawBand(ctx, band, y);

  ctx.save();
  ctx.strokeStyle = '#ffb547';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,181,71,0.7)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  open = false;
  for (const p of pts) {
    if (!p) {
      open = false;
      continue;
    }
    if (!open) ctx.moveTo(p.x, y(p.v));
    else ctx.lineTo(p.x, y(p.v));
    open = true;
  }
  ctx.stroke();

  // player line
  ctx.strokeStyle = '#74f0c4';
  ctx.shadowColor = 'rgba(116,240,196,0.7)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  open = false;
  for (const s of game.hist) {
    const x = headX + (s.t - game.t) * pps;
    if (x < 0) continue;
    if (!open) ctx.moveTo(x, y(s.p));
    else ctx.lineTo(x, y(s.p));
    open = true;
  }
  ctx.stroke();
  ctx.restore();

  // playhead
  ctx.strokeStyle = 'rgba(245,233,216,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(Math.round(headX) + 0.5, top);
  ctx.lineTo(Math.round(headX) + 0.5, bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  const last = game.hist[game.hist.length - 1];
  if (last) {
    dot(ctx, headX, y(game.target || 0), '#ffb547');
    dot(ctx, headX, y(last.p), '#74f0c4');
  }
  if (game.target != null && game.target < REST_RPM && game.t >= 0) {
    ctx.fillStyle = '#f3e3b0';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('He paused. Stay still.', Math.min(headX + 12, w - 180), top + 22);
  }
}

function drawBand(ctx, band, y) {
  ctx.beginPath();
  band.forEach((p, i) => (i ? ctx.lineTo(p.x, y(p.v * 1.08)) : ctx.moveTo(p.x, y(p.v * 1.08))));
  for (let i = band.length - 1; i >= 0; i--) ctx.lineTo(band[i].x, y(band[i].v * 0.92));
  ctx.closePath();
  ctx.fill();
}

function dot(ctx, x, yy, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, yy, 5, 0, Math.PI * 2);
  ctx.fill();
}

function finish(reason) {
  if (!game || game.ended) return;
  game.ended = true;
  cancelAnimationFrame(game.raf);
  const s = game.s;
  const acc = accuracy(s);
  const accShown = Math.floor(acc);
  const grade = letterGrade(acc);
  const perfect = s.time.silver === 0 && s.time.miss === 0 && s.time.gold > 0;

  if (game.mode === 'track') {
    const id = game.track.run.id;
    const prev = store.best[id];
    if (!prev || s.score > prev.score) store.best[id] = { score: Math.round(s.score), acc: accShown, grade };
    award('first-track');
    if (s.time.gold >= game.track.playS / 2) award('first-gold');
    if (perfect) award('perfect');
    if (game.kind === 'daily') {
      store.daily = nextStreak(store.daily, game.day);
      award('daily1');
      if (store.daily.streak >= 5) award('streak5');
    } else if (!store.setlistDone.includes(id)) {
      store.setlistDone = [...store.setlistDone, id].slice(-200);
      if (store.setlistDone.length >= 5) award('setlist5');
    }
  } else if (game.t >= 120) {
    award('duet2');
  }
  save();
  renderResult(reason, acc, accShown, grade);
}

function renderResult(reason, acc, accShown, grade) {
  const s = game.s;
  const box = $('#result');
  $('#pad').hidden = true;
  $('#play-hint').hidden = true;
  const name = store.name;
  const stat = (label, value) => h('div', { class: 'stat' }, h('dt', { class: 'muted small', text: label }), h('dd', { class: 'num', text: value }));
  const stats = h(
    'dl',
    { class: 'stats' },
    stat('Accuracy', `${accShown}%`),
    stat('Longest gold streak', `${s.bestStreak.toFixed(1)} s`),
    stat('Flow peak', `x${s.flowPeak}`),
    stat('Score', fmtInt(s.score)),
  );
  const kids = [
    h('h2', { text: game.mode === 'duet' ? 'Duet over' : `Grade ${grade}` }),
    reason ? h('p', { text: reason }) : null,
    name ? h('p', { class: 'player-name', text: `Nice pacing, ${name}.` }) : null,
    stats,
  ];
  if (game.mode === 'track') {
    const run = game.track.run;
    kids.push(
      h('h3', { text: 'The real run' }),
      h(
        'dl',
        { class: 'stats facts' },
        stat('Date', fmtWhen(run.start)),
        stat('Length', fmtLen(run.durS)),
        stat('Top RPM', String(Math.round(run.top))),
        stat('Pauses', String(run.pauses)),
      ),
    );
    const grades = segmentGrades(s);
    const label = { gold: 'gold', silver: 'silver', miss: 'miss' };
    const text = shareText({
      title: game.kind === 'daily' ? `Hamster Pacer: Echo, Pacer #${game.pacer}` : `Hamster Pacer: Echo, run of ${fmtDate(run.start)}`,
      grades,
      score: s.score,
      acc,
      flowPeak: s.flowPeak,
      name,
    });
    const copyNote = h('p', { class: 'muted small', role: 'status', text: '' });
    kids.push(
      h('h3', { text: 'Share card' }),
      h(
        'div',
        { class: 'share' },
        h('ol', { class: 'grid', 'aria-label': `Segments: ${grades.map((g) => label[g]).join(', ')}` }, grades.map((g) => h('li', { class: `sq ${g}`, title: label[g] }))),
        h('p', { class: 'num small', text: `Score ${fmtInt(s.score)} | ${accShown}% | Flow peak x${s.flowPeak}` }),
      ),
      h('button', { type: 'button', class: 'btn', text: 'Copy share card', onclick: () => copyText(text, copyNote) }),
      copyNote,
    );
  } else {
    kids.push(
      h(
        'dl',
        { class: 'stats facts' },
        stat('Duet length', fmtLen(game.t)),
        stat('Blocks seen', game.blocks.length ? game.blocks.map((b) => `#${b}`).join(', ') : 'None'),
        stat('Block bonus', fmtInt(game.bonus)),
      ),
    );
  }
  const again =
    game.mode === 'track'
      ? h('button', {
          type: 'button',
          class: 'btn',
          text: 'Play again',
          // After UTC midnight this run is no longer the Daily, so a replay earns no Daily credit.
          onclick: () => startTrack(game.track.run, game.kind === 'daily' && game.day !== utcDay(Date.now()) ? 'setlist' : game.kind),
        })
      : duetReady()
        ? h('button', { type: 'button', class: 'btn', text: 'Duet again', onclick: startDuet })
        : null;
  kids.push(h('div', { class: 'actions' }, again, h('button', { type: 'button', class: 'btn ghost', text: 'Back to tracks', onclick: () => quitGame(true) })));
  box.replaceChildren(...kids.filter(Boolean));
  box.hidden = false;
  box.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'nearest', behavior: store.reduced ? 'auto' : 'smooth' });
}

async function copyText(text, note) {
  try {
    await navigator.clipboard.writeText(text);
    note.textContent = 'Copied. Paste it into a post on X.';
  } catch {
    const area = h('textarea', { class: 'sr-only', 'aria-hidden': 'true' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    note.textContent = ok ? 'Copied. Paste it into a post on X.' : 'Copy was blocked by the browser. Select and copy this text:\n' + text;
  }
}

function quitGame(rerender) {
  if (!game) return;
  // A duet the player ends on purpose still gets its result card.
  if (rerender && !game.ended && game.mode === 'duet' && game.t > 1) {
    finish('You ended the duet.');
    return;
  }
  game.ended = true;
  cancelAnimationFrame(game.raf);
  game = null;
  document.body.classList.remove('is-playing');
  $('#play').hidden = true;
  if (rerender) {
    renderDaily();
    renderSetlist();
    if (currentView === 'live') renderLive();
    const tab = document.querySelector(`.modes a[data-view="${currentView}"]`);
    if (tab) tab.focus({ preventScroll: true });
  }
}

// ---------- tutorial ----------

let tutStep = 0;
function showTutorial() {
  tutStep = 0;
  renderTutorial();
  const d = $('#tutorial');
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
}

function renderTutorial() {
  const [title, body] = TUTORIAL[tutStep];
  $('#tut-title').textContent = title;
  $('#tut-body').textContent = body;
  $('#tut-step').textContent = `${tutStep + 1} of ${TUTORIAL.length}`;
  $('#tut-back').hidden = tutStep === 0;
  $('#tut-next').textContent = tutStep === TUTORIAL.length - 1 ? 'Start playing' : 'Next';
}

function closeTutorial() {
  store.tutorial = true;
  save();
  const d = $('#tutorial');
  if (d.open) d.close();
}

// ---------- wiring ----------

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function init() {
  applySettings();
  $('#sound-btn').addEventListener('click', () => {
    store.sound = !store.sound;
    save();
    applySettings();
    if (store.sound) tick();
  });
  $('#motion-btn').addEventListener('click', () => {
    store.reduced = !store.reduced;
    save();
    applySettings();
  });
  $('#help-btn').addEventListener('click', showTutorial);
  $('#tut-next').addEventListener('click', () => {
    if (tutStep < TUTORIAL.length - 1) {
      tutStep++;
      renderTutorial();
      $('#tut-next').focus();
    } else closeTutorial();
  });
  $('#tut-back').addEventListener('click', () => {
    tutStep = Math.max(0, tutStep - 1);
    renderTutorial();
    $('#tut-next').focus();
  });
  $('#tut-skip').addEventListener('click', closeTutorial);
  $('#tutorial').addEventListener('close', () => {
    store.tutorial = true;
    save();
  });

  const pad = $('#pad');
  // Pointers tap on press for low latency, and then the browser also sends a click, which must not
  // count twice. A click with no pointer or key just before it is an assistive activation.
  let lastPadInput = -Infinity;
  const markPadInput = () => {
    lastPadInput = performance.now();
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    markPadInput();
    onTap();
  });
  pad.addEventListener('pointerup', markPadInput);
  pad.addEventListener('click', () => {
    if (performance.now() - lastPadInput > 500) onTap();
  });
  // Keyboard users on the focused pad: Enter taps; Space is handled globally below.
  pad.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) onTap();
    }
  });
  $('#quit-btn').addEventListener('click', () => quitGame(true));

  window.addEventListener('keydown', (e) => {
    if (lullaby) hushLullaby();
    if (!game || isTyping(e.target) || $('#tutorial').open) return;
    if (e.code === 'Space' || e.key === ' ') {
      if (game.ended) return;
      e.preventDefault();
      if (!e.repeat) onTap();
    } else if (e.key === 'Escape') {
      quitGame(true);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (game && !game.ended && (e.code === 'Space' || e.key === ' ') && !isTyping(e.target)) {
      e.preventDefault();
      markPadInput(); // Space on the focused pad already tapped on keydown
    }
  });
  window.addEventListener('pointerdown', () => {
    if (lullaby) hushLullaby();
  });

  const nameInput = $('#name-input');
  nameInput.value = store.name;
  nameInput.addEventListener('input', () => {
    store.name = cleanName(nameInput.value);
    save();
  });
  nameInput.addEventListener('change', () => {
    nameInput.value = store.name;
  });

  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  // Redraw sparklines when the width changes; phones fire height-only resizes while scrolling.
  let lastWidth = window.innerWidth;
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (game || window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      if (currentView === 'daily') renderDaily();
      if (currentView === 'setlist') renderSetlist();
    }, 200);
  });

  renderStickers();
  showView(location.hash.slice(1) || 'daily');
  renderDaily();
  refreshRuns();
  pollStatus();
  setInterval(clockTick, 1000);
  if (!store.tutorial) showTutorial();
}

init();
