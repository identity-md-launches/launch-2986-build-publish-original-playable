// Pure game logic for Hamster Pacer: Echo. No DOM access, so scripts/check.mjs can test it in Node.

export const API = 'https://api.squeekchain.com/v1';
export const DAY_MS = 86400000;
// Pacer #1 is 2026-11-03 UTC, the start date in the Sepolia installation id (sepolia-core-sepolia-20261103).
export const PACER_EPOCH_DAY = Math.floor(Date.UTC(2026, 10, 3) / DAY_MS);
export const RUN_GAP_MS = 60000; // passages further apart than this belong to different runs
export const PAUSE_GAP_S = 4; // a gap longer than this inside a run is a pause (0 RPM)
export const STATUS_MAX_AGE_MS = 15000; // a status reading older than this no longer counts as live
export const TRACK_STEP_S = 0.5;
export const TAP_WINDOW_MS = 3000;
export const GOLD_TOL = 0.08;
export const SILVER_TOL = 0.2;
export const REST_RPM = 1;
export const POINTS = { gold: 100, silver: 40, miss: 0 };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const utcDay = (ms) => Math.floor(ms / DAY_MS);
export const pacerNumber = (ms) => utcDay(ms) - PACER_EPOCH_DAY + 1;

// Flatten the API's measurement segments into passage times and split them into runs.
// Each passage is one wheel revolution seen by the counter, so RPM = 60 / seconds between passages.
export function buildRuns(segments) {
  const points = [];
  for (const seg of segments) {
    if (!seg || seg.measurementEligible === false || !Array.isArray(seg.passages)) continue;
    seg.passages.forEach((p, i) => {
      const t = Date.parse(p && p.at);
      if (Number.isFinite(t)) points.push({ t, cut: i === 0 && seg.discontinuity === true });
    });
  }
  points.sort((a, b) => a.t - b.t);
  const runs = [];
  let current = [];
  let prev = -Infinity;
  const close = () => {
    // Two passages are enough for a speed; makeTrack stretches short runs to 45 seconds of play.
    // A run whose every gap is a pause has no speed to trace, so it is not a track.
    if (current.length >= 2) {
      const run = makeRun(current);
      if (run.top > 0) runs.push(run);
    }
    current = [];
  };
  for (const p of points) {
    if (p.t === prev) continue;
    if (current.length && (p.cut || p.t - prev > RUN_GAP_MS)) close();
    current.push(p.t);
    prev = p.t;
  }
  close();
  return runs;
}

// One RPM value per real second, lightly smoothed. Pauses stay exactly 0.
export function makeRun(times) {
  const start = times[0];
  const end = times[times.length - 1];
  const durS = (end - start) / 1000;
  const bins = Math.max(2, Math.ceil(durS) + 1);
  const raw = new Array(bins).fill(0);
  let j = 0;
  for (let i = 0; i < bins; i++) {
    const t = start + i * 1000;
    while (j < times.length - 2 && times[j + 1] <= t) j++;
    const dt = (times[j + 1] - times[j]) / 1000;
    raw[i] = dt > 0 && dt <= PAUSE_GAP_S ? 60 / dt : 0;
  }
  const rpm = raw.map((v, i) => {
    if (v === 0) return 0;
    let sum = 0;
    let n = 0;
    for (let k = i - 1; k <= i + 1; k++) {
      if (raw[k] > 0) {
        sum += raw[k];
        n++;
      }
    }
    return sum / n;
  });
  let top = 0;
  let pauses = 0;
  for (let i = 0; i < rpm.length; i++) {
    top = Math.max(top, rpm[i]);
    if (rpm[i] === 0 && i > 0 && rpm[i - 1] > 0) pauses++;
  }
  return { id: `run-${start}`, start, end, durS, passages: times.length, rpm, top, pauses };
}

