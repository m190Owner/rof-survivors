// Meta-progression: a tiny localStorage save with coins, permanent upgrades, and
// operator unlocks. Coins are earned per run; spent in the between-runs shop.
// All balance lives in the tables below.

const KEY = 'rof_save_v1';

const DEFAULT = {
  coins: 0,
  upgrades: {},          // { maxhp: level, damage: level, ... }
  unlockedChars: ['commando'],
  overclock: {},         // uncapped endgame upgrades: { oc_damage: level, ... }
  loadout: {},           // equipped per-run consumables: { extraStrike: true, ... }
};

// Permanent upgrades. cost(level) = round(baseCost * costMul^level).
export const META_UPGRADES = {
  maxhp:     { name: 'Vitality',     icon: '❤️', max: 8, baseCost: 40, costMul: 1.5,  per: 20,   fmt: (l) => `+${l * 20} max HP` },
  damage:    { name: 'Firepower',    icon: '💥', max: 8, baseCost: 50, costMul: 1.55, per: 0.06, fmt: (l) => `+${Math.round(l * 6)}% damage` },
  firerate:  { name: 'Trigger Discipline', icon: '🔥', max: 6, baseCost: 60, costMul: 1.6, per: 0.05, fmt: (l) => `+${Math.round(l * 5)}% fire rate` },
  movespeed: { name: 'Conditioning', icon: '👟', max: 6, baseCost: 45, costMul: 1.5,  per: 0.04, fmt: (l) => `+${Math.round(l * 4)}% move speed` },
  magnet:    { name: 'Magnetism',    icon: '🧲', max: 5, baseCost: 35, costMul: 1.5,  per: 30,   fmt: (l) => `+${l * 30} pickup range` },
  regen:     { name: 'Field Medic',  icon: '✚', max: 5, baseCost: 55, costMul: 1.55, per: 0.4,  fmt: (l) => `+${(l * 0.4).toFixed(1)}/s HP regen` },
};

// One-time operator unlocks (commando is always available).
export const OPERATOR_UNLOCKS = { heavy: 120, demo: 160, medic: 200 };

// Uncapped "Overclock" upgrades — the endgame sink. No max level; small bonus
// per level with an escalating cost, so there's always something to buy.
export const OVERCLOCK = {
  oc_damage:   { name: 'OC: Damage',    icon: '💥', base: 60, growth: 1.11, per: 0.03,  fmt: (l) => `+${Math.round(l * 3)}% damage` },
  oc_health:   { name: 'OC: Vitality',  icon: '❤️', base: 50, growth: 1.11, per: 12,    fmt: (l) => `+${l * 12} max HP` },
  oc_firerate: { name: 'OC: Fire Rate', icon: '🔥', base: 70, growth: 1.12, per: 0.02,  fmt: (l) => `+${Math.round(l * 2)}% fire rate` },
  oc_speed:    { name: 'OC: Speed',     icon: '👟', base: 55, growth: 1.11, per: 0.015, fmt: (l) => `+${Math.round(l * 1.5)}% move speed` },
};
export function overclockCost(key, level) {
  const u = OVERCLOCK[key];
  return Math.round(u.base * Math.pow(u.growth, level));
}

// Per-run loadout consumables — salvage paid on every deploy that has them equipped.
export const LOADOUT = {
  extraStrike: { name: 'Combat Drop',   icon: '✈️', cost: 150, desc: 'Start with +1 airstrike charge' },
  sidearm:     { name: 'Sidearm Crate', icon: '🔫', cost: 250, desc: 'Start with a bonus M4 carbine' },
  greed:       { name: 'Salvage Beacon', icon: '🪙', cost: 200, desc: '+50% salvage earned this run' },
  revive:      { name: 'Revive Kit',    icon: '✚', cost: 400, desc: 'Cheat death once (revive at 50% HP)' },
};
export function loadoutCost(save) {
  let c = 0;
  for (const id of Object.keys(LOADOUT)) if (save.loadout && save.loadout[id]) c += LOADOUT[id].cost;
  return c;
}

// ---- Settings (separate key; volume + screen-shake toggle) ----
const SKEY = 'rof_settings_v1';
// autoLevel: 0 = manual (pick cards yourself), 1 = auto-pick random, 2 = auto-pick best rarity.
const DEFAULT_SETTINGS = { volume: 0.7, shake: true, autoLevel: 0 };

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SKEY)) || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function writeSettings(s) {
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, upgrades: {}, unlockedChars: ['commando'] };
    const s = JSON.parse(raw);
    return {
      coins: s.coins || 0,
      upgrades: s.upgrades || {},
      unlockedChars: s.unlockedChars && s.unlockedChars.length ? s.unlockedChars : ['commando'],
      overclock: s.overclock || {},
      loadout: s.loadout || {},
    };
  } catch {
    return { ...DEFAULT, upgrades: {}, unlockedChars: ['commando'], overclock: {}, loadout: {} };
  }
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function upgradeCost(key, level) {
  const u = META_UPGRADES[key];
  return Math.round(u.baseCost * Math.pow(u.costMul, level));
}

// Coins awarded for a run: rewards both survival time and kills. `mult` carries
// the Salvage Beacon loadout bonus.
export function coinsForRun(elapsedSec, kills, stagesCleared, mult = 1) {
  return Math.floor((elapsedSec / 2 + kills / 5 + stagesCleared * 25) * mult);
}

// Apply the player's purchased permanent upgrades at run start.
export function applyMetaBonuses(player, save) {
  const lv = (k) => save.upgrades[k] || 0;
  const u = META_UPGRADES;
  if (lv('maxhp'))     { const add = lv('maxhp') * u.maxhp.per; player.maxHp += add; player.hp = player.maxHp; }
  if (lv('damage'))    player.damageMultiplier *= 1 + lv('damage') * u.damage.per;
  if (lv('firerate'))  player.fireRateMultiplier *= 1 + lv('firerate') * u.firerate.per;
  if (lv('movespeed')) player.speedMultiplier *= 1 + lv('movespeed') * u.movespeed.per;
  if (lv('magnet'))    player.pickupRangeAdd += lv('magnet') * u.magnet.per;
  if (lv('regen'))     player.hpRegen += lv('regen') * u.regen.per;

  // Uncapped Overclock upgrades.
  const oc = save.overclock || {};
  if (oc.oc_damage)   player.damageMultiplier *= 1 + oc.oc_damage * OVERCLOCK.oc_damage.per;
  if (oc.oc_health)   { player.maxHp += oc.oc_health * OVERCLOCK.oc_health.per; player.hp = player.maxHp; }
  if (oc.oc_firerate) player.fireRateMultiplier *= 1 + oc.oc_firerate * OVERCLOCK.oc_firerate.per;
  if (oc.oc_speed)    player.speedMultiplier *= 1 + oc.oc_speed * OVERCLOCK.oc_speed.per;
}
