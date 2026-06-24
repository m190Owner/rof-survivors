// Game orchestrator: owns every system, the fixed-ish delta loop, object pools,
// collision, camera + screen shake, FX, and the run state machine.

import { WORLD, DIFFICULTY, COLORS, STAGES } from './config.js';
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
import { loadSave, writeSave, coinsForRun, applyMetaBonuses, loadSettings, writeSettings, loadoutCost } from './save.js';
import { getSprite, spriteSize } from './sprites.js';
import { CHARACTER_DEFS, CHARACTER_ORDER } from './characters.js';
import { audio } from './audio.js';

const STATE = { START: 'start', RUNNING: 'running', LEVELUP: 'levelup', OVER: 'over', PAUSED: 'paused' };

// Readable names for the "Killed by ___" line on the game-over screen.
const KILL_LABELS = {
  chaser: 'a Chaser', swarmer: 'a Swarmer', tank: 'a Tank', ranged: 'a Shooter',
  elite: 'an Elite', bomber: 'a Bomber', spitter: 'a Spitter', summoner: 'a Summoner',
};

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
    this.save = loadSave();
    this.settings = loadSettings();
    this.coinsEarned = 0;
    this.state = STATE.START;
    this.elapsed = 0;
    this.statScaleNow = 1;
    this.totalRecruited = 0;
    this.pendingLevelUps = 0;
    this.stage = 0;
    this.loop = 0;
    this.stageElapsed = 0;
    this.bossActive = false;
    this.bossRef = null;
    this.strike = null;
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
    this.ui.buildCharacterSelect(CHARACTER_DEFS, CHARACTER_ORDER, (id) => this.start(id), this);
    this.ui.refreshStartMeta();
    // Armoury (shop) from the start screen.
    this.ui.el.shopBtn.addEventListener('click', () => this.ui.openShop(this));
    // Restart returns to character select so a new character can be chosen.
    this.ui.el.restart.addEventListener('click', () => {
      this.ui.hideGameOver();
      this.state = STATE.START;
      this.ui.showStart();
    });
    // Ability activation via the on-screen button (mirrors Space / Q).
    this.ui.el.abilityBtn.addEventListener('click', () => { this.input.abilityRequested = true; });
    this.ui.el.strikeBtn.addEventListener('click', () => { this.input.strikeRequested = true; });
    // Mute toggle.
    this.ui.el.muteBtn.addEventListener('click', () => {
      const muted = this.audio.toggleMute();
      this.ui.el.muteBtn.textContent = muted ? '🔇' : '🔊';
    });

    // Pause menu (P / Esc) + its controls.
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') &&
          (this.state === STATE.RUNNING || this.state === STATE.PAUSED)) {
        e.preventDefault();
        this.togglePause();
      }
    });
    this.ui.el.resumeBtn.addEventListener('click', () => this.togglePause());
    this.ui.el.quitBtn.addEventListener('click', () => this.quitToMenu());
    this.ui.el.setVolume.addEventListener('input', (e) => {
      this.settings.volume = parseFloat(e.target.value);
      this.audio.setMasterVolume(this.settings.volume);
      writeSettings(this.settings);
    });
    this.ui.el.setShake.addEventListener('change', (e) => {
      this.settings.shake = e.target.checked;
      writeSettings(this.settings);
    });
    this.ui.el.setAuto.addEventListener('input', (e) => {
      this.settings.autoLevel = parseInt(e.target.value, 10);
      this.ui.el.setAutoLabel.textContent = this.ui.AUTO_LABELS[this.settings.autoLevel];
      writeSettings(this.settings);
    });
  }

  // ---------------- lifecycle ----------------
  start(charId) {
    this.audio.init(); // user gesture — unlock audio + start music
    this.audio.setMasterVolume(this.settings.volume);
    if (charId) this.selectedCharacter = charId;
    const charDef = CHARACTER_DEFS[this.selectedCharacter];
    this.player = new Player(charDef, 0, 0);
    applyMetaBonuses(this.player, this.save); // permanent shop + overclock upgrades

    // Per-run loadout: charge salvage and apply equipped consumables (if affordable).
    this.coinMult = 1;
    this.reviveAvailable = false;
    const lc = loadoutCost(this.save);
    if (lc > 0 && this.save.coins >= lc) {
      this.save.coins -= lc;
      writeSave(this.save);
      const L = this.save.loadout;
      if (L.extraStrike) this.player.loopCharges += 1;
      if (L.sidearm) this.player.addWeapon('m4');
      if (L.greed) this.coinMult = 1.5;
      if (L.revive) this.reviveAvailable = true;
    }
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
    this.banner = { text: STAGES[0].name, life: 2.2 };
    this.camera = { x: -this.w / 2, y: -this.h / 2 };

    // Biome / stage progression.
    this.stage = 0;
    this.loop = 0;
    this.stageElapsed = 0;
    this.bossActive = false;
    this.bossRef = null;
    this.strike = null;

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

  // Killing a biome's boss clears it and advances to the next biome.
  advanceStage() {
    this.stage++;
    this.stageElapsed = 0;
    this.bossActive = false;
    this.bossRef = null;
    // A new loop begins each time we wrap past the last biome — difficulty steps up.
    const newLoop = Math.floor(this.stage / STAGES.length);
    const loopedUp = newLoop > this.loop;
    this.loop = newLoop;
    const s = STAGES[this.stage % STAGES.length];
    if (loopedUp) {
      // Each completed cycle grants a charge of the operator's signature airstrike.
      this.player.loopCharges++;
      this.announce(`⚔ LOOP ${this.loop + 1} — ${this.player.loopPower.name.toUpperCase()} READY (E)`);
    } else {
      this.announce(`▶ ${s.name}`);
    }
    // Reward clearing a biome: top the player up a little.
    this.player.heal(this.player.maxHp * 0.25);
  }

  // ---------------- spawning helpers ----------------
  spawnEnemy(type, x, y) { return this.enemies.spawn(type, x, y); }

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

  // ---------------- loop power-up (airstrike) ----------------
  // Schedule a pattern of timed bomb blasts across the visible area, with planes
  // flying over for flavour. Damage scales with the loop so it stays relevant.
  activateStrike() {
    const cfg = this.player.loopPower;
    const camX = this.camera.x, camY = this.camera.y, W = this.w, H = this.h;
    const dur = cfg.durationMs / 1000;
    const dmg = cfg.damage * (1 + this.loop * 0.4);
    const blasts = [];
    const lanes = cfg.planes || 1;

    if (cfg.pattern === 'scatter') {
      // Artillery: shells rain randomly across the screen.
      for (let i = 0; i < cfg.count; i++) {
        blasts.push({ x: camX + rand(40, W - 40), y: camY + rand(40, H - 40), t: rand(0, dur), r: cfg.radius, dmg });
      }
    } else {
      // sweep / carpet: planes cross left→right, dropping bombs along their lane.
      for (let L = 0; L < lanes; L++) {
        const laneY = lanes === 1 ? this.player.y : camY + H * (0.22 + 0.56 * (L / Math.max(1, lanes - 1)));
        this.fx.spawn({ type: 'plane', x: camX - 120, y: laneY, vx: (W + 240) / dur, life: dur + 0.3, maxLife: dur + 0.3 });
        const per = Math.ceil(cfg.count / lanes);
        for (let i = 0; i < per; i++) {
          const f = per === 1 ? 0.5 : i / (per - 1);
          blasts.push({ x: camX - 40 + f * (W + 80), y: laneY + rand(-26, 26), t: f * dur, r: cfg.radius, dmg });
        }
      }
    }

    this.strike = { blasts, healTeam: cfg.healTeam, soundCd: 0 };
    this.announce(`✈ ${cfg.name.toUpperCase()}`);
    this.audio.explosion();
  }

  updateStrike(dtMs) {
    if (!this.strike) return;
    const dt = dtMs / 1000;
    this.strike.soundCd -= dtMs;
    let pending = false;
    for (const b of this.strike.blasts) {
      if (b.done) continue;
      b.t -= dt;
      if (b.t <= 0) {
        b.done = true;
        this.fx.spawn({ type: 'explosion', x: b.x, y: b.y, radius: b.r, life: 0.45, maxLife: 0.45 });
        this.grid.queryRadius(b.x, b.y, b.r, (e) => {
          if (e.alive && Math.hypot(e.x - b.x, e.y - b.y) <= b.r + e.radius) this.damageEnemy(e, b.dmg);
        });
        this.shakeCamera(4);
        if (this.strike.soundCd <= 0) { this.audio.explosion(); this.strike.soundCd = 90; }
      } else { pending = true; }
    }
    if (!pending) {
      if (this.strike.healTeam) {
        this.player.heal(this.player.maxHp * 0.3);
        for (const m of this.team.members) if (m.alive) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.5);
      }
      this.strike = null;
    }
  }

  // Apply AoE damage to the player + teammates (used by boss attacks).
  enemyLabel(e) { return e.def.bossName || KILL_LABELS[e.type] || 'an enemy'; }

  damageFriendlies(x, y, radius, dmg, source = null) {
    const p = this.player;
    if (Math.hypot(p.x - x, p.y - y) <= radius + p.radius) {
      if (source) p.lastHitBy = source;
      if (p.takeDamage(dmg)) { this.shakeCamera(6); this.audio.playerHurt(); }
    }
    for (const m of this.team.members) {
      if (m.alive && Math.hypot(m.x - x, m.y - y) <= radius + m.radius) m.takeDamage(dmg);
    }
  }

  healAround(x, y, radius, amount) {
    if (Math.hypot(this.player.x - x, this.player.y - y) <= radius) this.player.heal(amount);
    for (const m of this.team.members) {
      if (m.alive && Math.hypot(m.x - x, m.y - y) <= radius) m.hp = Math.min(m.maxHp, m.hp + amount);
    }
  }

  shakeCamera(mag) {
    if (!this.settings.shake) return;
    this.shake.t = 0.18; this.shake.mag = Math.max(this.shake.mag, mag);
  }

  togglePause() {
    if (this.state === STATE.RUNNING) { this.state = STATE.PAUSED; this.ui.showPause(this); }
    else if (this.state === STATE.PAUSED) { this.state = STATE.RUNNING; this.ui.hidePause(); }
  }

  quitToMenu() {
    this.state = STATE.START;
    this.ui.hidePause();
    this.ui.hideAbility();
    this.ui.showStart();
  }

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
    // Bombers detonate, hurting nearby friendlies.
    if (e.def.explodeOnDeath) {
      const ex = e.def.explodeOnDeath;
      this.fx.spawn({ type: 'explosion', x: e.x, y: e.y, radius: ex.radius, life: 0.4, maxLife: 0.4 });
      this.damageFriendlies(e.x, e.y, ex.radius, ex.damage * this.statScaleNow, this.enemyLabel(e));
      this.shakeCamera(5);
      this.audio.explosion();
    }
    // XP drops scale with the enemy's worth.
    const drops = e.def.boss ? 12 : e.def.elite ? 5 : 1;
    for (let i = 0; i < drops; i++) {
      const a = rand(0, TAU), r = rand(0, e.radius);
      this.spawnGem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, Math.ceil(e.xp / drops));
    }
    if (e.def.boss || e.def.elite) { this.fx.spawn({ type: 'explosion', x: e.x, y: e.y, radius: e.radius * 1.6, life: 0.5, maxLife: 0.5 }); this.shakeCamera(10); }
    // A biome boss falling advances to the next biome.
    if (e.def.boss && this.bossActive && e === this.bossRef) this.advanceStage();

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
    // Stop the biome timer once the boss is up, so the gate fires only once.
    if (!this.bossActive) this.stageElapsed += dt;
    this.statScaleNow = DIFFICULTY.statScale(this.elapsed) * DIFFICULTY.loopStat(this.loop);
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

    // --- loop power-up (airstrike, charge-based) ---
    if (this.input.strikeRequested) {
      this.input.strikeRequested = false;
      if (p.loopCharges > 0 && !this.strike) { p.loopCharges--; this.activateStrike(); }
    }
    this.updateStrike(dtMs);

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
          p.lastHitBy = this.enemyLabel(e);
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
        p.lastHitBy = 'enemy fire';
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
      } else if (f.type === 'plane') {
        f.x += f.vx * dt;
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

    // --- death (Revive Kit cheats it once) ---
    if (p.hp <= 0) {
      if (this.reviveAvailable) {
        this.reviveAvailable = false;
        p.hp = p.maxHp * 0.5;
        p.invuln = Math.max(p.invuln, 2500);
        this.fx.spawn({ type: 'explosion', x: p.x, y: p.y, radius: 100, life: 0.5, maxLife: 0.5 });
        this.shakeCamera(8);
        this.announce('⚡ REVIVED');
      } else {
        this.gameOver();
      }
    }
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
    const cards = generateCards(this);
    const mode = this.settings.autoLevel || 0;

    // Auto-buy: pick a card without pausing the run.
    if (mode > 0) {
      const card = this.pickAutoCard(cards, mode);
      card.apply();
      this.pendingLevelUps--;
      this.audio.levelUp();
      // Brief floating label so the player sees what was chosen.
      this.fx.spawn({ type: 'dmg', x: this.player.x, y: this.player.y - 40, value: '▲ ' + card.name, color: '#9fd0ff', vy: -42, life: 0.9, maxLife: 0.9 });
      if (this.pendingLevelUps > 0) this.showNextCard();
      else this.state = STATE.RUNNING;
      return;
    }

    this.state = STATE.LEVELUP;
    this.audio.levelUp();
    this.ui.showLevelUp(cards, (card) => {
      this.audio.uiClick();
      card.apply();
      this.pendingLevelUps--;
      this.ui.hideLevelUp();
      if (this.pendingLevelUps > 0) this.showNextCard();
      else this.state = STATE.RUNNING;
    });
  }

  // Choose a card automatically: mode 1 = random, mode 2 = highest rarity.
  pickAutoCard(cards, mode) {
    if (mode === 2) {
      let best = cards[0];
      for (const c of cards) if (c.rarity.tier > best.rarity.tier) best = c;
      return best;
    }
    return cards[(Math.random() * cards.length) | 0];
  }

  gameOver() {
    this.state = STATE.OVER;
    this.audio.gameOver();
    this.ui.hideAbility();
    this.ui.hideLevelUp();
    // Award meta-currency for the run and persist it.
    this.coinsEarned = coinsForRun(this.elapsed, this.player.kills, this.stage, this.coinMult || 1);
    this.save.coins += this.coinsEarned;
    writeSave(this.save);
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
      if (e.def.boss) {
        const by = e.y - e.radius - 14;
        this.drawHpBar(e.x, by, e.radius * 2, e.hp / e.maxHp, '#ff5a4a');
        if (e.def.bossName) {
          ctx.save();
          ctx.font = '800 13px Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffd23b';
          ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
          ctx.strokeText(e.def.bossName, e.x, by - 6);
          ctx.fillText(e.def.bossName, e.x, by - 6);
          ctx.restore();
        }
      }
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
    if (this.state !== STATE.OVER) { this.ui.updateHud(this); this.ui.updateAbility(this.player); this.ui.updateStrike(this.player); }
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

    // Tiled ground texture for the current biome. Falls back to a faint grid.
    const stage = STAGES[(this.stage || 0) % STAGES.length];
    const ground = getSprite(stage.ground) || getSprite('ground');
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

    // Biome mood wash.
    const tint = STAGES[(this.stage || 0) % STAGES.length].tint;
    if (tint) { ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h); }
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
      } else if (f.type === 'tele_circle') {
        // Warning zone that fills toward the moment of impact (prog 0 -> 1).
        const prog = 1 - k;
        ctx.save();
        ctx.fillStyle = f.color || 'rgba(255,60,40,0.5)';
        ctx.globalAlpha = 0.22 + 0.22 * Math.abs(Math.sin(prog * 18));
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius * prog, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 3; ctx.strokeStyle = f.color || 'rgba(255,80,50,0.95)';
        ctx.beginPath(); ctx.arc(f.x, f.y, f.radius, 0, TAU); ctx.stroke();
        ctx.restore();
      } else if (f.type === 'tele_line') {
        const prog = 1 - k;
        ctx.save();
        ctx.translate(f.x, f.y); ctx.rotate(f.angle);
        ctx.globalAlpha = 0.18 + 0.2 * Math.abs(Math.sin(prog * 18));
        ctx.fillStyle = 'rgba(255,60,40,0.5)';
        ctx.fillRect(0, -f.width / 2, f.length * prog, f.width);
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,80,50,0.9)';
        ctx.strokeRect(0, -f.width / 2, f.length, f.width);
        ctx.restore();
      } else if (f.type === 'plane') {
        // Top-down fighter passing over: shadow offset below, body pointing +x.
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(f.x - 6, f.y + 22, 18, 6, 0, 0, TAU); ctx.fill();
        ctx.translate(f.x, f.y);
        ctx.fillStyle = '#3b4a2e';
        ctx.beginPath(); // fuselage
        ctx.moveTo(20, 0); ctx.lineTo(-14, 6); ctx.lineTo(-14, -6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2c3722';
        ctx.fillRect(-8, -16, 6, 32); // wings
        ctx.fillStyle = '#222b1a';
        ctx.fillRect(-14, -9, 4, 18); // tail
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
