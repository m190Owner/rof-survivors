// Data-driven, rarity-scaled upgrade system.
//
// Every upgrade is one entry with a 5-element `values` array indexed by rarity
// tier [Common, Uncommon, Rare, Epic, Legendary]. All balancing lives in this
// one table. On level-up we roll 3 cards; each card rolls a rarity (weighted in
// config.js) which scales its magnitude AND tints its colour.

import { RARITIES } from './config.js';
import { weightedPick, rand } from './rng.js';
import { WEAPON_DEFS, WEAPON_UNLOCK_ORDER } from './weapons.js';
import { TEAMMATE_DEFS, TEAMMATE_UNLOCK_ORDER } from './teammates.js';

const pct = (v) => `+${Math.round(v * 100)}%`;

// kind: 'stat' (always offered), 'weapon' (offered if a weapon remains),
//       'recruit' (offered if a rank remains / repeatable).
export const UPGRADES = {
  firerate: {
    name: 'Fire Rate', icon: '🔥', kind: 'stat',
    values: [0.05, 0.08, 0.12, 0.18, 0.25],
    desc: (v) => `${pct(v)} fire rate (RPM)`,
    apply: (g, v) => { g.player.fireRateMultiplier *= 1 + v; },
  },
  bullets: {
    name: 'Bullets', icon: '🎯', kind: 'stat',
    values: [1, 2, 3, 4, 5],
    desc: (v) => `+${v} projectile${v > 1 ? 's' : ''} per shot`,
    apply: (g, v) => { g.player.bulletsAdd += v; },
  },
  health: {
    name: 'Health', icon: '❤️', kind: 'stat',
    values: [20, 40, 60, 80, 100],
    desc: (v) => `+${v} max HP (and heal)`,
    apply: (g, v) => { g.player.maxHp += v; g.player.heal(v); },
  },
  damage: {
    name: 'Damage', icon: '💥', kind: 'stat',
    values: [0.08, 0.12, 0.18, 0.25, 0.35],
    desc: (v) => `${pct(v)} weapon damage`,
    apply: (g, v) => { g.player.damageMultiplier *= 1 + v; },
  },
  projspeed: {
    name: 'Muzzle Velocity', icon: '➡️', kind: 'stat',
    values: [0.10, 0.15, 0.20, 0.30, 0.40],
    desc: (v) => `${pct(v)} projectile speed`,
    apply: (g, v) => { g.player.projectileSpeedMultiplier *= 1 + v; },
  },
  magsize: {
    name: 'Magazine', icon: '📦', kind: 'stat',
    values: [2, 4, 6, 9, 14],
    desc: (v) => `+${v} magazine size`,
    apply: (g, v) => { g.player.magSizeAdd += v; },
  },
  reload: {
    name: 'Reload Speed', icon: '🔄', kind: 'stat',
    values: [0.08, 0.12, 0.18, 0.25, 0.35],
    desc: (v) => `${pct(v)} faster reload`,
    apply: (g, v) => { g.player.reloadSpeedMultiplier *= 1 + v; },
  },
  accuracy: {
    name: 'Accuracy', icon: '🎯', kind: 'stat',
    values: [0.08, 0.12, 0.18, 0.25, 0.40],
    desc: (v) => `${pct(v)} tighter spread`,
    apply: (g, v) => { g.player.spreadMultiplier *= 1 - v; },
  },
  movespeed: {
    name: 'Move Speed', icon: '👟', kind: 'stat',
    values: [0.05, 0.08, 0.12, 0.16, 0.22],
    desc: (v) => `${pct(v)} move speed`,
    apply: (g, v) => { g.player.speedMultiplier *= 1 + v; },
  },
  pickup: {
    name: 'Pickup Range', icon: '🧲', kind: 'stat',
    values: [20, 35, 55, 80, 120],
    desc: (v) => `+${v} XP pickup range`,
    apply: (g, v) => { g.player.pickupRangeAdd += v; },
  },
  regen: {
    name: 'Regeneration', icon: '✚', kind: 'stat',
    values: [0.2, 0.4, 0.7, 1.1, 1.6],
    desc: (v) => `+${v}/s HP regen`,
    apply: (g, v) => { g.player.hpRegen += v; },
  },
};

function rollRarity() {
  return weightedPick(RARITIES);
}

// Build the list of cards a card could currently be. Stats are always eligible;
// weapon/recruit cards only when something remains to unlock.
function eligiblePool(game) {
  const pool = [];

  for (const id of Object.keys(UPGRADES)) {
    pool.push({ type: 'stat', id });
  }

  // A new weapon to unlock?
  const lockable = WEAPON_UNLOCK_ORDER.filter((w) => !game.player.ownsWeapon(w));
  if (lockable.length) pool.push({ type: 'weapon', id: lockable[0], extra: lockable });

  // A new teammate rank to recruit (or upgrade an existing one)?
  for (const rank of TEAMMATE_UNLOCK_ORDER) {
    pool.push({ type: 'recruit', id: rank });
  }

  return pool;
}

// Roll 3 distinct cards.
export function generateCards(game) {
  const pool = eligiblePool(game);
  const cards = [];
  const usedKeys = new Set();
  let guard = 0;

  while (cards.length < 3 && guard++ < 60) {
    const entry = pool[(Math.random() * pool.length) | 0];
    const rarity = rollRarity();
    const key = `${entry.type}:${entry.id}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    cards.push(buildCard(entry, rarity, game));
  }

  // Fallback: if somehow short (tiny pool), allow duplicate stat cards.
  while (cards.length < 3) {
    const id = Object.keys(UPGRADES)[(Math.random() * Object.keys(UPGRADES).length) | 0];
    cards.push(buildCard({ type: 'stat', id }, rollRarity(), game));
  }
  return cards;
}

function buildCard(entry, rarity, game) {
  if (entry.type === 'stat') {
    const u = UPGRADES[entry.id];
    const value = u.values[rarity.tier];
    return {
      kind: 'stat', id: entry.id, rarity,
      name: u.name, icon: u.icon, desc: u.desc(value),
      kindLabel: 'Upgrade',
      apply: () => u.apply(game, value),
    };
  }
  if (entry.type === 'weapon') {
    const lockable = entry.extra;
    const wid = lockable[(Math.random() * lockable.length) | 0];
    const def = WEAPON_DEFS[wid];
    return {
      kind: 'weapon', id: wid, rarity,
      name: def.name, icon: '🔫', desc: `New weapon · ${def.rof} RPM`,
      kindLabel: 'Firearm',
      apply: () => game.player.addWeapon(wid),
    };
  }
  // recruit
  const def = TEAMMATE_DEFS[entry.id];
  // Rarity tier sets the recruited soldier's starting level (1..5).
  const tlevel = rarity.tier + 1;
  return {
    kind: 'recruit', id: entry.id, rarity,
    name: def.name, icon: def.icon, desc: `${def.role} · ${def.blurb}`,
    kindLabel: 'Recruit',
    apply: () => game.recruit(entry.id, tlevel),
  };
}
