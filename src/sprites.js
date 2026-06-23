// Sprite system.
//
// Every visual is a named, swappable sprite. Out of the box we generate detailed,
// shaded top-down military art procedurally so the game runs with zero binary
// assets. If a matching PNG exists under /assets it is loaded and transparently
// replaces the placeholder (see ASSET_MANIFEST + initSprites).
//
// All sprites are authored FACING RIGHT (+x). The renderer rotates them to the
// unit's aim direction. Shadows are drawn at render time (not baked in).

const SPRITES = new Map();

// Render at 2x then store; drawn scaled-down in-game for crisp, anti-aliased edges.
const SS = 2;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size * SS; c.height = size * SS;
  c.logicalSize = size;
  const ctx = c.getContext('2d');
  ctx.scale(SS, SS);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { c, ctx };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shade a darker version of a hex colour by `amt` (-1..1).
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p);
  g = Math.round(g + (f - g) * p);
  b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
}

const OUTLINE = 'rgba(15,18,12,0.55)';

function filledEllipse(ctx, x, y, rx, ry, fill, outline = true) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  if (outline) { ctx.lineWidth = 1.2; ctx.strokeStyle = OUTLINE; ctx.stroke(); }
}

// ---- Generic top-down soldier (friendly faction) ----
function drawSoldier(size, o) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2;
  const s = size / 40;
  const body = o.body;

  // Legs (behind the torso, pointing back -x)
  ctx.fillStyle = shade(body, -0.35);
  for (const sgn of [-1, 1]) {
    rr(ctx, cx - 9 * s, cy + sgn * 2.5 * s - 2 * s, 7 * s, 4 * s, 2 * s);
    ctx.fill();
  }
  // Boots
  ctx.fillStyle = '#20251a';
  for (const sgn of [-1, 1]) {
    rr(ctx, cx - 11 * s, cy + sgn * 2.5 * s - 1.6 * s, 3 * s, 3.2 * s, 1.2 * s);
    ctx.fill();
  }

  // Weapon (under the hands)
  drawGun(ctx, cx, cy, s, o);

  // Torso / shoulders with radial shading
  const depth = (o.depth ?? 8) * s, shoulder = (o.shoulder ?? 11) * s;
  const grad = ctx.createRadialGradient(cx - depth * 0.3, cy - shoulder * 0.3, 1, cx, cy, shoulder * 1.3);
  grad.addColorStop(0, shade(body, 0.22));
  grad.addColorStop(1, shade(body, -0.12));
  ctx.beginPath();
  ctx.ellipse(cx, cy, depth, shoulder, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();
  ctx.lineWidth = 1.3; ctx.strokeStyle = OUTLINE; ctx.stroke();

  // Vest / plate carrier
  if (o.vest) {
    filledEllipse(ctx, cx - 0.5 * s, cy, 5 * s, 7.5 * s, o.vest, true);
    // shoulder straps
    ctx.strokeStyle = shade(o.vest === '#fff' ? '#cccccc' : o.vest, -0.4);
    ctx.lineWidth = 1.4 * s;
    ctx.beginPath();
    ctx.moveTo(cx - 3 * s, cy - 6 * s); ctx.lineTo(cx + 1 * s, cy - 2 * s);
    ctx.moveTo(cx - 3 * s, cy + 6 * s); ctx.lineTo(cx + 1 * s, cy + 2 * s);
    ctx.stroke();
  }

  // Arms reaching to the weapon
  ctx.strokeStyle = shade(body, -0.05);
  ctx.lineWidth = 3.4 * s;
  ctx.beginPath();
  ctx.moveTo(cx + 1 * s, cy - 6 * s); ctx.lineTo(cx + 9 * s, cy - 1.8 * s);
  ctx.moveTo(cx + 1 * s, cy + 6 * s); ctx.lineTo(cx + 9 * s, cy + 1.8 * s);
  ctx.stroke();
  // Gloves
  ctx.fillStyle = '#23281b';
  ctx.beginPath(); ctx.arc(cx + 9.5 * s, cy - 1.8 * s, 1.8 * s, 0, Math.PI * 2);
  ctx.arc(cx + 9.5 * s, cy + 1.8 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill();

  // Head + neck
  ctx.fillStyle = shade(o.head ?? '#d79a63', -0.25);
  rr(ctx, cx + 1.5 * s, cy - 1.6 * s, 3 * s, 3.2 * s, 1 * s); ctx.fill();
  const headR = 4.7 * s;
  const hg = ctx.createRadialGradient(cx + 2.5 * s, cy - 1 * s, 1, cx + 3 * s, cy, headR * 1.2);
  hg.addColorStop(0, shade(o.head ?? '#d79a63', 0.2));
  hg.addColorStop(1, shade(o.head ?? '#d79a63', -0.18));
  ctx.beginPath(); ctx.arc(cx + 3 * s, cy, headR, 0, Math.PI * 2);
  ctx.fillStyle = hg; ctx.fill();
  ctx.lineWidth = 1.1; ctx.strokeStyle = OUTLINE; ctx.stroke();

  drawHeadgear(ctx, cx, cy, s, headR, o);
  drawInsignia(ctx, cx, cy, s, o);

  return c;
}

function drawGun(ctx, cx, cy, s, o) {
  const len = (o.gunLen ?? 14) * s, w = (o.gunW ?? 4) * s;
  // body
  ctx.fillStyle = '#15150f';
  rr(ctx, cx + 2 * s, cy - w / 2, len, w, 1.5 * s); ctx.fill();
  // barrel highlight
  ctx.fillStyle = '#33332a';
  rr(ctx, cx + 2 * s, cy - w / 2, len, w * 0.35, 1 * s); ctx.fill();
  // muzzle
  ctx.fillStyle = '#0c0c08';
  rr(ctx, cx + 2 * s + len, cy - w * 0.35, 2 * s, w * 0.7, 0.6 * s); ctx.fill();
  // box magazine
  if (o.gunMag) {
    ctx.fillStyle = '#101009';
    rr(ctx, cx + 6 * s, cy + w / 2 - 0.5 * s, 3 * s, 5.5 * s, 1); ctx.fill();
  }
  // optic / sight
  ctx.fillStyle = '#2a2a20';
  rr(ctx, cx + 5 * s, cy - w / 2 - 1.6 * s, 2.2 * s, 1.8 * s, 0.5 * s); ctx.fill();
}

function drawHeadgear(ctx, cx, cy, s, headR, o) {
  if (o.headband) {
    ctx.strokeStyle = o.headband; ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.arc(cx + 3 * s, cy, headR, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 0.5 * s, cy - 2 * s); ctx.lineTo(cx - 5 * s, cy - 4 * s);
    ctx.moveTo(cx - 0.5 * s, cy + 2 * s); ctx.lineTo(cx - 5 * s, cy + 4 * s);
    ctx.stroke();
  }
  if (o.helmet) {
    const g = ctx.createRadialGradient(cx + 2 * s, cy - 1 * s, 1, cx + 2.6 * s, cy, headR * 1.3);
    g.addColorStop(0, shade(o.helmet, 0.25)); g.addColorStop(1, shade(o.helmet, -0.15));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx + 2.4 * s, cy, headR * 1.06, -Math.PI * 0.78, Math.PI * 0.78); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = OUTLINE; ctx.stroke();
  }
  if (o.beret) {
    ctx.fillStyle = o.beret;
    ctx.beginPath(); ctx.ellipse(cx + 2.2 * s, cy - 0.5 * s, headR * 1.1, headR * 0.95, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = OUTLINE; ctx.stroke();
  }
  if (o.cap) {
    ctx.fillStyle = shade(o.cap, 0.1);
    ctx.beginPath(); ctx.arc(cx + 2.4 * s, cy, headR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#15150f';
    rr(ctx, cx + 6 * s, cy - 3 * s, 2.6 * s, 6 * s, 1); ctx.fill(); // brim
    ctx.lineWidth = 1; ctx.strokeStyle = OUTLINE; ctx.stroke();
  }
  if (o.ghillie) {
    // ragged camo tufts around the head/shoulders
    ctx.fillStyle = o.ghillie;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const r = headR * (1.2 + (i % 2) * 0.5);
      ctx.beginPath();
      ctx.arc(cx + 1 * s + Math.cos(a) * r, cy + Math.sin(a) * r, 1.4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawInsignia(ctx, cx, cy, s, o) {
  if (o.cross) {
    ctx.fillStyle = '#fff';
    rr(ctx, cx - 5.5 * s, cy - 3 * s, 6 * s, 6 * s, 1); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = OUTLINE; ctx.stroke();
    ctx.fillStyle = '#d23b3b';
    ctx.fillRect(cx - 3.9 * s, cy - 2.6 * s, 2.8 * s, 5.2 * s);
    ctx.fillRect(cx - 5.3 * s, cy - 1.2 * s, 5.6 * s, 2.4 * s);
  }
  if (o.chevrons) {
    ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 1.4 * s;
    for (let i = 0; i < o.chevrons; i++) {
      const off = (-2 + i * 2) * s;
      ctx.beginPath();
      ctx.moveTo(cx - 5 * s, cy - 3 * s + off);
      ctx.lineTo(cx - 3 * s, cy + off);
      ctx.lineTo(cx - 5 * s, cy + 3 * s + off);
      ctx.stroke();
    }
  }
  if (o.bars) {
    ctx.fillStyle = '#f1c40f';
    for (let i = 0; i < o.bars; i++) ctx.fillRect(cx - 5.5 * s, cy - 3 * s + i * 3 * s, 5 * s, 1.6 * s);
  }
  if (o.ammoBelt) {
    ctx.fillStyle = '#caa53a';
    for (let i = 0; i < 5; i++) ctx.fillRect(cx - 6 * s + i * 2.4 * s, cy + 7.5 * s, 1.4 * s, 3 * s);
  }
}

// ---- Enemy faction (crimson, jagged, glowing) ----
function drawEnemy(size, o) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2;
  const r = size * 0.32 * (o.scale ?? 1);
  const spikes = o.spikes ?? 7;

  // Claws / weapon hint behind body
  if (o.weapon) {
    ctx.fillStyle = '#141014';
    rr(ctx, cx + r * 0.5, cy - 2.4, r * 0.9, 4.8, 2); ctx.fill();
  }

  // Spiky shell with radial shading
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r * 1.2);
  g.addColorStop(0, shade(o.body, 0.18));
  g.addColorStop(1, shade(o.body, -0.2));
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.72;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(10,4,4,0.6)'; ctx.stroke();

  // Inner carapace
  filledEllipse(ctx, cx, cy, r * 0.58, r * 0.58, o.inner ?? '#5a1c1c', false);

  // Glowing eyes (front, +x) with bloom
  const ey = r * 0.3, ex = cx + r * 0.42;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const eg = ctx.createRadialGradient(ex, cy, 0, ex, cy, r * 0.5);
  eg.addColorStop(0, o.eye ?? '#ffd23b'); eg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.arc(ex, cy - ey, r * 0.32, 0, Math.PI * 2);
  ctx.arc(ex, cy + ey, r * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = o.eye ?? '#ffd23b';
  ctx.beginPath(); ctx.arc(ex, cy - ey, r * 0.14, 0, Math.PI * 2);
  ctx.arc(ex, cy + ey, r * 0.14, 0, Math.PI * 2); ctx.fill();

  return c;
}

function drawGem(size) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#bdeeff'); g.addColorStop(0.5, '#2aa9d6'); g.addColorStop(1, '#0f6f96');
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.45, cy - r * 0.1);
  ctx.lineTo(cx, cy); ctx.lineTo(cx - r * 0.45, cy - r * 0.1); ctx.closePath();
  ctx.fill();
  return c;
}

function drawHealth(size) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2, r = size * 0.4;
  // white case
  rr(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.35);
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#dfe7e0');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(20,30,20,0.5)'; ctx.stroke();
  // red cross
  ctx.fillStyle = '#e23b3b';
  ctx.fillRect(cx - r * 0.22, cy - r * 0.7, r * 0.44, r * 1.4);
  ctx.fillRect(cx - r * 0.7, cy - r * 0.22, r * 1.4, r * 0.44);
  return c;
}

function drawMuzzle(size) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  g.addColorStop(0, 'rgba(255,255,210,1)');
  g.addColorStop(0.4, 'rgba(255,200,60,0.9)');
  g.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rad = i % 2 === 0 ? size / 2 : size / 4;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.fill();
  return c;
}