// A track replays a run in 45 to 90 seconds of play, sampled every TRACK_STEP_S.
export function makeTrack(run) {
  const playS = clamp(run.durS, 45, 90);
  const k = run.durS / playS;
  const n = Math.ceil(playS / TRACK_STEP_S) + 1;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i * TRACK_STEP_S * k;
    const b = Math.max(a + 1, (i + 1) * TRACK_STEP_S * k);
    let sum = 0;
    let moving = 0;
    let still = 0;
    for (let s = Math.floor(a); s < Math.ceil(b) && s < run.rpm.length; s++) {
      if (run.rpm[s] > 0) {
        sum += run.rpm[s];
        moving++;
      } else still++;
    }
    pts.push(moving === 0 || still > moving ? 0 : sum / moving);
  }
  return { run, playS, pts, maxRpm: Math.max(60, run.top * 1.3) };
}

export function rpmAt(track, t) {
  const x = clamp(t / TRACK_STEP_S, 0, track.pts.length - 1);
  const i = Math.floor(x);
  const a = track.pts[i];
  const b = track.pts[Math.min(i + 1, track.pts.length - 1)];
  if (a === 0 || b === 0) return x - i < 0.5 ? a : b;
  return a + (b - a) * (x - i);
}

// Player RPM from the taps inside the last 3 seconds. It falls off when taps stop.
export function playerRpm(taps, now) {
  let first = -1;
  for (let i = taps.length - 1; i >= 0 && now - taps[i] <= TAP_WINDOW_MS; i--) first = i;
  if (first < 0) return 0;
  const count = taps.length - first;
  const last = taps[taps.length - 1];
  if (count < 2 || last === taps[first]) return 0;
  let rpm = (60000 * (count - 1)) / (last - taps[first]);
  const since = now - last;
  if (since > 60000 / rpm) rpm = Math.min(rpm, 60000 / since);
  return rpm;
}

export function frameGrade(target, player) {
  if (target < REST_RPM) return player < REST_RPM ? 'gold' : 'miss';
  const off = Math.abs(player - target) / target;
  if (off <= GOLD_TOL) return 'gold';
  if (off <= SILVER_TOL) return 'silver';
  return 'miss';
}

export function createScore(segments, playS) {
  return {
    score: 0,
    flow: 1,
    flowPeak: 1,
    goldHold: 0,
    missHold: 0,
    streak: 0,
    bestStreak: 0,
    time: { gold: 0, silver: 0, miss: 0 },
    segs: Array.from({ length: segments }, () => ({ gold: 0, silver: 0, miss: 0 })),
    playS,
  };
}

// Three seconds of unbroken gold raise Flow by one (max x5); 1.5 seconds of misses lower it.
export function scoreFrame(s, grade, dt, t) {
  s.time[grade] += dt;
  if (s.playS > 0 && s.segs.length) {
    const i = clamp(Math.floor((t / s.playS) * s.segs.length), 0, s.segs.length - 1);
    s.segs[i][grade] += dt;
  }
  s.score += POINTS[grade] * s.flow * dt;
  if (grade === 'gold') {
    s.streak += dt;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    s.goldHold += dt;
    s.missHold = 0;
    if (s.goldHold >= 3 && s.flow < 5) {
      s.flow++;
      s.goldHold = 0;
    }
    s.flowPeak = Math.max(s.flowPeak, s.flow);
    return;
  }
  s.streak = 0;
  s.goldHold = 0;
  if (grade === 'silver') {
    s.missHold = 0;
    return;
  }
  s.missHold += dt;
  if (s.missHold >= 1.5) {
    s.flow = Math.max(1, s.flow - 1);
    s.missHold = 0;
  }
}

// Tapping while he is paused costs one Flow level.
export function penalizeRestTap(s) {
  s.flow = Math.max(1, s.flow - 1);
  s.goldHold = 0;
  s.streak = 0;
}

export function accuracy(s) {
  const total = s.time.gold + s.time.silver + s.time.miss;
  return total > 0 ? (100 * (s.time.gold + 0.5 * s.time.silver)) / total : 0;
}

