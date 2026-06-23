# RoF Survivors

A browser **survivor-style auto-battler** (Vampire Survivors / Survivor.io clone)
where every weapon is a **real firearm fired at its authentic cyclic rate of
fire**. Top-down, auto-firing, scaling difficulty, rarity-rolled upgrade cards,
and a squad of rank-based soldiers you recruit as you level.

## Run it

```bash
npm install
npm run dev      # dev server (Vite) — opens at the printed localhost URL
npm run build    # production bundle into dist/
npm run preview  # serve the production build
```

Controls: **WASD / arrow keys** (desktop) or the **touch joystick** (mobile).
**Space / Q** (or the on-screen button) fires your character's active ability.
Weapons fire automatically at the nearest enemy. **XP is collected
automatically** — gems home in to you from anywhere on the map, so you never
have to walk over them — and fills the bar to level up, where you pick one of
three upgrade cards. Enemies occasionally drop **health packs** (red cross) —
far more often from elites and bosses.

## Sound

All audio is **synthesized at runtime via the Web Audio API** (`src/audio.js`)
— no audio files needed. Gunshots are filtered-noise cracks + body thump, tuned
per weapon class (pistol / SMG / rifle / LMG / minigun), with explosions,
reloads, hits, pickups, level-ups, ability casts and a game-over sting. High-rate
events are throttled so firing at 1200–3000 RPM stays punchy instead of becoming
a wall of noise. A sparse, deliberately **quiet generative music bed** (drone +
slow minor-key bass + soft percussion) plays underneath. Toggle everything with
the 🔊 button in the HUD.

## Characters

Pick an operator on the start screen. Each has a unique starting firearm, stat
profile, and an **active ability on a cooldown** (data-driven in
`src/characters.js`):

| Operator | Weapon | Ability (cooldown) |
|---|---|---|
| The Commando | Glock 17 | Adrenaline Rush — 2× fire rate + 50% speed, 6s (20s) |
| The Heavy | M249 SAW | Suppressing Barrage — 360° ring of piercing rounds (16s) |
| The Demolisher | AK-47 | Airstrike — explosions on nearby enemies (14s) |
| The Operative | MP5 | Field Medkit — heal 50% HP + 3s invulnerability (22s) |

## The firearms

Each gun's **base fire rate is its real-world RPM**. Per-shot cooldown is
`60000 / effective_RPM`, and `effective_RPM = base_RPM × fireRateMultiplier`.
The multiplier starts at **1.0** and only changes when you pick a **Fire Rate**
card — nothing else alters base RPM. The HUD shows live effective RPM per gun.

| Weapon | RPM | Weapon | RPM |
|---|---|---|---|
| Glock 17 | 1200 | Uzi | 600 |
| Beretta M9 | 1100 | P90 | 900 |
| MP5 | 800 | M249 SAW | 800 |
| AK-47 | 600 | Minigun M134 | 3000 |
| M16 / M4 | 850 | | |

Each gun also has authentic-ish damage, projectile speed, magazine size, reload
time, and spread (see `src/weapons.js`). Reloading pauses that gun's fire.

## Progression

- **XP only levels you up.** It grants no automatic stats.
- Every stat (fire rate, bullets, HP, damage, teammates, …) comes **only** from
  chosen upgrade cards.
- On level-up the game pauses and offers **3 rarity-rolled cards**.
- Rarities — Common · Uncommon · Rare · Epic · Legendary — scale each upgrade's
  magnitude, set drop odds, and tint the card. All balancing lives in one table
  in `src/upgrades.js`.

## Squad (rank-based powers)

Recruit cards add soldiers whose power matches their role (`src/teammates.js`,
fully data-driven):

| Rank | Role |
|---|---|
| Infantry | steady auto-rifle |
| Machine Gunner | high-RPM fire in an arc |
| Marksman / Sniper | slow, long-range, high-damage, piercing |
| Grenadier | periodic AoE blasts |
| Medic (Corporal) | heals the team in an aura |
| Sergeant | leadership aura — buffs nearby allies' damage & fire rate |
| Lieutenant / Officer | stronger command aura + periodic airstrikes |

Soldiers have their own HP, follow you in formation, can be downed, and their
stats scale with the rarity of the card that recruited them.

## Project layout

```
index.html            # canvas, HUD, modals
src/
  main.js             # bootstrap: load sprites, build game, start loop
  game.js             # orchestrator: loop, pools, collision, camera, FX, states
  config.js           # central tuning + difficulty curves
  player.js           # player + upgrade-driven modifiers + ability state
  characters.js       # playable operators: weapon, stats, cooldown ability
  weapons.js          # real firearm data + per-weapon fire/reload state machine
  enemies.js          # data-driven enemy types + seek/ranged AI
  spawner.js          # wave scaling, elites, bosses
  teammates.js        # data-driven ranks/roles + leadership auras
  upgrades.js         # single rarity-scaled balance table + card generation
  ui.js               # HUD, level-up cards, game-over modal
  sprites.js          # procedural placeholder art + /assets PNG overrides
  audio.js            # Web Audio synthesis: SFX per weapon class + music bed
  input.js            # WASD + virtual joystick
  pool.js, grid.js, rng.js   # object pooling, spatial hash, RNG helpers
assets/               # drop PNGs here to override placeholder sprites
```

## Art & assets

All visuals are **swappable sprites**. The game generates clean top-down
military placeholder art at runtime so it runs with zero binary files. Drop a
PNG into `/assets` (served as Vite's `publicDir`) with a name from
`assets/README.md` to override any sprite. Sprites are authored facing **right
(+x)**; the engine rotates each unit to its aim/move direction.

Includes muzzle flashes, ejecting shell casings, explosions, XP gems, hit
flashes, floating damage numbers, camera shake, and per-unit shadows.

## Performance

Object pooling for enemies, projectiles, gems, and FX; a spatial hash grid for
broad-phase collision and target finding; light enemy separation. Designed to
hold up with hundreds of entities on screen.
