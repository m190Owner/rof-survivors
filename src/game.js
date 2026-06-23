// Game orchestrator: owns every system, the fixed-ish delta loop, object pools,
// collision, camera + screen shake, FX, and the run state machine.

import { WORLD, DIFFICULTY, COLORS } from './config.js';
import { rand, TAU, chance } from './rng.js';
import { Pool } from './pool.js';
import { SpatialGrid } from './grid.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Team } from './teammates.js';
import { Spawner } from './spawner.js';
import { makeEnemy, resetEnemy, updateEnemy, ENEMY_DEFS } from './enemies.js';
import { generateCards } from './upgrades.js';
import { getSprite, spriteSize } from './sprites.js';
import { CHARACTER_DEFS, CHARACTER_ORDER } from './characters.js';
import { audio } from './audio.js';

const STATE = { START: 'start', RUNNING: 'running', LEVELUP: 'levelup', OVER: 'over' };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;

    this.input = new Input(document.getElementById('game-root'));
    this.ui = new UI();
    this.audio = audio;

    this.grid = new SpatialGrid(96);
    this.scratch = [];

    // Pools
    this.enemies = new Pool(makeEnemy, (e, type, x, y) => resetEnemy(e, type, x, y, this.statScaleNow));
    this.allyBullets = new Pool(() => ({}), (b, s) => Object.assign(b, s, { life: 1.6, hits: null }));
    this.enemyBullets = new Pool(() => ({}), (b, s) => Object.assign(b, s, { life: 3 }));
    this.gems = new Pool(() => ({}), (g, x, y, value) => Object.assign(g, { x, y, value, vx: 0, vy: 0, magnet: false }));
    this.pickups = new Pool(() => ({}), (p, x, y, heal) => Object.assign(p, { x, y, heal, magnet: false }));
    this.fx = new Pool(() => ({}), (f, s) => Object.assign(f, s));

    this.selectedCharacter = CHARACTER_ORDER[0];
    this.state = STATE.START;
    this.elapsed = 0;
    this.statScaleNow = 1;
    this.totalRecruited = 0;
    this.pendingLevelUps = 0;
    this.banner = { text: '', life: 0 };
    this.shake = { t: 0, mag: 0 };

    this.bindResize();
    this.bindButtons();
  }

  bindResize() {
    const resize = () => {
      this.w = window.innerWidth;
      this.h = window.innerHeight;
      this.canvas.width = this.w * this.dpr;
      this.canvas.height = this.h * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.spawnRadius = Math.hypot(this.w, this.h) / 2 + 80;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  bindButtons() {
    // Build the character-select screen; picking a card deploys that character.
    this.ui.buildCharacterSelect(CHARACTER_DEFS, CHARACTER_ORDER, (id) => this.start(id));
    // Restart returns to character select so a new character can be chosen.
    this.ui.el.restart.addEventListener('click', () => {
      this.ui.hideGameOver();
      this.state = STATE.START;
      this.ui.showStart();
    });
    // Ability activation via the on-screen button (mirrors Space / Q).
    this.ui.el.abilityBtn.addEventListener('click', () => { this.input.abilityRequested = true; });
    // Mute toggle.
    this.ui.el.muteBtn.addEventListener('click', () => {
      const muted = this.audio.toggleMute();
      this.ui.el.muteBtn.textContent = muted ? '🔇' : '🔊';
    });
  }

  // ---------------- lifecycle ----------------
  start(charId) {
    this.audio.init(); // user gesture — unlock audio + start music
    if (charId) this.selectedCharacter = charId;
    const charDef = CHARACTER_DEFS[this.selectedCharacter];
    this.player = new Player(charDef, 0, 0);
    this.team = new Team();
    this.spawner = new Spawner();
    this.spawner.reset();
    this.enemies.clear();
    this.allyBullets.clear();
    this.enemyBullets.clear();
    this.gems.clear();
    this.pickups.clear();
    this.fx.clear();
    this.team.clear();

    this.elapsed = 0;
    this.statScaleNow = 1;
    this.totalRecruited = 0;
    this.pendingLevelUps = 0;
    this.banner = { text: 'SURVIVE', life: 2 };
    this.camera = { x: -this.w / 2, y: -this.h / 2 };

    this.ui.hideStart();
    this.ui.hideGameOver();
    this.ui.hideLevelUp();
    this.ui.showAbility(this.player);
    this.state = STATE.RUNNING;
  }

  recruit(id, level) {
    this.team.recruit(id, level, this.player);
    this.totalRecruited++;
  }

  announce(text) { this.banner = { text, life: 2.5 }; }

  // ---------------- spawning helpers ----------------
  spawnEnemy(type, x, y) { this.enemies.spawn(type, x, y); }

  spawnGem(x, y, value) { this.gems.spawn(x, y, value); }

  spawnHealth(x, y, heal) { this.pickups.spawn(x, y, heal); }

  spawnAllyBullet(spec) {
    const vx = Math.cos(spec.angle) * spec.speed;
    const vy = Math.sin(spec.angle) * spec.speed;
    this.allyBullets.spawn({
      x: spec.x, y: spec.y, vx, vy,
      damage: spec.damage, color: spec.color, len: spec.len || 10,
      pierce: spec.pierce || 0, blastRadius: spec.blastRadius || 0,
    });
  }

  spawnEnemyBullet(x, y, angle, speed, damage, color) {
    this.enemyBullets.spawn({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage, color,
    });
  }

  muzzleFlash(x, y, angle) {
    this.fx.spawn({ type: 'muzzle', x, y, angle, life: 0.06, maxLife: 0.06 });
  }

  ejectShell(x, y, angle) {
    const side = angle + Math.PI / 2 + rand(-0.3, 0.3);
    const sp = rand(60, 120);
    this.fx.spawn({
      type: 'shell', x, y, vx: Math.cos(side) * sp, vy: Math.sin(side) * sp,
      rot: rand(0, TAU), vrot: rand(-12, 12), life: 0.6, maxLife: 0.6,
    });
  }

  // A small burst of bright sparks where a bullet bites, thrown back along the
  // impact direction (angle = travel direction of the projectile).
  hitSpark(x, y, angle) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = angle + Math.PI + rand(-0.7, 0.7);
      const sp = rand(120, 300);
      this.fx.spawn({
        type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        len: rand(4, 9), color: '#ffe9a8', life: 0.18, maxLife: 0.18,
      });
    }
  }

  // Debris puff when an enemy dies — colored to the faction, sized to the unit.
  deathBurst(x, y, radius, color) {
    const n = Math.min(18, 6 + Math.round(radius));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 60) + radius * 4;
      this.fx.spawn({
        type: 'burst', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: rand(1.5, 3.2) + radius * 0.06, color, life: 0.35, maxLife: 0.35,
      });
    }
  }

  addDamageNumber(x, y, value, color, big = false) {
    this.fx.spawn({
      type: 'dmg', x: x + rand(-6, 6), y, value: Math.round(value), color,
      vy: -42, life: 0.7, maxLife: 0.7, big,
    });
  }

  doExplosion(x, y, radius, damage, fromAlly) {
    this.fx.spawn({ type: 'explosion', x, y, radius, life: 0.4, maxLife: 0.4 });
    this.shakeCamera(6);
    this.audio.explosion();
    if (fromAlly) {
      this.grid.queryRadius(x, y, radius, (e) => {
        if (!e.alive) return;
        const d = Math.hypot(e.x - x, e.y - y);
        if (d <= radius + e.radius) this.damageEnemy(e, damage);
      });
    }
  }

  healAround(x, y, radius, amount) {
    if (Math.hypot(this.player.x - x, this.player.y - y) <= radius) this.player.heal(amount);
    for (const m of this.team.members) {
      if (m.alive && Math.hypot(m.x - x, m.y - y) <= radius) m.hp = Math.min(m.maxHp, m.hp + amount);
    }
  }

  shakeCamera(mag) { this.shake.t = 0.18; this.shake.mag = Math.max(this.shake.mag, mag); }

  findNearestEnemy(x, y, range) {
    let best = null, bestD = range * range;
    this.grid.queryRadius(x, y, range, (e) => {
      if (!e.alive) return;
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  // ---------------- damage ----------------
  damageEnemy(e, amount, angle = null) {
    e.hp -= amount;
    e.flash = 90;
    this.hitSpark(e.x, e.y, angle ?? rand(0, TAU));
    this.addDamageNumber(e.x, e.y - e.radius, amount, '#ffe9a8', e.def.boss || e.def.elite);
    this.audio.hit();
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    e.alive = false;
    this.player.kills++;
    this.audio.enemyDeath();
    this.deathBurst(e.x, e.y, e.radius, e.def.color || '#c0392b');
    // XP drops scale with the enemy's worth.
    const drops = e.def.boss ? 12 : e.def.elite ? 5 : 1;
    for (let i = 0; i < drops; i++) {
      const a = rand(0, TAU), r = rand(0, e.radius);
      this.spawnGem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, Math.ceil(e.xp / drops));
    }
    if (e.def.boss || e.def.elite) { this.fx.spawn({ type: 'explosion', x: e.x, y: e.y, radius: e.radius * 1.6, life: 0.5, maxLife: 0.5 }); this.shakeCamera(10); }

    // Small chance to drop a health pack (much higher for elites/bosses).
    const dropChance = e.def.boss ? 1 : e.def.elite ? 0.45 : 0.05;
    if (chance(dropChance)) {
      const heal = e.def.boss ? 60 : e.def.elite ? 30 : 18;
      this.spawnHealth(e.x, e.y, heal);
    }
  }

  // ---------------- main loop ----------------
  run() {
    let last = performance.now();
    const frame = (now) => {
      let dtMs = now - last;
      last = now;
      if (dtMs > 50) dtMs = 50; // clamp after tab-out / hitches
      if (this.state === STATE.RUNNING) this.update(dtMs);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dtMs) {
    const dt = dtMs / 1000;
    this.elapsed += dt;
    this.statScaleNow = DIFFICULTY.statScale(this.elapsed);
    if (this.banner.life > 0) this.banner.life -= dt;
    if (this.shake.t > 0) { this.shake.t -= dt; if (this.shake.t <= 0) this.shake.mag = 0; }

    const p = this.player;
    if (p.invuln > 0) p.invuln -= dtMs;
    if (p.hpRegen > 0) p.heal(p.hpRegen * dt);

    // --- ability (cooldown + activation) ---
    p.updateAbility(dtMs);
    if (this.input.abilityRequested) {
      this.input.abilityRequested = false;
      if (p.tryActivateAbility(this)) this.audio.ability();
    }

    // --- player movement ---
    this.input.update();
    if (this.input.mx || this.input.my) {
      p.x += this.input.mx * p.speed * dt;
      p.y += this.input.my * p.speed * dt;
      p.moveAngle = Math.atan2(this.input.my, this.input.mx);
    }

    // Rebuild enemy grid for this frame's queries.
    this.grid.rebuild(this.enemies.active);

    // --- player aim + auto-fire ---
    const aimTarget = this.findNearestEnemy(p.x, p.y, 900);
    if (aimTarget) p.angle = Math.atan2(aimTarget.y - p.y, aimTarget.x - p.x);
    else p.angle = p.moveAngle;

    for (const w of p.weapons) {
      const shots = w.update(dtMs, p, p.angle);
      if (w.startedReload) { w.startedReload = false; this.audio.reload(); }
      if (shots) {
        const gx = p.x + Math.cos(p.angle) * (p.radius + 14);
        const gy = p.y + Math.sin(p.angle) * (p.radius + 14);
        this.muzzleFlash(gx, gy, p.angle);
        this.ejectShell(gx, gy, p.angle);
        this.audio.shot(w.def.sound);
        for (const s of shots) this.spawnAllyBullet({ x: gx, y: gy, ...s });
      }
    }

    // --- teammates ---
    this.team.update(dtMs, this);

    // --- enemies: choose target (nearest friendly), move, contact damage ---
    const friendlies = [p, ...this.team.members];
    for (const e of this.enemies.active) {
      if (!e.alive) continue;
      let target = p, bd = Infinity;
      for (const f of friendlies) {
        if (f.hp !== undefined && f.hp <= 0) continue;
        const d = (f.x - e.x) ** 2 + (f.y - e.y) ** 2;
        if (d < bd) { bd = d; target = f; }
      }
      updateEnemy(e, dtMs, target, this);

      // contact damage
      const rr = (e.radius + target.radius);
      if (bd <= rr * rr && e.hitCd <= 0) {
        e.hitCd = 500;
        if (target === p) {
          if (p.takeDamage(e.damage)) { this.shakeCamera(5); this.audio.playerHurt(); }
        } else {
          target.takeDamage(e.damage);
        }
      }
    }
    this.separateEnemies();

    // --- ally bullets ---
    for (const b of this.allyBullets.active) {
      if (!b.alive) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      let consumed = false;
      this.scratch.length = 0;
      this.grid.queryRadius(b.x, b.y, 28, (e) => { if (e.alive) this.scratch.push(e); });
      for (const e of this.scratch) {
        const hitR = e.radius + 4;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 <= hitR * hitR) {
          if (b.hits && b.hits.includes(e)) continue;
          this.damageEnemy(e, b.damage, Math.atan2(b.vy, b.vx));
          if (b.blastRadius) this.doExplosion(b.x, b.y, b.blastRadius, b.damage, true);
          if (b.pierce > 0) {
            b.pierce--;
            (b.hits || (b.hits = [])).push(e);
          } else { consumed = true; break; }
        }
      }
      if (consumed) b.alive = false;
    }

    // --- enemy bullets ---
    for (const b of this.enemyBullets.active) {
      if (!b.alive) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      // vs player
      if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 <= (p.radius + 4) ** 2) {
        if (p.takeDamage(b.damage)) { this.shakeCamera(4); this.audio.playerHurt(); }
        b.alive = false; continue;
      }
      // vs teammates
      for (const m of this.team.members) {
        if (m.alive && (m.x - b.x) ** 2 + (m.y - b.y) ** 2 <= (m.radius + 4) ** 2) {
          m.takeDamage(b.damage); b.alive = false; break;
        }
      }
    }

    // --- XP gems: auto-collected. Every gem homes to the player from anywhere
    // (the player never has to walk over them), accelerating as it approaches.
    const pr = p.pickupRange;
    let levelsGained = 0;
    let collectedXp = false;
    for (const g of this.gems.active) {
      if (!g.alive) continue;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d = Math.hypot(dx, dy);
      const sp = 520 + Math.max(0, 600 - d) * 0.9; // faster when close
      g.x += dx / (d || 1) * sp * dt;
      g.y += dy / (d || 1) * sp * dt;
      if (d < p.radius + 8) {
        g.alive = false;
        levelsGained += p.gainXp(g.value);
        collectedXp = true;
      }
    }
    if (collectedXp) this.audio.pickupXp();
    if (levelsGained > 0) this.triggerLevelUp(levelsGained);

    // --- health packs: magnet + pickup ---
    for (const hpk of this.pickups.active) {
      if (!hpk.alive) continue;
      const dx = p.x - hpk.x, dy = p.y - hpk.y;
      const d = Math.hypot(dx, dy);
      if (hpk.magnet || d < pr) {
        hpk.magnet = true;
        hpk.x += dx / (d || 1) * 460 * dt;
        hpk.y += dy / (d || 1) * 460 * dt;
      }
      if (d < p.radius + 8) {
        hpk.alive = false;
        const before = p.hp;
        p.heal(hpk.heal);
        const healed = Math.round(p.hp - before);
        if (healed > 0) this.addDamageNumber(p.x, p.y - 28, healed, '#7fff8a');
        this.audio.pickupHealth();
      }
    }

    // --- FX update ---
    for (const f of this.fx.active) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) { f.alive = false; continue; }
      if (f.type === 'shell') {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= 0.9; f.vy *= 0.9; f.rot += f.vrot * dt;
      } else if (f.type === 'dmg') {
        f.y += f.vy * dt; f.vy *= 0.92;
      } else if (f.type === 'spark' || f.type === 'burst') {
        f.x += f.vx * dt; f.y += f.vy * dt;
        f.vx *= 0.82; f.vy *= 0.82;
      }
    }

    // --- spawner ---
    this.spawner.update(dtMs, this);

    // --- sweeps ---
    this.enemies.sweep();
    this.allyBullets.sweep();
    this.enemyBullets.sweep();
    this.gems.sweep();
    this.pickups.sweep();
    this.fx.sweep();

    // --- camera follow ---
    this.camera.x = p.x - this.w / 2;
    this.camera.y = p.y - this.h / 2;

    // --- death ---
    if (p.hp <= 0) this.gameOver();
  }

  // Light separation so enemies don't fully stack on one pixel.
  separateEnemies() {
    const a = this.enemies.active;
    for (const e of a) {
      if (!e.alive) continue;
      this.scratch.length = 0;
      this.grid.queryRadius(e.x, e.y, e.radius * 2, (o) => { if (o !== e && o.alive) this.scratch.push(o); });
      for (const o of this.scratch) {
        const dx = e.x - o.x, dy = e.y - o.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = e.radius + o.radius;
        if (d < min) {
          const push = (min - d) * 0.25;
          e.x += dx / d * push; e.y += dy / d * push;
        }
      }
    }
  }

  triggerLevelUp(levels) {
    this.pendingLevelUps += levels;
    if (this.state === STATE.RUNNING) this.showNextCard();
  }

  showNextCard() {
    if (this.pendingLevelUps <= 0) { this.state = STATE.RUNNING; return; }
    this.state = STATE.LEVELUP;
    this.audio.levelUp();
    const cards = generateCards(this);
    this.ui.showLevelUp(cards, (card) => {
      this.audio.uiClick();
      card.apply();
      this.pendingLevelUps--;
      this.ui.hideLevelUp();
      if (this.pendingLevelUps > 0) this.showNextCard();
      else this.state = STATE.RUNNING;
    });
  }

  gameOver() {
    this.state = STATE.OVER;
    this.audio.gameOver();
    this.ui.hideAbility();
    this.ui.hideLevelUp();
    this.ui.showGameOver(this);
  }

  // ---------------- rendering ----------------
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    if (this.state === STATE.START) { this.drawBackground(0, 0); return; }

    let sx = 0, sy = 0;
    if (this.shake.mag > 0) {
      sx = rand(-this.shake.mag, this.shake.mag);
      sy = rand(-this.shake.mag, this.shake.mag);
    }
    const camX = this.camera.x + sx, camY = this.camera.y + sy;

    this.drawBackground(camX, camY);

    ctx.save();
    ctx.translate(-camX, -camY);

    // gems
    const gem = getSprite('xp_gem');
    for (const g of this.gems.active) {
      if (!g.alive) continue;
      this.drawCentered(gem, g.x, g.y);
    }
    // health packs (gentle bob)
    const hp = getSprite('health');
    for (const k of this.pickups.active) {
      if (!k.alive) continue;
      this.drawCentered(hp, k.x, k.y);
    }

    // shadows + enemies
    for (const e of this.enemies.active) {
      if (!e.alive) continue;
      this.drawShadow(e.x, e.y, e.radius);
      this.drawUnit(getSprite(e.def.sprite), e.x, e.y, e.angle, 1, e.flash > 0, true);
      if (e.def.boss) this.drawHpBar(e.x, e.y - e.radius - 14, e.radius * 2, e.hp / e.maxHp, '#ff5a4a');
    }

    // teammates
    for (const m of this.team.members) {
      if (!m.alive) continue;
      this.drawShadow(m.x, m.y, m.radius);
      this.drawUnit(getSprite(m.def.sprite), m.x, m.y, m.angle, 1, m.flash > 0);
      this.drawHpBar(m.x, m.y - m.radius - 10, 30, m.hp / m.maxHp, '#7fd06b');
    }

    // player
    this.drawShadow(this.player.x, this.player.y, this.player.radius);
    // Aura while an ability buff is active (e.g. Adrenaline Rush).
    if (this.player.buffLeft > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.elapsed * 20);
      ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.player.x, this.player.y, this.player.radius + 8, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    const pflash = this.player.invuln > 250;
    this.drawUnit(getSprite(this.player.sprite), this.player.x, this.player.y, this.player.angle, 1, pflash);

    // ally bullets
    for (const b of this.allyBullets.active) {
      if (!b.alive) continue;
      this.drawBullet(b);
    }
    // enemy bullets
    for (const b of this.enemyBullets.active) {
      if (!b.alive) continue;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, TAU); ctx.fill();
    }

    // fx
    this.drawFx();

    ctx.restore();

    // screen-space vignette over the world (under HUD/banner)
    this.drawVignette();

    // banner (screen space)
    if (this.banner.life > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.banner.life);
      ctx.font = '800 38px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23b';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.strokeText(this.banner.text, this.w / 2, 120);
      ctx.fillText(this.banner.text, this.w / 2, 120);
      ctx.restore();
    }

    // keep HUD in sync
    if (this.state !== STATE.OVER) { this.ui.updateHud(this); this.ui.updateAbility(this.player); }
  }

  // Draw a sprite centered at world (x,y) at its logical size (no rotation).
  drawCentered(spr, x, y) {
    if (!spr) return;
    const sz = spriteSize(spr);
    this.ctx.drawImage(spr, x - sz / 2, y - sz / 2, sz, sz);
  }

  drawBackground(camX, camY) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.bgA;
    ctx.fillRect(0, 0, this.w, this.h);

    const t = WORLD.bgTile;
    const ox = -((camX % t) + t) % t;
    const oy = -((camY % t) + t) % t;

    // Tiled ground texture (authored). Falls back to a faint grid if absent.
    const ground = getSprite('ground');
    if (ground) {
      for (let y = oy; y < this.h; y += t) {
        for (let x = ox; x < this.w; x += t) {
          ctx.drawImage(ground, x, y, t, t);
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x < this.w; x += t) { ctx.moveTo(x, 0); ctx.lineTo(x, this.h); }
      for (let y = oy; y < this.h; y += t) { ctx.moveTo(0, y); ctx.lineTo(this.w, y); }
      ctx.stroke();
    }
  }

  // Screen-space vignette: darkens the edges to focus attention on the action.
  drawVignette() {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42,
                                       w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawShadow(x, y, r) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.5, r * 0.9, r * 0.5, 0, 0, TAU);
    ctx.fill();
  }

  // billboard=true keeps the sprite upright (front-view enemies face the
  // camera and never rotate, per genre convention); soldiers rotate to aim.
  drawUnit(sprite, x, y, angle, scale, flash, billboard = false) {
    if (!sprite) return;
    const ctx = this.ctx;
    const sz = spriteSize(sprite) * scale;
    ctx.save();
    ctx.translate(x, y);
    if (!billboard) ctx.rotate(angle);
    ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
    if (flash) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, sz / 2 * 0.7, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawBullet(b) {
    const ctx = this.ctx;
    const a = Math.atan2(b.vy, b.vx);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(a);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-b.len / 2, 0); ctx.lineTo(b.len / 2, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawHpBar(x, y, w, frac, color) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, frac), 4);
  }

  drawFx() {
    const ctx = this.ctx;
    for (const f of this.fx.active) {
      if (!f.alive) continue;
      const k = f.life / f.maxLife;
      if (f.type === 'muzzle') {
        const spr = getSprite('muzzle');
        const sz = spriteSize(spr);
        ctx.save();
        ctx.translate(f.x, f.y); ctx.rotate(f.angle);
        ctx.globalAlpha = k;
        ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      } else if (f.type === 'explosion') {
        const spr = getSprite('explosion');
        const size = f.radius * 2 * (1.3 - k * 0.3);
        ctx.save();
        ctx.globalAlpha = k;
        ctx.drawImage(spr, f.x - size / 2, f.y - size / 2, size, size);
        ctx.restore();
      } else if (f.type === 'shell') {
        const spr = getSprite('shell');
        const sz = spriteSize(spr);
        ctx.save();
        ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        ctx.globalAlpha = k;
        ctx.drawImage(spr, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      } else if (f.type === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        const m = Math.hypot(f.vx, f.vy) || 1;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x - (f.vx / m) * f.len, f.y - (f.vy / m) * f.len);
        ctx.stroke();
        ctx.restore();
      } else if (f.type === 'burst') {
        ctx.save();
        ctx.globalAlpha = k;
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + k * 0.5), 0, TAU); ctx.fill();
        ctx.restore();
      } else if (f.type === 'dmg') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = f.color;
        ctx.font = `${f.big ? 800 : 700} ${f.big ? 20 : 14}px Segoe UI, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(f.value, f.x, f.y);
        ctx.restore();
      }
    }
  }
}
