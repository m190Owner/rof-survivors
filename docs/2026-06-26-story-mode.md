# Story Mode (RoF Survivors)

Status: in progress (2026-06-26).

## Goal
A 4-chapter comedic campaign told through **comic-panel storyboards composited from the
game's own art** (operators, monsters, bosses, biomes). Tone: funny, self-aware.

## Flow
Start screen → **📖 Story** → Chapter Select (4 chapters, locked until the prior is beaten)
→ play a chapter: **intro storyboard → mission → outro storyboard → unlock next**.
Progress persists in `localStorage` (`save.story` = highest chapter index unlocked).

## Components
- **`src/story.js`** — all campaign data. `CHAPTERS[]`, each `{ id, title, biome, bossType,
  intro:[panel], outro:[panel] }`. A `panel` is data-driven:
  `{ bg, tint, sprites:[{img,x,y,scale,flip,rot}], bubbles:[{x,y,text,who,tail}], caption, sfx:[{x,y,text,color,rot}] }`.
  Sprite `img` names map to the `/assets` PNGs already shipped (`char_*`, `enemy_*`, `boss_*`).
- **`src/storyboard.js`** — the comic player. Renders a panel sequence as full-screen DOM/CSS
  comic panels: themed backdrop, posed sprite `<img>`s, CSS speech bubbles with tails, a yellow
  narration caption, halftone overlay + action lines + big outlined onomatopoeia. One panel at a
  time, tap to advance, **Skip** button. `play(panels, onDone)`.
- **Mission mode** (in `game.js`) — reuses the survival sim with a `mission` config: lock the run
  to `chapter.biome`, spawn `chapter.bossType`, **win = boss defeated** (not endless). Win →
  outro → unlock next; death → retry/quit. Uses the chosen operator + meta upgrades.
- **Chapter Select UI** (`ui.js` + `index.html`) — 4 cards, locked ones show 🔒.
- **`save.js`** — `story` progress field.

## Comic look
DOM/CSS (crisp panels). Themed per-biome gradient backdrops, thick comic borders, halftone via
repeating radial-gradient, speed lines, bold outlined lettering, onomatopoeia. No external font
dependency — heavy CSS styling for the comic feel.

## Build order
1. Comic renderer + Chapter 1 (intro → mission → outro) as the visual proof.
2. Chapters 2–4 content using the same machinery.

## Out of scope
Voice/audio narration, branching choices, animated tweening beyond simple panel pop-in.
