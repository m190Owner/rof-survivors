// Recruitable soldiers. Each rank's power matches its real army role. All ranks
// are DATA-DRIVEN here — add a new entry to TEAMMATE_DEFS (+ a sprite) and it
// becomes recruitable with zero other changes.
//
// kind 'combat'  -> deals damage directly (infantry, gunner, sniper, grenadier)
// kind 'support' -> auras / heals / called support (medic, sergeant, lieutenant)
//
// Stats scale with the soldier's level (set by the rarity of the recruit card).

import { TAU, rand } from './rng.js';

export const TEAMMATE_DEFS = {
  infantry: {
    name: 'Infantry', icon: '🪖', sprite: 'team_infantry', role: 'Rifleman',
    blurb: 'steady auto rifle', kind: 'combat',
    maxHp: 60, speed: 200,
    rof: 320, damage: 12, range: 360, projSpeed: 760, projColor: '#dfe6b8',
    projLen: 11, arcCount: 1, arc: 0, pierce: 0,
  },
  gunner: {
    name: 'Machine Gunner', icon: '⚙️', sprite: 'team_gunner', role: 'Suppression',
    blurb: 'high-RPM fire in an arc', kind: 'combat',
    maxHp: 80, speed: 170,
    rof: 750, damage: 9, range: 320, projSpeed: 720, projColor: '#ffe08a',
    projLen: 10, arcCount: 3, arc: 0.35, pierce: 0,
  },
  sniper: {
    name: 'Marksman', icon: '🎯', sprite: 'team_sniper', role: 'Sniper',
    blurb: 'slow long-range one-shots', kind: 'combat',
    maxHp: 45, speed: 185,
    rof: 45, damage: 90, range: 720, projSpeed: 1500, projColor: '#bfe9ff',
    projLen: 20, arcCount: 1, arc: 0, pierce: 3,
  },
  grenadier: {
    name: 'Grenadier', icon: '💣', sprite: 'team_grenadier', role: 'Explosives',
    blurb: 'periodic AoE blasts', kind: 'combat',
    maxHp: 65, speed: 185,
    rof: 38, damage: 55, range: 420, projSpeed: 460, projColor: '#9ad06b',
    projLen: 12, arcCount: 1, arc: 0, pierce: 0, blastRadius: 95,
  },
  medic: {
    name: 'Medic', icon: '✚', sprite: 'team_medic', role: 'Corporal',
    blurb: 'heals the team', kind: 'support',
    maxHp: 70, speed: 200,
    auraRadius: 220, healPerSec: 4,
  },
  sergeant: {
    name: 'Sergeant', icon: '🎖️', sprite: 'team_sergeant', role: 'Leadership',
    blurb: 'buffs nearby allies', kind: 'support',
    maxHp: 90, speed: 195,
    auraRadius: 240, buffDamage: 0.25, buffFireRate: 0.25,
    // sergeant also fights a little
    rof: 240, damage: 14, range: 320, projSpeed: 780, projColor: '#ffe08a', projLen: 11, arcCount: 1, arc: 0, pierce: 0,
  },
  lieutenant: {
    name: 'Lieutenant', icon: '⭐', sprite: 'team_lieutenant', role: 'Officer',
    blurb: 'command aura + airstrikes', kind: 'support',
    maxHp: 110, speed: 185,
    auraRadius: 300, buffDamage: 0.40, buffFireRate: 0.40,
    airstrikeEverySec: 6, airstrikeDamage: 130, airstrikeRadius: 140,
    rof: 200, damage: 18, range: 340, projSpeed: 800, projColor: '#fff0a0', projLen: 12, arcCount: 1, arc: 0, pierce: 0,
  },
};

// Recruitment / offer order (lower rank first; higher rank = rarer/stronger).
export const TEAMMATE_UNLOCK_ORDER = [
  'infantry', 'gunner', 'sniper', 'grenadier', 'medic', 'sergeant', 'lieutenant',
];

function levelScale(level) { return 1 + 0.18 * (level - 1); }

let TEAM_SLOT = 0; // gives each new soldier a stable-ish formation slot

export class Teammate {
  constructor(id, level, x, y) {
    this.id = id;
    this.def = TEAMMATE_DEFS[id];
    this.level = level;
    this.kindCombat = this.def.kind === 'combat' || this.def.rof;
    this.x = x; this.y = y;
    this.angle = 0;
    this.alive = true;

    const sc = levelScale(level);
    this.maxHp = Math.round(this.def.maxHp * sc);
    this.hp = this.maxHp;
    this.damageScale = sc;
    this.radius = 15;
    this.invuln = 0;

    this.slot = TEAM_SLOT++;
    this.fireCd = 0;
    this.airstrikeCd = (this.def.airstrikeEverySec ?? 0) * 1000;
    this.flash = 0;
  }

