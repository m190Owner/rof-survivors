// Wave spawner. Spawns scale count + composition over time, with periodic elites
// and a boss every couple of minutes. Enemies spawn just off-screen, ringing the
// player so there's always pressure from every side.

import { DIFFICULTY } from './config.js';
import { ENEMY_DEFS } from './enemies.js';
import { rand, TAU, weightedPick } from './rng.js';

// Bosses cycle through the roster so back-to-back bosses are different fights.
const BOSS_ROSTER = ['boss_maw', 'boss_charger', 'boss_hive'];

export class Spawner {
  constructor() {
    this.spawnTimer = 0;
    this.eliteTimer = DIFFICULTY.eliteEvery;
    this.bossTimer = DIFFICULTY.bossEvery;
    this.bossIndex = 0;
  }

  reset() {
    this.spawnTimer = 0;
    this.eliteTimer = DIFFICULTY.eliteEvery;
    this.bossTimer = DIFFICULTY.bossEvery;
    this.bossIndex = 0;
  }

  // Composition shifts toward tougher mixes as the run goes on.
  pickType(t) {
    const table = [
      { id: 'chaser', weight: 60 },
      { id: 'swarmer', weight: 25 + t * 0.4 },
      { id: 'ranged', weight: t > 20 ? 18 : 0 },
      { id: 'tank', weight: t > 40 ? 12 : (t > 15 ? 5 : 0) },
    ];
    return weightedPick(table).id;
  }

  spawnAt(game, type) {
    // Ring just outside the visible area.
    const a = rand(0, TAU);
    const dist = game.spawnRadius;
    const x = game.player.x + Math.cos(a) * dist;
    const y = game.player.y + Math.sin(a) * dist;
    game.spawnEnemy(type, x, y);
  }

  update(dtMs, game) {
    const t = game.elapsed;
    const dt = dtMs / 1000;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = DIFFICULTY.spawnInterval(t);
      if (game.enemies.count < DIFFICULTY.maxEnemies(t)) {
        const batch = DIFFICULTY.spawnBatch(t);
        for (let i = 0; i < batch; i++) this.spawnAt(game, this.pickType(t));
      }
    }

    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = DIFFICULTY.eliteEvery;
      this.spawnAt(game, 'elite');
    }

    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.bossTimer = DIFFICULTY.bossEvery;
      const bossType = BOSS_ROSTER[this.bossIndex % BOSS_ROSTER.length];
      this.bossIndex++;
      this.spawnAt(game, bossType);
      const name = ENEMY_DEFS[bossType].bossName || 'BOSS';
      game.announce(`⚠ ${name} INCOMING ⚠`);
    }
  }
}
