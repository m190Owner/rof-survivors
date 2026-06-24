// Meta-progression: a tiny localStorage save with coins, permanent upgrades, and
// operator unlocks. Coins are earned per run; spent in the between-runs shop.
// All balance lives in the tables below.

const KEY = 'rof_save_v1';

const DEFAULT = {
  coins: 0,
  upgrades: {},          // { maxhp: level, damage: level, ... }
  unlockedChars: ['commando'],
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
    };
  } catch {
    return { ...DEFAULT, upgrades: {}, unlockedChars: ['commando'] };
  }
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function upgradeCost(key, level) {
  const u = META_UPGRADES[key];
  return Math.round(u.baseCost * Math.pow(u.costMul, level));
}

// Coins awarded for a run: rewards both survival time and kills.
export function coinsForRun(elapsedSec, kills, stagesCleared) {
  return Math.floor(elapsedSec / 2 + kills / 5 + stagesCleared * 25);
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
}
