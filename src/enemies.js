// Enemy faction. Data-driven types; all seek the nearest friendly unit (player
// or teammate) and deal contact damage. Ranged types stand off and shoot.

import { rand, TAU } from './rng.js';

export const ENEMY_DEFS = {
  chaser: {
    sprite: 'enemy_chaser', radius: 16, hp: 18, speed: 78, damage: 8,
    xp: 1, color: '#8e2b2b',
  },
  swarmer: {
    sprite: 'enemy_swarmer', radius: 11, hp: 8, speed: 150, damage: 5,
    xp: 1, color: '#c0392b',
  },
  tank: {
    sprite: 'enemy_tank', radius: 28, hp: 140, speed: 46, damage: 18,
    xp: 6, color: '#5e2424',
  },
  ranged: {
    sprite: 'enemy_ranged', radius: 16, hp: 26, speed: 60, damage: 6,
    xp: 3, color: '#9b3a6a', ranged: true,
    fireRange: 360, fireEverySec: 1.8, projSpeed: 320, projDamage: 9, projColor: '#ff5bd0',
  },
  elite: {
    sprite: 'enemy_elite', radius: 24, hp: 420, speed: 70, damage: 22,
    xp: 25, color: '#7a1f5a', elite: true,
  },
  boss: {
    sprite: 'enemy_boss', radius: 56, hp: 4200, speed: 52, damage: 40,
    xp: 220, color: '#3a0d0d', boss: true,
  },

  // ---- Boss roster (telegraphed attacks; see updateBoss) ----
  boss_maw: {
    sprite: 'boss_maw', radius: 58, hp: 4200, speed: 40, damage: 40,
    xp: 220, color: '#3a0d0d', boss: true, bossName: 'THE MAW',
    attacks: [
      { kind: 'slam', telegraphMs: 950, count: 3, radius: 92, damage: 34, cooldownMs: 3600 },
      { kind: 'summon', telegraphMs: 700, spawn: 'swarmer', n: 4, cooldownMs: 7000 },
    ],
  },
  boss_charger: {
    sprite: 'boss_charger', radius: 52, hp: 3800, speed: 44, damage: 46,
    xp: 220, color: '#7a1414', boss: true, bossName: 'THE CHARGER',
    attacks: [
      { kind: 'charge', telegraphMs: 820, speed: 940, durationMs: 520, damage: 46, cooldownMs: 3800 },
    ],
  },
  boss_hive: {
    sprite: 'boss_hive', radius: 56, hp: 4600, speed: 38, damage: 36,
    xp: 220, color: '#5a1c3a', boss: true, bossName: 'THE HIVE',
    attacks: [
      { kind: 'barrage', telegraphMs: 760, bullets: 26, damage: 10, projSpeed: 300, projColor: '#ff5bd0', cooldownMs: 4400 },
      { kind: 'summon', telegraphMs: 700, spawn: 'swarmer', n: 3, cooldownMs: 7600 },
    ],
  },
};

export function makeEnemy() {
  return {
    alive: false, x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    type: 'chaser', def: null, hp: 1, maxHp: 1, radius: 12,
    damage: 0, speed: 0, xp: 1, flash: 0, fireCd: 0,
    hitCd: 0, // contact-damage cooldown so a touching enemy doesn't drain instantly
    // Boss attack state machine (unused by normal enemies).
    bossPhase: 'idle', atkCd: 0, atk: null, atkTimer: 0,
    telePts: null, dashT: 0, dashVx: 0, dashVy: 0,
  };
}

export function resetEnemy(e, type, x, y, statScale) {
  const def = ENEMY_DEFS[type];
  e.type = type;
  e.def = def;
  e.x = x; e.y = y;
  e.vx = 0; e.vy = 0;
  e.radius = def.radius;
  e.maxHp = Math.round(def.hp * statScale);
  e.hp = e.maxHp;
  e.damage = def.damage * Math.min(2.2, statScale);
  e.speed = def.speed;
  e.xp = def.xp;
  e.flash = 0;
  e.fireCd = (def.fireEverySec ?? 0) * 1000 * Math.random();
  e.hitCd = 0;
  e.angle = 0;
  // Bosses open with a short grace period before their first attack.
  e.bossPhase = 'idle';
  e.atkCd = def.attacks ? 1800 : 0;
  e.atk = null;
  e.atkTimer = 0;
  e.telePts = null;
  e.dashT = 0;
}

// Move toward `target` (the nearest friendly). Returns nothing; mutates e.
export function updateEnemy(e, dtMs, target, game) {
  if (e.def.attacks) { updateBoss(e, dtMs, target, game); return; }

  const dt = dtMs / 1000;
  if (e.flash > 0) e.flash -= dtMs;
  if (e.hitCd > 0) e.hitCd -= dtMs;

  const dx = target.x - e.x, dy = target.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  e.angle = Math.atan2(dy, dx);

  if (e.def.ranged) {
    // Keep distance: approach until in range, then hold and shoot.
    const desired = e.def.fireRange * 0.8;
    if (dist > desired) {
      e.x += dx / dist * e.speed * dt;
      e.y += dy / dist * e.speed * dt;
    } else if (dist < desired * 0.6) {
      e.x -= dx / dist * e.speed * 0.6 * dt;
      e.y -= dy / dist * e.speed * 0.6 * dt;
    }
    e.fireCd -= dtMs;
    if (e.fireCd <= 0 && dist <= e.def.fireRange) {
      e.fireCd = e.def.fireEverySec * 1000;
      game.spawnEnemyBullet(e.x, e.y, e.angle, e.def.projSpeed, e.def.projDamage * game.statScaleNow, e.def.projColor);
    }
  } else {
    e.x += dx / dist * e.speed * dt;
    e.y += dy / dist * e.speed * dt;
  }
}