function drawExplosion(size) {
  const { c, ctx } = makeCanvas(size);
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  g.addColorStop(0, 'rgba(255,255,210,0.95)');
  g.addColorStop(0.35, 'rgba(255,150,40,0.85)');
  g.addColorStop(0.7, 'rgba(200,50,20,0.5)');
  g.addColorStop(1, 'rgba(120,20,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.fill();
  return c;
}

function drawShell(size) {
  const { c, ctx } = makeCanvas(size);
  const g = ctx.createLinearGradient(0, size * 0.35, 0, size * 0.65);
  g.addColorStop(0, '#e6c558'); g.addColorStop(1, '#a07f24');
  ctx.fillStyle = g;
  ctx.fillRect(size * 0.2, size * 0.35, size * 0.6, size * 0.3);
  return c;
}

// ---------- Build the placeholder atlas ----------
function buildPlaceholders() {
  // Playable characters — visually distinct commandos
  SPRITES.set('char_commando', drawSoldier(54, {
    body: '#5a6a36', vest: '#33401f', head: '#d79a63',
    headband: '#c0392b', gunLen: 17, gunW: 5, gunMag: true,
    depth: 9, shoulder: 12, ammoBelt: true,
  }));
  SPRITES.set('char_heavy', drawSoldier(58, {
    body: '#4a5530', vest: '#2c3419', head: '#caa074', helmet: '#2c3419',
    gunLen: 20, gunW: 7, gunMag: true, ammoBelt: true, depth: 11, shoulder: 14,
  }));
  SPRITES.set('char_demo', drawSoldier(54, {
    body: '#6a5a30', vest: '#3a2f18', head: '#d79a63', headband: '#222',
    gunLen: 18, gunW: 6, gunMag: true, depth: 9, shoulder: 12, ammoBelt: true,
  }));
  SPRITES.set('char_medic', drawSoldier(52, {
    body: '#3a5a4a', vest: '#fff', head: '#d79a63', cap: '#2e4a3c',
    gunLen: 14, gunMag: true, cross: true, depth: 8, shoulder: 11,
  }));
  SPRITES.set('player', SPRITES.get('char_commando')); // fallback alias

  // Teammates by rank/role
  SPRITES.set('team_infantry', drawSoldier(40, {
    body: '#5b6b3a', vest: '#3c4626', helmet: '#37411f', gunLen: 13, gunMag: true,
  }));
  SPRITES.set('team_gunner', drawSoldier(46, {
    body: '#4f5a30', vest: '#2f381c', helmet: '#2f381c',
    gunLen: 18, gunW: 6, gunMag: true, ammoBelt: true, depth: 9, shoulder: 12,
  }));
  SPRITES.set('team_sniper', drawSoldier(44, {
    body: '#6a7048', vest: '#54603a', head: '#cdae84', ghillie: '#5a6a3a',
    gunLen: 22, gunW: 3, depth: 7, shoulder: 9,
  }));
  SPRITES.set('team_grenadier', drawSoldier(44, {
    body: '#5b6b3a', vest: '#3c4626', helmet: '#37411f',
    gunLen: 12, gunW: 7, depth: 9, shoulder: 11,
  }));
  SPRITES.set('team_medic', drawSoldier(40, {
    body: '#6b7a4a', vest: '#fff', head: '#d79a63', helmet: '#5a6a36',
    gunLen: 10, cross: true,
  }));
  SPRITES.set('team_sergeant', drawSoldier(42, {
    body: '#4a5a32', vest: '#33401f', head: '#d79a63', beret: '#5a1f1f',
    gunLen: 13, gunMag: true, chevrons: 3,
  }));
  SPRITES.set('team_lieutenant', drawSoldier(44, {
    body: '#3f4a2a', vest: '#2a331a', head: '#d79a63', cap: '#2a331a',
    gunLen: 13, bars: 2,
  }));

  // Enemies — hostile crimson faction
  SPRITES.set('enemy_chaser',  drawEnemy(38, { body: '#8e2b2b', inner: '#5a1c1c', eye: '#ffce3b' }));
  SPRITES.set('enemy_swarmer', drawEnemy(28, { body: '#c0392b', inner: '#7a1f1f', eye: '#fff', spikes: 5, scale: 1.1 }));
  SPRITES.set('enemy_tank',    drawEnemy(62, { body: '#5e2424', inner: '#3a1414', eye: '#ff5a2b', spikes: 9 }));
  SPRITES.set('enemy_ranged',  drawEnemy(38, { body: '#9b3a6a', inner: '#5a1c3a', eye: '#6fffdf', weapon: true, spikes: 6 }));
  SPRITES.set('enemy_elite',   drawEnemy(54, { body: '#7a1f5a', inner: '#4a103a', eye: '#ffd23b', spikes: 10 }));
  SPRITES.set('enemy_boss',    drawEnemy(128, { body: '#3a0d0d', inner: '#7a1010', eye: '#ff3b2b', spikes: 12 }));

  // FX + pickups
  SPRITES.set('xp_gem', drawGem(18));
  SPRITES.set('health', drawHealth(22));
  SPRITES.set('muzzle', drawMuzzle(26));
  SPRITES.set('explosion', drawExplosion(96));
  SPRITES.set('shell', drawShell(8));
}

// Names we will try to load real PNGs for (drop-in replacements in /assets).
export const ASSET_MANIFEST = [
  'char_commando', 'char_heavy', 'char_demo', 'char_medic', 'player',
  'team_infantry', 'team_gunner', 'team_sniper', 'team_grenadier',
  'team_medic', 'team_sergeant', 'team_lieutenant',
  'enemy_chaser', 'enemy_swarmer', 'enemy_tank', 'enemy_ranged',
  'enemy_elite', 'enemy_boss',
  'enemy_bomber', 'enemy_spitter', 'enemy_summoner',
  'boss_maw', 'boss_charger', 'boss_hive',
  'xp_gem', 'health', 'muzzle', 'explosion', 'shell',
  'ground', 'ground_depot', 'ground_field', 'ground_desert', 'ground_marsh',
];

function tryLoad(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { img.logicalSize = img.width; SPRITES.set(name, img); resolve(true); };
    img.onerror = () => resolve(false);
    // /assets is configured as Vite's publicDir, so its files are served at the
    // site root: assets/player.png -> ./player.png
    img.src = `./${name}.png`;
  });
}

// Generate placeholders synchronously, then (optionally) override with any real
// assets present. Resolves once override attempts settle so we never block boot.
export async function initSprites() {
  buildPlaceholders();
  await Promise.all(ASSET_MANIFEST.map(tryLoad));
}

export function getSprite(name) {
  return SPRITES.get(name);
}

// Logical (unscaled) size of a sprite, accounting for supersampling.
export function spriteSize(spr) {
  return spr.logicalSize || spr.width;
}
