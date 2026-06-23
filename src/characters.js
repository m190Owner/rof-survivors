// Playable characters. Each is data-driven: a starting firearm, a stat profile,
// a distinct sprite, and ONE active ability gated behind a cooldown (activate
// with Space / the on-screen button). Add an entry here + a sprite in sprites.js
// and it shows up on the select screen automatically.
//
// ability.activate(game) runs the effect. cooldownMs is how long until it can be
// used again. Buff-style abilities apply a timed buff to the player.

import { TAU, rand } from './rng.js';

export const CHARACTER_DEFS = {
  commando: {
    name: 'The Commando',
    blurb: 'Rugged one-man army. Balanced and relentless.',
    sprite: 'char_commando',
    startWeapon: 'glock17',
    maxHp: 100, speed: 210, pickupRangeAdd: 0, hpRegen: 0,
    ability: {
      name: 'Adrenaline Rush', icon: '⚡',
      desc: 'Double fire rate + 50% move speed for 6s',
      cooldownMs: 20000,
      activate: (g) => {
        g.player.applyAbilityBuff(2.0, 1.5, 6000);
        g.announce('ADRENALINE RUSH');
        g.shakeCamera(4);
      },
    },
    // Loop reward (earned each time you clear all four biomes; press E).
    loopPower: {
      name: 'Strafing Run', icon: '✈️',
      pattern: 'sweep', planes: 1, count: 16, radius: 72, damage: 130, durationMs: 1700,
    },
  },

  heavy: {
    name: 'The Heavy',
    blurb: 'Walking tank with the SAW. Slow but unbreakable.',
    sprite: 'char_heavy',
    startWeapon: 'm249',
    maxHp: 160, speed: 178, pickupRangeAdd: 0, hpRegen: 0,
    ability: {
      name: 'Suppressing Barrage', icon: '💥',
      desc: 'Fire a 360° ring of piercing rounds',
      cooldownMs: 16000,
      activate: (g) => {
        const p = g.player;
        const dmg = p.strongestShotDamage() * 1.2;
        const n = 30;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          g.spawnAllyBullet({ x: p.x, y: p.y, angle: a, speed: 800, damage: dmg, color: '#ffd27b', len: 14, pierce: 2 });
        }
        g.announce('SUPPRESSING FIRE');
        g.shakeCamera(8);
      },
    },
    loopPower: {
      name: 'Artillery Barrage', icon: '💣',
      pattern: 'scatter', count: 22, radius: 88, damage: 170, durationMs: 2600,
    },
  },

  demo: {
    name: 'The Demolisher',
    blurb: 'Brings the boom. AK-47 and an airstrike on call.',
    sprite: 'char_demo',
    startWeapon: 'ak47',
    maxHp: 110, speed: 200, pickupRangeAdd: 0, hpRegen: 0,
    ability: {
      name: 'Airstrike', icon: '🚀',
      desc: 'Call in explosions on the nearest enemies',
      cooldownMs: 14000,
      activate: (g) => {
        const p = g.player;
        const dmg = p.strongestShotDamage() * 7;
        const t = g.findNearestEnemy(p.x, p.y, 1400) || p;
        for (let i = 0; i < 3; i++) {
          const dx = rand(-120, 120), dy = rand(-120, 120);
          g.doExplosion(t.x + (i === 0 ? 0 : dx), t.y + (i === 0 ? 0 : dy), 150, dmg, true);
        }
        g.announce('AIRSTRIKE INBOUND');
      },
    },
    loopPower: {
      name: 'Carpet Bombers', icon: '🛩️',
      pattern: 'carpet', planes: 3, count: 30, radius: 76, damage: 150, durationMs: 2400,
    },
  },

  medic: {
    name: 'The Operative',
    blurb: 'Field medic. Fast, scavenges XP, patches up.',
    sprite: 'char_medic',
    startWeapon: 'mp5',
    maxHp: 90, speed: 218, pickupRangeAdd: 40, hpRegen: 0.5,
    ability: {
      name: 'Field Medkit', icon: '✚',
      desc: 'Heal 50% HP and gain 3s of invulnerability',
      cooldownMs: 22000,
      activate: (g) => {
        const p = g.player;
        p.heal(p.maxHp * 0.5);
        p.invuln = Math.max(p.invuln, 3000);
        g.fx.spawn({ type: 'explosion', x: p.x, y: p.y, radius: 60, life: 0.4, maxLife: 0.4 });
        g.addDamageNumber(p.x, p.y - 30, Math.round(p.maxHp * 0.5), '#7fff8a', true);
        g.announce('PATCHED UP');
      },
    },
    loopPower: {
      name: 'Gunship Support', icon: '🚁',
      pattern: 'sweep', planes: 1, count: 14, radius: 66, damage: 110, durationMs: 1900, healTeam: true,
    },
  },
};

export const CHARACTER_ORDER = ['commando', 'heavy', 'demo', 'medic'];
