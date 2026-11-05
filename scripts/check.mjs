// Logic checks for the game rules in src/logic.js, plus a dist/ integrity check. Run: npm run check
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../src/logic.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};
const asyncTest = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok ${passed} ${name}`);
};

// A synthetic passage list shaped like /v1/measurement/runs items (test input only, never shown in the UI).
const seg = (times, discontinuity = false) => ({
  discontinuity,
  measurementEligible: true,
  passages: times.map((ms) => ({ at: new Date(ms).toISOString() })),
});
const t0 = Date.UTC(2026, 10, 4, 12, 0, 0);
const steady = Array.from({ length: 40 }, (_, i) => t0 + i * 1000); // 60 RPM for 39 s
const paused = [...steady, ...Array.from({ length: 20 }, (_, i) => t0 + 49000 + i * 500)]; // 10 s pause, then 120 RPM

test('buildRuns turns passages into one run with RPM per second', () => {
  const runs = L.buildRuns([seg(steady.slice(0, 20)), seg(steady.slice(20))]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].durS, 39);
  assert.ok(Math.abs(runs[0].rpm[5] - 60) < 0.001);
  assert.ok(Math.abs(runs[0].top - 60) < 0.001);
});

test('a gap over 60 s or a discontinuity starts a new run', () => {
  const later = steady.map((t) => t + 200000);
  assert.equal(L.buildRuns([seg(steady), seg(later)]).length, 2);
  assert.equal(L.buildRuns([seg(steady.slice(0, 20)), seg(steady.slice(20), true)]).length, 2);
});

test('short runs stay and become 45-second tracks; runs with no speed do not', () => {
  const [run] = L.buildRuns([seg(steady.slice(0, 11), true)]);
  assert.equal(run.durS, 10);
  const track = L.makeTrack(run);
  assert.equal(track.playS, 45);
  assert.ok(Math.abs(L.rpmAt(track, 44) - 60) < 0.001);
  assert.equal(L.buildRuns([seg(steady.slice(0, 2))]).length, 1);
  assert.equal(L.buildRuns([seg(steady.slice(0, 1))]).length, 0);
  assert.equal(L.buildRuns([seg([t0, t0 + 30000])]).length, 0);
});

test('a pause inside a run reads as 0 RPM and is counted', () => {
  const [run] = L.buildRuns([seg(paused)]);
  assert.equal(run.rpm[44], 0);
  assert.equal(run.pauses, 1);
  assert.ok(run.top > 100);
});

test('tracks last 45 to 90 seconds of play', () => {
  const [run] = L.buildRuns([seg(steady)]);
  assert.equal(L.makeTrack(run).playS, 45);
  assert.equal(L.makeTrack({ ...run, durS: 600, rpm: new Array(601).fill(60) }).playS, 90);
  assert.ok(Math.abs(L.rpmAt(L.makeTrack(run), 10) - 60) < 0.001);
});

test('player RPM comes from the last 3 seconds of taps and falls when taps stop', () => {
  const taps = [0, 1000, 2000, 3000];
  assert.equal(Math.round(L.playerRpm(taps, 3000)), 60);
  assert.ok(L.playerRpm(taps, 4500) < 60);
  assert.equal(L.playerRpm(taps, 7000), 0);
  assert.equal(L.playerRpm([5, 5], 10), 0);
});

test('8% is gold, 20% is silver, anything else misses', () => {
  assert.equal(L.frameGrade(100, 107), 'gold');
  assert.equal(L.frameGrade(100, 85), 'silver');
  assert.equal(L.frameGrade(100, 70), 'miss');
  assert.equal(L.frameGrade(0, 0), 'gold');
  assert.equal(L.frameGrade(0, 50), 'miss');
});

test('holding gold builds Flow to x5, misses and rest taps lower it', () => {
  const s = L.createScore(10, 60);
  for (let i = 0; i < 200; i++) L.scoreFrame(s, 'gold', 0.1, i * 0.1);
  assert.equal(s.flow, 5);
  assert.equal(s.flowPeak, 5);
  assert.ok(Math.abs(s.bestStreak - 20) < 0.01);
  L.penalizeRestTap(s);
  assert.equal(s.flow, 4);
  for (let i = 0; i < 16; i++) L.scoreFrame(s, 'miss', 0.1, 20 + i * 0.1);
  assert.equal(s.flow, 3);
  assert.ok(L.accuracy(s) > 90 && L.accuracy(s) < 100);
});

test('share card has 10 squares, a score line and no links', () => {
  const s = L.createScore(10, 10);
  for (let i = 0; i < 100; i++) L.scoreFrame(s, i < 50 ? 'gold' : i < 80 ? 'silver' : 'miss', 0.1, i * 0.1);
  const grades = L.segmentGrades(s);
  assert.deepEqual(grades, ['gold', 'gold', 'gold', 'gold', 'gold', 'silver', 'silver', 'silver', 'miss', 'miss']);
  const text = L.shareText({ title: 'Hamster Pacer: Echo, Pacer #3', grades, score: s.score, acc: L.accuracy(s), flowPeak: s.flowPeak, name: 'Pip' });
  assert.equal(Array.from(text.split('\n')[1]).length, 10);
  assert.match(text, /^Hamster Pacer: Echo, Pacer #3 by Pip\n/);
  assert.doesNotMatch(text, /https?:|wallet/i);
});

test('Daily picks the longest completed run from the previous UTC day', () => {
  const day = (d, h, len) => ({ start: Date.UTC(2026, 10, d, h), end: Date.UTC(2026, 10, d, h) + len * 1000, durS: len });
  const runs = [day(4, 1, 100), day(4, 9, 300), day(5, 1, 900), day(3, 1, 999)];
  const now = Date.UTC(2026, 10, 5, 12);
  assert.equal(L.pickDaily(runs, now, now).durS, 300);
  assert.equal(L.pickDaily([day(3, 1, 50)], now, now), null);
  assert.equal(L.pacerNumber(Date.UTC(2026, 10, 3, 5)), 1);
});

test('streaks, names and live status parsing', () => {
  assert.deepEqual(L.nextStreak({ last: 10, streak: 4 }, 11), { last: 11, streak: 5 });
  assert.deepEqual(L.nextStreak({ last: 8, streak: 4 }, 11), { last: 11, streak: 1 });
  assert.equal(L.cleanName('  <b>Squeaky</b> fan club member  '), '<b>Squeaky</b> fan c');
  const live = L.liveOf({
    measurement: { coreStatus: 'ACTIVE', rpmMilli: 66500, freshness: 'online', observedAt: '2026-11-05T04:55:38.450Z' },
    builder: { anchor: { blockHeight: '130' }, projected: { blockHeight: '155' } },
  });
  assert.equal(live.rpm, 66.5);
  assert.equal(live.block, 155);
  assert.equal(L.blockHeightOf({ builder: { anchor: { blockHeight: '130' } } }), 130);
});

test('a reading needs a state, a recent arrival and online freshness', () => {
  const online = { core: 'IDLE', freshness: 'online' };
  assert.equal(L.readingOnline(online, 1000, 1000 + L.STATUS_MAX_AGE_MS), true);
  assert.equal(L.readingOnline(online, 1000, 1001 + L.STATUS_MAX_AGE_MS), false);
  assert.equal(L.readingOnline({ core: 'IDLE', freshness: 'offline' }, 1000, 1000), false);
  assert.equal(L.readingUsable({ core: 'IDLE', freshness: 'offline' }, 1000, 1000), true);
  assert.equal(L.readingUsable({ core: null }, 1000, 1000), false);
  assert.equal(L.readingUsable(null, 1000, 1000), false);
});

await asyncTest('withTimeout rejects work that never settles and aborts it', async () => {
  let signal;
  await assert.rejects(
    L.withTimeout(20, (s) => {
      signal = s;
      return new Promise(() => {});
    }),
    /no answer within 0.02 seconds/,
  );
  assert.equal(signal.aborted, true);
  assert.equal(await L.withTimeout(1000, async () => 'done'), 'done');
});

await asyncTest('readAllPages follows nextCursor past 60 pages and through short pages', async () => {
  const asked = [];
  const readPage = async (cursor) => {
    asked.push(cursor);
    const n = cursor === null ? 0 : Number(cursor);
    return { items: n === 3 ? [] : [{ n }], nextCursor: n < 60 ? String(n + 1) : null, latestObservedAt: 'end' };
  };
  const { pages, meta } = await L.readAllPages(readPage);
  assert.equal(pages.length, 61);
  assert.equal(asked[60], '60');
  assert.equal(meta.latestObservedAt, 'end');
});

await asyncTest('readAllPages re-reads the last known page and keeps earlier ones', async () => {
  const asked = [];
  const known = [
    { cursor: null, items: ['a'] },
    { cursor: '1', items: ['b'] },
  ];
  const readPage = async (cursor) => {
    asked.push(cursor);
    return cursor === '1' ? { items: ['b', 'c'], nextCursor: '2' } : { items: ['d'], nextCursor: null };
  };
  const { pages } = await L.readAllPages(readPage, known);
  assert.deepEqual(asked, ['1', '2']);
  assert.deepEqual(pages.flatMap((p) => p.items), ['a', 'b', 'c', 'd']);
});

await asyncTest('readAllPages rejects a failed page and a repeated cursor instead of returning a prefix', async () => {
  await assert.rejects(
    L.readAllPages(async (cursor) => {
      if (cursor === '1') throw new Error('HTTP 500');
      return { items: [], nextCursor: '1' };
    }),
    /HTTP 500/,
  );
  await assert.rejects(L.readAllPages(async () => ({ items: [], nextCursor: 'same' })), /repeated a page cursor/);
});

test('dist/ matches src/ and uses relative asset URLs', () => {
  for (const name of readdirSync(join(root, 'src'))) {
    const d = join(root, 'dist', name);
    assert.ok(existsSync(d), `dist/${name} is missing`);
    assert.equal(readFileSync(d, 'utf8'), readFileSync(join(root, 'src', name), 'utf8'), `dist/${name} is stale; run npm run build`);
  }
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href|content)="([^"]+\.(?:js|css|svg|png))"/g)) assert.ok(m[1].startsWith('./'), `${m[1]} is not relative`);
  for (const tag of ['<title>', 'name="description"', 'property="og:title"', 'property="og:image"', 'rel="icon"']) assert.ok(html.includes(tag), `${tag} missing`);
});

console.log(`\n${passed} checks passed`);
