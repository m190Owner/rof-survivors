# M1 — Visual & UI Overhaul (RoF Survivors)

Status: in progress (2026-06-23). First of five milestones (M1 visuals → M2 QoL/save →
M3 enemies/bosses/biomes → M4 weapon evolutions → M5 meta-progression/shop).

## Goal
Make the game look good with authored (CC0) sprite art and a full polish pass on UI,
FX, and the world — without changing gameplay.

## Decisions
- **Art source:** Kenney CC0 packs (public domain, no attribution required).
  - Soldiers (player operators + teammates): **Top-down Shooter** pack (top-down, rotates to aim).
  - Enemies: **Monster Builder Pack** — keep the crimson "monster/alien faction" by re-tinting.
- **Render direction:** soldiers are top-down and rotate to their aim/move vector (as today).
  Monsters are **front-view billboards that do NOT rotate** (genre norm — Vampire Survivors /
  Survivor.io). Engine gains a per-entity `billboard` flag so enemies/pickups stay upright.
- **Polish scope:** full overhaul — world ground texture + vignette + glow, upgraded
  muzzle/explosion/hit/death FX, and a restyled HUD/menus/leaderboard in the gold-military palette.

## Asset pipeline
1. Download + extract the two CC0 zips into `.art-src/` (work area, not shipped).
2. A Node script (`tools/build-sprites.mjs`, uses `sharp`) normalizes chosen sprites:
   rotate soldiers to face +x, trim transparent margins, recolor/tint per unit, resize to each
   `ASSET_MANIFEST` logical size, and write PNGs into `assets/` (Vite publicDir).
3. `xp_gem`, `health`, `shell` stay authored vector (tiny, consistency).
4. `npm run build` → copy `dist/index.html` + `dist/assets/` into `website/game/`. The publicDir
   PNGs land at the game root (`/game/<name>.png`) where `initSprites()` already loads them.

## Manifest mapping (23 names)
| Manifest | Source |
|---|---|
| char_commando / char_heavy / char_demo / char_medic | 4 human `*_gun` sprites, recolored per operator |
| team_infantry … team_lieutenant (7) | human variants, tinted + rank insignia overlay |
| enemy_chaser / swarmer / tank / ranged / elite | Monster Builder monsters, crimson-tinted, scaled |
| enemy_boss | large unique monster |
| muzzle / explosion | Kenney Particle Pack frames (or upgraded canvas FX) |
| xp_gem / health / shell | authored vector |

## Engine/UI changes
- `sprites.js`: load real PNGs (already supported); add `billboard` metadata so the renderer
  knows which sprites skip aim-rotation.
- `game.js` render: branch rotation on `billboard`; add ground-tile texture, vignette, and an
  additive glow pass; upgrade muzzle/explosion/hit/death FX.
- `ui.js` + `style.css` + `index.html`: restyle HUD, menus, character-select, chips, and the
  leaderboard; animated screen transitions.

## Build order
1. Acquire + normalize assets → wire sprites (+ billboard render). Visible win first.
2. World texture + lighting + FX pass.
3. HUD/menu restyle.

## Licensing
Both packs are CC0 1.0 (public domain). No attribution required; a credit line in the game
README is a courtesy and will be added.
