// Wave spawner. Spawns scale count + composition over time, with periodic elites
// and a boss every couple of minutes. Enemies spawn just off-screen, ringing the
// player so there's always pressure from every side.

import { DIFFICULTY, STAGES } from './config.js';
import { ENEMY_DEFS } from './enemies.js';
import { rand, TAU, weightedPick } from './rng.js';

// Each biome culminates in a boss; the roster cycles so each is a different fight.
export const BOSS_ROSTER = ['boss_maw', 'boss_charger', 'boss_hive'];

export class Spawner {
  constructor() {
    this.spawnTimer = 0;
    this.eliteTimer = DIFFICULTY.eliteEvery;
  }

  reset() {
    this.spawnTimer = 0;
    this.eliteTimer = DIFFICULTY.eliteEvery;
  }

  // Composition comes from the current biome's weighted pool.
  pickType(game) {
    const stage = STAGES[game.stage % STAGES.length];
    return weightedPick(stage.pool.map(([id, weight]) => ({ id, weight }))).id;
  }

  spawnAt(game, type) {
    // Ring just outside the visible area.
    const a = rand(0, TAU);
    const dist = game.spawnRadius;
    const x = game.player.x + Math.cos(a) * dist;
    const y = game.player.y + Math.sin(a) * dist;
    return game.spawnEnemy(type, x, y);
  }

  update(dtMs, game) {
    const t = game.elapsed;
    const dt = dtMs / 1000;
    const stage = STAGES[game.stage % STAGES.length];

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = DIFFICULTY.spawnInterval(t);
      if (game.enemies.count < DIFFICULTY.maxEnemies(t)) {
        const batch = DIFFICULTY.spawnBatch(t);
        for (let i = 0; i < batch; i++) this.spawnAt(game, this.pickType(game));
      }
    }

    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = DIFFICULTY.eliteEvery;
      this.spawnAt(game, 'elite');
    }

    // Biome boss gate: once the stage timer elapses, summon its boss. Killing
    // the boss advances the biome (handled in game.killEnemy).
    if (!game.bossActive && game.stageElapsed >= stage.bossAfterSec) {
      const bossType = BOSS_ROSTER[game.stage % BOSS_ROSTER.length];
      const boss = this.spawnAt(game, bossType);
      game.bossActive = true;
      game.bossRef = boss;
      game.announce(`⚠ ${ENEMY_DEFS[bossType].bossName} INCOMING ⚠`);
    }
  }
}
