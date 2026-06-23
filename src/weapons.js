// Real firearms. Each weapon's BASE fire rate is its authentic real-world cyclic
// rate of fire (RPM). We convert to a per-shot cooldown:
//
//     cooldown_ms = 60000 / effective_RPM
//     effective_RPM = base_RPM * player.fireRateMultiplier
//
// The fire-rate multiplier starts at 1.0 and ONLY changes when the player picks
// a "Fire rate" upgrade card. Nothing else touches base RPM.

import { rand } from './rng.js';

// rof = real cyclic rate of fire in rounds/min.
// damage/speed/mag/reloadMs/spread are gameplay-authentic-ish, tunable here.
export const WEAPON_DEFS = {
  glock17: {
    name: 'Glock 17', sound: 'pistol', rof: 1200, damage: 9, speed: 720, mag: 17,
    reloadMs: 1300, spread: 0.06, projectiles: 1, color: '#ffe08a', bulletLen: 9,
  },
  m9: {
    name: 'Beretta M9', sound: 'pistol', rof: 1100, damage: 10, speed: 720, mag: 15,
    reloadMs: 1400, spread: 0.06, projectiles: 1, color: '#ffe08a', bulletLen: 9,
  },
  mp5: {
    name: 'MP5', sound: 'smg', rof: 800, damage: 12, speed: 780, mag: 30,
    reloadMs: 1700, spread: 0.07, projectiles: 1, color: '#fff0a0', bulletLen: 10,
  },
  uzi: {
    name: 'Uzi', sound: 'smg', rof: 600, damage: 11, speed: 700, mag: 32,
    reloadMs: 1600, spread: 0.10, projectiles: 1, color: '#fff0a0', bulletLen: 9,
  },
  p90: {
    name: 'P90', sound: 'smg', rof: 900, damage: 13, speed: 820, mag: 50,
    reloadMs: 2000, spread: 0.06, projectiles: 1, color: '#d6ffa0', bulletLen: 10,
  },
  ak47: {
    name: 'AK-47', sound: 'rifle', rof: 600, damage: 24, speed: 900, mag: 30,
    reloadMs: 2200, spread: 0.05, projectiles: 1, color: '#ffc46b', bulletLen: 13,
  },
  m4: {
    name: 'M16 / M4', sound: 'rifle', rof: 850, damage: 20, speed: 950, mag: 30,
    reloadMs: 2000, spread: 0.04, projectiles: 1, color: '#ffd27b', bulletLen: 13,
  },
  m249: {
    name: 'M249 SAW', sound: 'lmg', rof: 800, damage: 22, speed: 920, mag: 100,
    reloadMs: 4200, spread: 0.08, projectiles: 1, color: '#ffb84b', bulletLen: 14,
  },
  minigun: {
    name: 'Minigun M134', sound: 'minigun', rof: 3000, damage: 14, speed: 1000, mag: 200,
    reloadMs: 3500, spread: 0.12, projectiles: 1, color: '#ff9a3b', bulletLen: 14,
  },
};

// Order weapons can be unlocked in (starting weapon excluded at runtime).
export const WEAPON_UNLOCK_ORDER = ['m9', 'mp5', 'ak47', 'm4', 'uzi', 'p90', 'm249', 'minigun'];

export class Weapon {
  constructor(id) {
    this.id = id;
    this.def = WEAPON_DEFS[id];
    this.ammo = this.def.mag;
    this.cooldown = 0;     // ms until next shot allowed
    this.reloadLeft = 0;   // ms remaining on reload (0 = not reloading)
    this.startedReload = false; // set the frame a reload begins (for SFX)
    this.magBonus = 0;     // from upgrades (shared via player, but cached per shot)
  }

  get reloading() { return this.reloadLeft > 0; }

  effectiveRpm(player) {
    // Includes the temporary ability buff (e.g. Adrenaline Rush) on top of the
    // upgrade-driven multiplier. Base RoF is always the real-world RPM.
    return this.def.rof * player.totalFireRateMult;
  }

  maxAmmo(player) {
    return this.def.mag + player.magSizeAdd;
  }

  // Advance timers and fire if able. Returns an array of projectile specs to
  // spawn this frame (usually 0 or 1 shot's worth, possibly several bullets).
  update(dtMs, player, aimAngle) {
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dtMs;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        this.ammo = this.maxAmmo(player);
      }
      return null;
    }

    this.cooldown -= dtMs;
    if (this.cooldown > 0) return null;

    if (this.ammo <= 0) {
      // Reload time is shortened by the reload-speed multiplier.
      this.reloadLeft = this.def.reloadMs / player.reloadSpeedMultiplier;
      this.startedReload = true;
      return null;
    }

    // Fire one shot.
    const rpm = this.effectiveRpm(player);
    this.cooldown += 60000 / rpm; // accumulate so high RPM stays accurate
    if (this.cooldown < 0) this.cooldown = 0;
    this.ammo--;

    const shots = [];
    const count = this.def.projectiles + player.bulletsAdd;
    const spread = this.def.spread * player.spreadMultiplier;
    // Spread the extra bullets into a fan.
    const spanArc = spread * Math.max(1, count - 1) + (count > 1 ? 0.06 * (count - 1) : 0);
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
      const jitter = rand(-spread, spread);
      const a = aimAngle + t * spanArc + jitter;
      shots.push({
        angle: a,
        speed: this.def.speed * player.projectileSpeedMultiplier,
        damage: this.def.damage * player.damageMultiplier,
        color: this.def.color,
        len: this.def.bulletLen,
      });
    }
    return shots;
  }
}
