# Sprite assets

The game ships with **procedurally generated placeholder sprites** so it runs out
of the box with no binary files. Every visual is swappable: drop a PNG in this
folder with the matching name and it transparently replaces the placeholder at
load time (see `src/sprites.js` → `ASSET_MANIFEST` / `initSprites`).

This folder is configured as Vite's `publicDir`, so its files are served at the
site root (`assets/player.png` is fetched as `./player.png`).

All sprites must be authored **facing right (+x)** — the engine rotates them to
each unit's aim/move direction. Keep backgrounds transparent.

## Recognized file names

| File                     | Used for                                  |
|--------------------------|-------------------------------------------|
| `player.png`             | The commando (player)                     |
| `team_infantry.png`      | Infantry rifleman ally                    |
| `team_gunner.png`        | Machine gunner ally                       |
| `team_sniper.png`        | Marksman / sniper ally                    |
| `team_grenadier.png`     | Grenadier ally                            |
| `team_medic.png`         | Medic (corporal) ally                     |
| `team_sergeant.png`      | Sergeant ally                             |
| `team_lieutenant.png`    | Lieutenant / officer ally                 |
| `enemy_chaser.png`       | Basic chaser enemy                        |
| `enemy_swarmer.png`      | Fast swarmer enemy                        |
| `enemy_tank.png`         | Heavy tank enemy                          |
| `enemy_ranged.png`       | Ranged shooter enemy                      |
| `enemy_elite.png`        | Periodic elite                            |
| `enemy_boss.png`         | Boss                                      |
| `xp_gem.png`             | XP pickup gem                             |
| `muzzle.png`             | Muzzle flash                              |
| `explosion.png`          | Explosion / blast                         |
| `shell.png`              | Ejected shell casing                      |

Suggested sizes roughly match the placeholders (e.g. player ~52px, enemies
28–128px), but any square PNG works — it's drawn centered and scaled to fit.
