// The player: a chosen commando (see characters.js).
//
// IMPORTANT: every growth modifier below starts at its neutral value. XP does
// NOT raise any stat. The ONLY thing that changes these is a chosen upgrade card
// (see upgrades.js) — except for the temporary ability buff, which is the
// character's active power. fireRateMultiplier starts at 1.0 so each gun fires
// at its true real-world RPM until a Fire-rate card is picked.

import { PLAYER, XP } from './config.js';
import { Weapon } from './weapons.js';

export class Player {
  constructor(charDef, x, y) {
    this.char = charDef;
    this.sprite = charDef.sprite;
    this.x = x; this.y = y;
    this.radius = PLAYER.radius;
    this.angle = 0;
    this.moveAngle = 0;

    this.maxHp = charDef.maxHp ?? PLAYER.maxHp;
    this.hp = this.maxHp;
    this.invuln = 0;
    this.baseSpeed = charDef.speed ?? PLAYER.speed;

    this.level = 1;
    this.xp = 0;
    this.xpToNext = this.xpRequired(1);
    this.kills = 0;

    // ----- Upgrade-driven modifiers (neutral at start) -----
    this.fireRateMultiplier = 1.0;
    this.damageMultiplier = 1.0;
    this.projectileSpeedMultiplier = 1.0;
    this.reloadSpeedMultiplier = 1.0;
    this.spreadMultiplier = 1.0;
    this.speedMultiplier = 1.0;
    this.bulletsAdd = 0;
    this.magSizeAdd = 0;
    this.pickupRangeAdd = charDef.pickupRangeAdd ?? 0;
    this.hpRegen = charDef.hpRegen ?? PLAYER.hpRegen;

    // ----- Active ability (cooldown + temporary buff) -----
    this.ability = charDef.ability;
    this.abilityCdLeft = 0;          // ms until usable again
    this.abilityFireRateMult = 1.0;  // temporary buff layer
    this.abilitySpeedMult = 1.0;
    this.buffLeft = 0;               // ms remaining on the active buff

    this.weapons = [new Weapon(charDef.startWeapon)];
  }

  get speed() { return this.baseSpeed * this.speedMultiplier * this.abilitySpeedMult; }
  get pickupRange() { return PLAYER.pickupRange + this.pickupRangeAdd; }

  // Fire-rate multiplier actually applied to weapons (upgrades × ability buff).
  get totalFireRateMult() { return this.fireRateMultiplier * this.abilityFireRateMult; }

  xpRequired(level) { return Math.round(XP.base * Math.pow(level, XP.growth)); }

  ownsWeapon(id) { return this.weapons.some((w) => w.id === id); }
  addWeapon(id) { if (!this.ownsWeapon(id)) this.weapons.push(new Weapon(id)); }

  gainXp(amount) {
    this.xp += amount;
    let levels = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = this.xpRequired(this.level);
      levels++;
    }
    return levels;
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

  takeDamage(amount) {
    if (this.invuln > 0) return false;
    this.hp -= amount;
    this.invuln = PLAYER.invulnMs;
    return true;
  }

  // ----- ability -----
  applyAbilityBuff(fireRateMult, speedMult, durationMs) {
    this.abilityFireRateMult = fireRateMult;
    this.abilitySpeedMult = speedMult;
    this.buffLeft = durationMs;
  }

  tryActivateAbility(game) {
    if (this.abilityCdLeft > 0) return false;
    this.ability.activate(game);
    this.abilityCdLeft = this.ability.cooldownMs;
    return true;
  }

  abilityReady() { return this.abilityCdLeft <= 0; }
  // 0..1 progress toward being ready again.
  abilityCooldownFrac() {
    if (this.abilityCdLeft <= 0) return 1;
    return 1 - this.abilityCdLeft / this.ability.cooldownMs;
  }

  updateAbility(dtMs) {
    if (this.abilityCdLeft > 0) this.abilityCdLeft -= dtMs;
    if (this.buffLeft > 0) {
      this.buffLeft -= dtMs;
      if (this.buffLeft <= 0) { this.abilityFireRateMult = 1.0; this.abilitySpeedMult = 1.0; }
    }
  }

  // Highest base shot damage (× damage upgrades) — used to scale abilities.
  strongestShotDamage() {
    let d = 0;
    for (const w of this.weapons) d = Math.max(d, w.def.damage);
    return d * this.damageMultiplier;
  }

  topRpm() {
    let best = 0;
    for (const w of this.weapons) best = Math.max(best, w.effectiveRpm(this));
    return Math.round(best);
  }
}