// ---- Boss AI: telegraph -> resolve state machine ----
// Each attack runs: idle (slow approach) -> windup (telegraph shown) -> resolve
// (damage applied / projectiles fired) -> cooldown. A 'charge' adds a brief dash.
export function updateBoss(e, dtMs, target, game) {
  const dt = dtMs / 1000;
  if (e.flash > 0) e.flash -= dtMs;
  if (e.hitCd > 0) e.hitCd -= dtMs;

  const dx = target.x - e.x, dy = target.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (e.dashT <= 0) e.angle = Math.atan2(dy, dx);

  // Dash (charge resolution) in progress: barrel forward, contact damage applies
  // via the main loop using e.damage.
  if (e.dashT > 0) {
    e.dashT -= dtMs;
    e.x += e.dashVx * dt;
    e.y += e.dashVy * dt;
    return;
  }

  if (e.bossPhase === 'windup') {
    e.atkTimer -= dtMs;
    if (e.atkTimer <= 0) {
      resolveBossAttack(e, target, game);
      e.bossPhase = 'idle';
      e.atkCd = e.atk.cooldownMs;
    }
    return; // hold position during the wind-up
  }

  // idle: slow approach, count down to the next attack
  e.x += dx / dist * e.speed * dt;
  e.y += dy / dist * e.speed * dt;
  e.atkCd -= dtMs;
  if (e.atkCd <= 0) startBossAttack(e, target, game);
}

function startBossAttack(e, target, game) {
  const atk = e.def.attacks[Math.floor(Math.random() * e.def.attacks.length)];
  e.atk = atk;
  e.bossPhase = 'windup';
  e.atkTimer = atk.telegraphMs;
  const life = atk.telegraphMs / 1000;

  if (atk.kind === 'slam') {
    // First circle on the target, the rest scattered nearby — telegraph each.
    e.telePts = [{ x: target.x, y: target.y }];
    for (let i = 1; i < atk.count; i++) {
      const a = Math.random() * TAU, r = rand(60, 180);
      e.telePts.push({ x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r });
    }
    for (const p of e.telePts) {
      // Explicit colour — the fx pool recycles objects, so we must not rely on
      // a default for an optional field (a recycled spark could leave a stale one).
      game.fx.spawn({ type: 'tele_circle', x: p.x, y: p.y, radius: atk.radius, life, maxLife: life, color: 'rgba(255,70,50,0.6)' });
    }
  } else if (atk.kind === 'charge') {
    const a = Math.atan2(target.y - e.y, target.x - e.x);
    e.atkDir = a;
    const len = atk.speed * (atk.durationMs / 1000);
    game.fx.spawn({ type: 'tele_line', x: e.x, y: e.y, angle: a, length: len, width: e.radius * 2, life, maxLife: life });
  } else if (atk.kind === 'barrage') {
    game.fx.spawn({ type: 'tele_circle', x: e.x, y: e.y, radius: e.radius * 2.4, life, maxLife: life, color: 'rgba(255,90,210,0.5)' });
  } else if (atk.kind === 'summon') {
    e.telePts = [];
    for (let i = 0; i < atk.n; i++) {
      const a = Math.random() * TAU, r = rand(40, 90);
      const p = { x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r };
      e.telePts.push(p);
      game.fx.spawn({ type: 'tele_circle', x: p.x, y: p.y, radius: 26, life, maxLife: life, color: 'rgba(120,200,80,0.5)' });
    }
  }
}

function resolveBossAttack(e, target, game) {
  const atk = e.atk;
  if (atk.kind === 'slam') {
    for (const p of e.telePts) {
      game.fx.spawn({ type: 'explosion', x: p.x, y: p.y, radius: atk.radius, life: 0.4, maxLife: 0.4 });
      game.damageFriendlies(p.x, p.y, atk.radius, atk.damage * game.statScaleNow);
    }
    game.audio.explosion();
    game.shakeCamera(7);
  } else if (atk.kind === 'charge') {
    e.dashVx = Math.cos(e.atkDir) * atk.speed;
    e.dashVy = Math.sin(e.atkDir) * atk.speed;
    e.dashT = atk.durationMs;
    game.shakeCamera(8);
  } else if (atk.kind === 'barrage') {
    const n = atk.bullets;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      game.spawnEnemyBullet(e.x, e.y, a, atk.projSpeed, atk.damage * game.statScaleNow, atk.projColor);
    }
  } else if (atk.kind === 'summon') {
    for (const p of e.telePts) game.spawnEnemy(atk.spawn, p.x, p.y);
  }
}
