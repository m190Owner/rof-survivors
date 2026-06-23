// Central tuning + shared constants. Balance lives here and in upgrades.js.

export const WORLD = {
  // Camera follows the player; the world is effectively unbounded but we keep
  // a soft arena radius so enemies always have somewhere to come from.
  arenaRadius: 2600,
  bgTile: 64,
};

export const PLAYER = {
  maxHp: 100,
  speed: 210,          // px / second
  radius: 18,
  pickupRange: 70,     // base XP magnet radius
  hpRegen: 0,          // per second, raised only by upgrades
  invulnMs: 350,       // i-frames after taking a hit
  startWeapon: 'glock17',
};

export const XP = {
  // XP required to reach the *next* level: base * level^growth
  base: 5,
  growth: 1.55,
  gemMagnetSpeed: 460,
};

export const RARITIES = [
  { id: 'common',    name: 'Common',    tier: 0, weight: 50, color: '#b8c0c8' },
  { id: 'uncommon',  name: 'Uncommon',  tier: 1, weight: 28, color: '#4caf50' },
  { id: 'rare',      name: 'Rare',      tier: 2, weight: 14, color: '#2196f3' },
  { id: 'epic',      name: 'Epic',      tier: 3, weight: 6,  color: '#9c27b0' },
  { id: 'legendary', name: 'Legendary', tier: 4, weight: 2,  color: '#ff9800' },
];

export const COLORS = {
  player: '#cfa15a',
  ally: '#7fa86b',
  enemy: '#7d3a3a',
  xp: '#4fd1ff',
  bgA: '#1c2218',
  bgB: '#222a1c',
};

// Difficulty curve helpers (functions of elapsed seconds).
export const DIFFICULTY = {
  // Enemies alive cap grows over time.
  maxEnemies: (t) => Math.min(700, 60 + t * 2.4),
  // Seconds between spawn pulses shrinks over time.
  spawnInterval: (t) => Math.max(0.22, 1.4 - t * 0.012),
  // Enemies per pulse grows.
  spawnBatch: (t) => Math.floor(2 + t * 0.06),
  // Global HP/damage multiplier ramps slowly.
  statScale: (t) => 1 + t * 0.018,
  eliteEvery: 35,   // seconds
  bossEvery: 120,   // seconds
};
