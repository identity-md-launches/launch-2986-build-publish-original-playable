# DESIGN.md: Hamster Pacer: Echo

Source of truth: `src/styles.css` (tokens on `:root`), `src/index.html` (page skeleton, inline
SVG art), `src/app.js` (components built with the `h()` helper and the canvas renderer). `dist/` is
a byte copy. Nothing here was confirmed in a rendered browser; see `artifacts/validation.md`.

## Overview

A game for Squeekchain fans on phones and desktops. The look is a retro oscilloscope on a cozy,
dark warm-brown desk: one glowing amber trace (his real RPM), one mint trace (the player), faint
amber grid lines, and small pixel-art hamster sprites drawn as crisp-edged SVG rectangles. The
interface is flat and tonal: surfaces are lighter browns, with no borders or drop shadows on cards.
The first screen at phone width is the title line, the four mode links and the Daily panel with
its main button, in that order. Copy is plain English, sentence case, with no all-caps labels.

## Colors

All defined as custom properties on `:root` in `src/styles.css`, hex notation.

| Token | Value | Job |
| --- | --- | --- |
| `--bg` | `#1d140e` | Page background; inset wells (sparkline frame, setlist rows, sticker tiles, share card) |
| `--surface` | `#2a1d15` | Panels (`.view`, `.result`, tutorial dialog), icon buttons, mode links |
| `--surface-2` | `#36271c` | Raised controls: ghost buttons, the tap pad, pressed toggles, disabled buttons, badges |
| `--line` | `#4d3727` | Name field border, ghost-button hover, inset ring on miss squares |
| `--text` | `#f5e9d8` | Primary text |
| `--muted` | `#c9b29a` | Secondary text, labels, footer |
| `--amber` | `#ffb547` | Primary action fill, his RPM curve, gold grade, current mode link, wheel |
| `--mint` | `#74f0c4` | Player line and readout, tap pad label, focus ring |
| `--silver` | `#d4d9de` | Silver grade text and share squares |
| `--miss` | `#ff8a7a` | Miss grade text |
| `--moon` | `#f3e3b0` | Lullaby moon and timer, warnings (`.warn`), toast background |
| `--on-accent` | `#1d140e` | Text on amber and moon fills |

Canvas-only colors in `src/app.js` `drawScope()`: scope background `#140d09` (from `.scope`), grid
`rgba(255,181,71,0.09)`, gold band `rgba(255,181,71,0.14)`, pause shading `rgba(243,227,176,0.07)`.
Sticker tile hues are per sticker in the `STICKERS` array. Grades never rely on color alone: the
HUD prints "Gold", "Silver", "Miss" or "He paused, stay still", and share squares carry an
`aria-label` listing each segment. Contrast ratios were estimated by hand from the hex values, not
measured in a browser.

## Typography

- Families: `--sans` (`system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`)
  for everything readable; `--mono` (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) only
  for numbers (`.num`, with `tabular-nums`) and canvas axis labels. No web fonts are loaded.
- Weights: 400 body, 700 headings, buttons, links and badges.
- Scale (5 sizes): `--t-small` 13px (hints, labels, footer), `--t-body` 16px, `--t-h3` 20px (h3,
  HUD numbers, stat values), `--t-h2` 28px (h2, tap pad label, Lullaby timer), `--t-h1` 28px on
  phones and 40px from 720px wide.
- Line height 1.5 for body and 1.2 for headings. Headings use `text-wrap: balance` and paragraphs
  use `text-wrap: pretty`, capped at `max-width: 62ch`. No letter-spacing anywhere.

## Layout

- Spacing scale `--s1`..`--s7`: 4, 8, 12, 16, 24, 32, 48px.
- `.wrap`: centered column, `max-width: 1080px`, 16px side padding (24px from 720px).
- Page order: header (live wheel chip on the left, three 44px icon toggles on the right), intro
  (pixel hamster + h1 + one line), mode links (wrapping pills), the active view panel, footer.
- One breakpoint, `min-width: 720px`: the Daily panel goes to two columns (copy | 180px sparkline),
  setlist rows go to one line (`160px | copy | badge | Play`), result stats to four columns, h1 to
  40px. Below it, setlist rows stack (sparkline, then copy, then badge and Play on one row).
- Play mode adds `body.is-playing`, which hides everything marked `.home`. The play section stacks
  title + Quit, HUD (wrapping flex), progress bar, the scope canvas
  (`height: clamp(220px, 42vh, 440px)`), a hint line and the full-width tap pad (120px tall).
- Long values wrap (`overflow-wrap: anywhere` on play title and stat values); nothing truncates.

## Elevation & Depth