export function segmentGrades(s) {
  return s.segs.map((g) => {
    const total = g.gold + g.silver + g.miss;
    if (!total) return 'miss';
    if (g.gold / total >= 0.5) return 'gold';
    if ((g.gold + g.silver) / total >= 0.5) return 'silver';
    return 'miss';
  });
}

export function letterGrade(acc) {
  if (acc >= 90) return 'S';
  if (acc >= 75) return 'A';
  if (acc >= 55) return 'B';
  if (acc >= 35) return 'C';
  return 'D';
}

const SHARE_SQUARES = { gold: '\u{1F7E8}', silver: '⬜', miss: '⬛' };

export function shareText({ title, grades, score, acc, flowPeak, name }) {
  return [
    name ? `${title} by ${name}` : title,
    grades.map((g) => SHARE_SQUARES[g]).join(''),
    `Score ${Math.round(score).toLocaleString('en-US')} | ${Math.floor(acc)}% | Flow peak x${flowPeak}`,
    '#HamsterPacer',
  ].join('\n');
}

// Longest completed run that started on the previous UTC day.
export function pickDaily(runs, nowMs, latestObservedMs) {
  const day = utcDay(nowMs) - 1;
  let best = null;
  for (const r of runs) {
    if (utcDay(r.start) !== day || r.end > latestObservedMs - RUN_GAP_MS) continue;
    if (!best || r.durS > best.durS) best = r;
  }
  return best;
}

export function nextStreak(daily, day) {
  if (daily.last === day) return daily;
  return { last: day, streak: daily.last === day - 1 ? daily.streak + 1 : 1 };
}

export function cleanName(value) {
  return Array.from(String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 20).join('');
}

export function blockHeightOf(status) {
  const b = status && status.builder;
  const raw = (b && b.projected && b.projected.blockHeight) ?? (b && b.anchor && b.anchor.blockHeight);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function liveOf(status) {
  const m = (status && status.measurement) || {};
  const milli = Number(m.rpmMilli);
  return {
    core: typeof m.coreStatus === 'string' ? m.coreStatus : null,
    rpm: m.rpmMilli != null && Number.isFinite(milli) ? milli / 1000 : null,
    freshness: typeof m.freshness === 'string' ? m.freshness : null,
    observedAt: Date.parse(m.observedAt) || null,
    block: blockHeightOf(status),
  };
}

// A reading can be used only if it has a state and arrived recently.
export function readingUsable(live, receivedAt, now) {
  return Boolean(live && live.core) && now - receivedAt <= STATUS_MAX_AGE_MS;
}

// Live Duet and Lullaby also need the API to call the wheel's data fresh.
export function readingOnline(live, receivedAt, now) {
  return readingUsable(live, receivedAt, now) && live.freshness === 'online';
}

// Rejects after ms even if the work never settles, and tells that work to stop through its signal.
export function withTimeout(ms, work) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${ms / 1000} seconds`));
      controller.abort();
    }, ms);
  });
  return Promise.race([work(controller.signal), expired]).finally(() => clearTimeout(timer));
}

// Follows nextCursor until the API has no more pages. `known` holds pages from an earlier read:
// the last one is read again, because it may have grown, and later pages are added after it.
// Any failure rejects, so a caller never mistakes a partial history for the whole one.
export async function readAllPages(readPage, known = [], onPage = () => {}) {
  const pages = known.slice(0, -1);
  const seen = new Set(pages.map((p) => p.cursor));
  let cursor = known.length ? known[known.length - 1].cursor : null;
  for (;;) {
    if (seen.has(cursor)) throw new Error('the API repeated a page cursor');
    seen.add(cursor);
    const json = await readPage(cursor);
    if (!Array.isArray(json.items)) throw new Error('the runs response had no items list');
    pages.push({ cursor, items: json.items });
    onPage(pages.length);
    cursor = json.nextCursor;
    if (cursor == null || cursor === '') return { pages, meta: json };
  }
}
