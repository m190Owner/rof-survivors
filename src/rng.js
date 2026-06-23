// Small RNG helpers. Math.random under the hood; swap to a seeded PRNG here if
// deterministic runs are ever needed.

export const rand = (min = 0, max = 1) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

// Weighted pick: items must each expose a numeric `weight`.
export function weightedPick(items) {
  let total = 0;
  for (const it of items) total += it.weight;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export const TAU = Math.PI * 2;
