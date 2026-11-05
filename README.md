# Hamster Pacer: Echo

An original single-page browser game for the Squeekchain Genesis Code lane. You trace the real speed
curves of Squeektoshi's hamster-wheel runs by tapping a tempo. Unofficial fan game; no token, no
wallet, no contracts, no betting, no prizes.

## How it plays

- **Daily Track:** the longest completed run from the previous UTC day, shown as `Pacer #<n>`
  (Pacer #1 is 2026-11-03 UTC, the start date in the API's `installationId`). If the API has no
  completed run for that day, the panel says so and offers his newest recorded run instead.
- **Tempo tracing:** his real RPM scrolls right to left on a seismograph canvas (amber), squeezed or
  stretched into 45 to 90 seconds of play. Tap Space, Enter on the focused pad, or the big pad on
  touch screens. Your RPM is the tap rate over a rolling 3-second window (mint line).
- **Scoring:** each frame, within 8% of his RPM is gold, within 20% is silver, else a miss. Three
  seconds of unbroken gold raise Flow by one level (x1 to x5); 1.5 seconds of misses lower it. When his
  curve drops to 0 (a pause), staying still counts as gold, and each tap costs one Flow level.
- **End screen:** accuracy, longest gold streak, Flow peak and score, the real run's date, length,
  top RPM and pause count, plus a 10-square share card (gold, silver, miss per tenth of the track).
  "Copy share card" puts emoji squares and the score on the clipboard. The text has no links.
- **Setlist:** the last 20 recorded runs, newest first, each with a sparkline and your best grade.
- **Live:** polls `GET /v1/status` every 5 seconds. While `measurement.coreStatus` is `ACTIVE` (and
  `measurement.freshness` is `online`) you can start a **Live Duet**: the curve is drawn from
  `measurement.rpmMilli / 1000` as it arrives, and each rise in `builder.projected.blockHeight`
  (falling back to `builder.anchor.blockHeight`) adds 250 x Flow with a toast naming the block.
  While `IDLE` the tab becomes **Lullaby**: a moon and a breathing circle, and 60 quiet seconds earn
  the "Good roommate" sticker. Any key or tap simply restarts the minute; nothing is lost.
  `COUNTER_FAULT` or a failed request turns live play off and says why.
- **Progress** (localStorage key `hamster-pacer-echo.v1`): 10 stickers, best score per track, Daily
  streak, a pacer name (max 20 characters, rendered with `textContent` only), sound and
  reduced-motion settings, and whether the 3-card tutorial was seen.

## Data sources

Both endpoints were checked live on 2026-11-05 (UTC):

- `GET https://api.squeekchain.com/v1/measurement/runs?limit=100[&cursor=…]` returns
  `{ items, nextCursor, latestObservedAt, coverageStartAt, coverageThroughAt, … }`. Each item is a
  short measurement segment with `passages[].at` timestamps, `discontinuity` and
  `measurementEligible`. `limit` above 100 and other query parameters (`since`, `from`, `order`)
  return HTTP 400, so the game pages forward with `nextCursor` (up to 60 pages, 6,000 segments).
- `GET https://api.squeekchain.com/v1/status` returns `measurement.coreStatus`,
  `measurement.rpmMilli`, `measurement.freshness`, `builder.projected.blockHeight` and
  `builder.anchor.blockHeight`, as the brief describes.

**How runs are built** (`src/logic.js`): all passages are sorted and split into runs wherever two
passages are more than 60 seconds apart or a segment is flagged `discontinuity`. Each passage is
taken as one wheel revolution, so RPM is 60 / seconds between passages; a gap over 4 seconds inside
a run is a pause (0 RPM). Runs with fewer than 12 passages or under 15 seconds are not playable.
"Completed" means the run ended at least 60 seconds before the API's `latestObservedAt`.

Nothing is simulated. If a request fails, the affected modes are disabled with the reason on screen.

## Install, preview, rebuild

Requires Node 18 or newer. There are no npm dependencies, so `npm install` only records the empty
lockfile.

```sh
npm install        # nothing to download; keeps package-lock.json in sync
npm run build      # copies src/ to dist/ (the site is plain ES modules, no bundler)
npm run check      # syntax check of both modules + rule tests + dist/ matches src/ + share tags
npm run preview    # serves dist/ at http://localhost:4173/ (PORT to change)
```

`dist/` is the committed static export. Every asset URL in `dist/index.html` is relative
(`./app.js`, `./styles.css`, `./favicon.svg`, `./og.svg`), so it works from an IPFS gateway subpath
or an ENS name. Navigation uses hash routes (`#daily`, `#setlist`, `#live`, `#stickers`).
Opening `dist/index.html` straight from disk (`file://`) will not work, because browsers block ES
module imports there; use `npm run preview` or any static server.

## Layout

```
src/            source: index.html, app.js (DOM, canvas, game loop), logic.js (pure rules),
                styles.css, favicon.svg, og.svg
dist/           production export, a byte copy of src/ made by scripts/build.mjs
scripts/        build.mjs, check.mjs (logic tests), preview.mjs (static server)
DESIGN.md       implemented tokens, type, components, responsive behavior
artifacts/validation.md   what was checked, what was not, and why
```

## Validation status (honest summary)

This work was written in a session where the shell sandbox and the browser tool both failed to
start (`Failed to create bridge sockets`, and Chrome aborting with `Socket path too long`). So **no
command in this repository has been run yet**: not `npm run build`, not `npm run check`, not the
design probe. `dist/` was written file by file as an exact copy of `src/`; a line count of every file
matches, but `npm run check` (which compares the bytes) has not run. The API field names were checked
live through a web fetch tool. See `artifacts/validation.md` for the full record and the commands to
run first.

## Limitations

- The run list is read oldest-first through cursor pages; past 6,000 segments the newest runs would
  be cut off. The API currently offers no newest-first or date filter.
- `og:image` is an SVG (`og.svg`) with a relative URL. Some link unfurlers (including X) need a PNG at
  an absolute URL; add `og.png` and an absolute URL once the site's final address is known.
- Treating each passage as one revolution is an inference from the hardware counter; if the counter
  reports more than one passage per revolution, RPM values scale by that factor.

## Footer text

Unofficial fan game for Squeekchain. Data is read live from the public API on Sepolia testnet.
