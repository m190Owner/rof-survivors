// Enemy faction. Data-driven types; all seek the nearest friendly unit (player
// or teammate) and deal contact damage. Ranged types stand off and shoot.

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
};

export function makeEnemy() {
  return {
    alive: false, x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    type: 'chaser', def: null, hp: 1, maxHp: 1, radius: 12,
    damage: 0, speed: 0, xp: 1, flash: 0, fireCd: 0,
    hitCd: 0, // contact-damage cooldown so a touching enemy doesn't drain instantly
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
}

// Move toward `target` (the nearest friendly). Returns nothing; mutates e.
export function updateEnemy(e, dtMs, target, game) {
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