  formationTarget(player, total) {
    // Spread soldiers around the player on a ring; ring grows with party size.
    const ringSize = Math.max(6, total);
    const a = (this.slot % ringSize) / ringSize * TAU + player.moveAngle * 0.0;
    const r = 64 + Math.floor(this.slot / ringSize) * 40;
    return { x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r };
  }

  takeDamage(amount) {
    if (this.invuln > 0) return;
    this.hp -= amount;
    this.invuln = 250;
    this.flash = 90;
    if (this.hp <= 0) this.alive = false;
  }

  update(dtMs, game, total, buffs) {
    const dt = dtMs / 1000;
    if (this.invuln > 0) this.invuln -= dtMs;
    if (this.flash > 0) this.flash -= dtMs;

    // Move toward formation slot.
    const slot = this.formationTarget(game.player, total);
    const dx = slot.x - this.x, dy = slot.y - this.y;
    const dist = Math.hypot(dx, dy);
    const sp = this.def.speed * 1.0;
    if (dist > 4) {
      const step = Math.min(dist, sp * dt);
      this.x += dx / dist * step;
      this.y += dy / dist * step;
      this.moveAngle = Math.atan2(dy, dx);
    }

    // Aim at nearest enemy if one is in range; otherwise face travel dir.
    const range = this.def.range ?? this.def.auraRadius ?? 300;
    const target = game.findNearestEnemy(this.x, this.y, range);
    if (target) this.angle = Math.atan2(target.y - this.y, target.x - this.x);
    else if (this.moveAngle !== undefined) this.angle = this.moveAngle;

    // Support behaviours
    if (this.def.healPerSec) {
      game.healAround(this.x, this.y, this.def.auraRadius, this.def.healPerSec * this.damageScale * dt);
    }
    if (this.def.airstrikeEverySec) {
      this.airstrikeCd -= dtMs;
      if (this.airstrikeCd <= 0) {
        this.airstrikeCd = this.def.airstrikeEverySec * 1000;
        const t = game.findNearestEnemy(this.x, this.y, 900) || { x: game.player.x, y: game.player.y };
        game.doExplosion(t.x, t.y, this.def.airstrikeRadius, this.def.airstrikeDamage * this.damageScale, true);
      }
    }

    // Combat firing (some support ranks also shoot)
    if (this.def.rof && target) {
      this.fireCd -= dtMs;
      if (this.fireCd <= 0) {
        const fireRateBuff = 1 + (buffs.fireRate || 0);
        this.fireCd += 60000 / (this.def.rof * fireRateBuff);
        this.fire(game, target, buffs);
      }
    }
  }

  fire(game, target, buffs) {
    const def = this.def;
    // Pick a sound texture from the soldier's weapon profile (throttled globally).
    if (game.audio) game.audio.shot(def.arcCount > 1 ? 'lmg' : def.pierce > 2 ? 'rifle' : 'smg');
    const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
    const dmg = def.damage * this.damageScale * (1 + (buffs.damage || 0));
    const count = def.arcCount || 1;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
      const a = baseAngle + t * (def.arc || 0) + rand(-0.02, 0.02);
      game.spawnAllyBullet({
        x: this.x, y: this.y, angle: a, speed: def.projSpeed,
        damage: dmg, color: def.projColor, len: def.projLen,
        pierce: def.pierce || 0,
        blastRadius: def.blastRadius || 0,
      });
    }
  }
}

// Team manager: owns the soldiers, computes leadership auras, updates all.
export class Team {
  constructor() { this.members = []; }

  recruit(id, level, player) {
    const a = rand(0, TAU);
    const t = new Teammate(id, level, player.x + Math.cos(a) * 60, player.y + Math.sin(a) * 60);
    this.members.push(t);
    return t;
  }

  get count() { return this.members.length; }

  // Buffs each combat soldier gets from nearby support ranks (sergeant/officer).
  buffsFor(member) {
    let damage = 0, fireRate = 0;
    for (const s of this.members) {
      if (s === member || !s.alive) continue;
      if (!s.def.buffDamage && !s.def.buffFireRate) continue;
      const d = Math.hypot(s.x - member.x, s.y - member.y);
      if (d <= s.def.auraRadius) {
        damage = Math.max(damage, s.def.buffDamage || 0);
        fireRate = Math.max(fireRate, s.def.buffFireRate || 0);
      }
    }
    return { damage, fireRate };
  }

  update(dtMs, game) {
    const total = this.members.length;
    for (const m of this.members) {
      if (!m.alive) continue;
      m.update(dtMs, game, total, this.buffsFor(m));
    }
    // Remove downed soldiers.
    this.members = this.members.filter((m) => m.alive);
  }

  // Summary counts by rank for the HUD.
  summary() {
    const counts = {};
    for (const m of this.members) counts[m.id] = (counts[m.id] || 0) + 1;
    return counts;
  }

  clear() { this.members.length = 0; TEAM_SLOT = 0; }
}