Flat and tonal. Depth comes from three brown steps (`--bg` < `--surface` < `--surface-2`) and inset
wells that drop back to `--bg`. The only shadows are the focus ring (`--focus`, a 3px `--bg` gap
plus a 2px mint ring), the 1px inset ring on miss squares, and the canvas glow (`shadowBlur: 10`)
on both traces. Overlays: the native `<dialog>` with a `rgba(10,6,4,0.75)` backdrop, and the fixed
toast (`z-index: 20`) at the bottom center.

## Shapes

`--radius` 12px for panels, the scope and the tap pad; `--radius-sm` 8px for buttons, icon buttons,
inputs, wells, badges and sticker art; `999px` pills for mode links only; 3px for share squares; a
circle for the breathing light. Pixel art uses `shape-rendering="crispEdges"`.

## Components

- **Button** `.btn` (`src/styles.css`): amber fill, 44px minimum height. Variants `.ghost`
  (`--surface-2`), `.big` (56px, full width up to 360px, used for each mode's main action),
  `.small-btn` (setlist Play). States: hover, `:active` 1px nudge, `:disabled` (surface fill, muted
  text), mint focus ring.
- **Icon toggle** `.icon-btn` (`#sound-btn`, `#motion-btn`, `#help-btn`): 44px square with an
  `aria-label` and title. Toggles report state through `aria-pressed`, which also tints them amber.
- **Mode links** `.modes a`: hash links (`#daily`, `#setlist`, `#live`, `#stickers`). The current one
  has `aria-current="page"` and an amber fill.
- **View panel** `.view`: one `<section>` per mode, `hidden` when inactive. Each renders loading
  ("Loading recorded runs…"), error (the reason plus "Try loading again") and empty states in
  `renderDaily`, `renderSetlist` and `renderLive` in `src/app.js`.
- **Sparkline** `sparkCanvas()` / `.spark` (40px) and `.big-spark` (120px, 180px on desktop): amber
  polyline of a run's RPM, `aria-hidden` because the same facts are printed as text beside it.
- **Setlist row** `.setlist li`: sparkline, date and length, grade `.badge` (S/A amber, B silver,
  else muted), Play button with a full `aria-label`.
- **Scope** `#scope` + `drawScope()`: seismograph canvas (`role="img"` with a text description). Grid
  every second, RPM labels, a ±8% gold band, pause shading, playhead at 35% width for tracks and
  82% for the live duet, and dots where both traces cross the playhead.
- **HUD** `.hud`: Score, Flow, You, Him in mono numbers, plus the grade word (`.grade[data-grade]`).
- **Tap pad** `#pad`: a native button driven by `pointerdown` (with `touch-action: manipulation`).
  Space taps from anywhere in play mode; Enter taps when the pad has focus.
- **Result card** `#result`: focusable region. Holds a stats `dl.stats`, a real-run `dl.stats.facts`,
  the share preview (`.share` with an `ol.grid` of ten `.sq.gold|silver|miss`) and the copy button,
  whose status line is `role="status"`.
- **Lullaby** `.lullaby`: moon SVG, `.breath` circle (8s breathe loop, removed under reduced
  motion), countdown `.lull-time`.
- **Sticker tile** `.stickers li` with `.sticker-art` (pixel face over `--hue`); `.locked` greys it.
- **Toast** `#toast` (`role="status"`, polite) for stickers, block bonuses and pause-tap warnings.
- **Tutorial** `<dialog id="tutorial">`: three cards, Skip / Back / Next. Native `showModal()` traps
  focus and Escape closes it.
- **Live wheel** `.wheel` in the header: the SVG spokes rotate once per `60 / rpm` seconds from
  `/v1/status`. The animation stops at 0 RPM or under reduced motion, and the label beside it
  always gives the state in words.

## Motion

Wheel spin, the breathing circle, a 160ms pad flash, the 200ms toast slide and button transitions
(`background-color`, `transform`; never `all`). All CSS animation and transition stop under the
`prefers-reduced-motion: reduce` media query or the in-game "Reduce motion" toggle
(`.reduce-motion` on `<html>`). The scrolling scope is the game itself and keeps running.

## Do's and Don'ts

- Do start a new page or mode as a `<section class="view home">` panel with an h2, one short line,
  and a single `.btn.big` main action. Put the instruction next to the control it explains.
- Do use amber only for "his data" and the main action, mint only for "the player" and focus.
- Do print every state in words; color is a second signal, never the only one.
- Do show real API data or say it is unavailable. Never draw placeholder curves.
- Don't add borders plus shadows to a panel, nest panels inside panels, or add tracked capitals,
  eyebrow labels or a sixth font size.
- Don't use the mono family for sentences.
