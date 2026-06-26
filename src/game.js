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
import { NetSession } from './net.js';
import { getSavedName, submitScore } from './leaderboard.js';
import { CHAPTERS } from './story.js';
import { playStoryboard } from './storyboard.js';
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
    this.coopMode = false; // true while in a P2P co-op session (Phase 1: shared arena)
    this.mp = null;        // { net, isHost, name, code, remotes:Map, sendTimer }
    this.missionMode = false; // true during a story-mode mission
    this.missionChapter = null;
    this._pendingMission = null;
    this._storyChapter = 0;
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
    // Story mode.
    this.ui.el.storyBtn.addEventListener('click', () => this.openStory());
    this.ui.el.chapterBackBtn.addEventListener('click', () => { this.ui.hideChapterSelect(); this.ui.showStart(); });
    // Co-op lobby.
    this.ui.el.coopBtn.addEventListener('click', () => this.ui.openCoop(this));
    this.ui.el.coopHostBtn.addEventListener('click', () => this.hostCoop());
    this.ui.el.coopJoinBtn.addEventListener('click', () => this.joinCoop(this.ui.el.coopCodeInput.value.trim().toUpperCase()));
    this.ui.el.coopStartBtn.addEventListener('click', () => this.hostStartCoop());
    this.ui.el.coopLeaveBtn.addEventListener('click', () => this.leaveCoop());
    this.ui.el.coopOverLeave.addEventListener('click', () => this.leaveCoop());
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
      const applied = [];
      if (L.extraStrike) { this.player.loopCharges += 1; applied.push('✈️'); }
      if (L.sidearm) { this.player.addWeapon('m4'); applied.push('🔫'); }
      if (L.greed) { this.coinMult = 1.5; applied.push('🪙'); }
      if (L.revive) { this.reviveAvailable = true; applied.push('✚'); }
      if (applied.length) this.pendingLoadoutBanner = `🎒 LOADOUT DEPLOYED ${applied.join(' ')}`;
    } else if (lc > 0) {
      // Equipped but couldn't afford it — tell the player instead of silently skipping.
      this.pendingLoadoutBanner = `🎒 LOADOUT SKIPPED — need 🪙${lc}`;
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
    // Confirm the deployed loadout on screen (so it's never silently missing);
    // fall back to the opening biome name.
    this.banner = { text: this.pendingLoadoutBanner || STAGES[0].name, life: 2.6 };
    this.pendingLoadoutBanner = null;
    this.camera = { x: -this.w / 2, y: -this.h / 2 };

    // Biome / stage progression.
    this.stage = 0;
    this.loop = 0;
    this.stageElapsed = 0;
    this.bossActive = false;
    this.bossRef = null;
    this.strike = null;

    // Story mission: lock the run to a single biome ending in that chapter's boss.
    this.missionMode = !!this._pendingMission;
    this.missionChapter = this._pendingMission || null;
    if (this._pendingMission) {
      this.stage = this._pendingMission.biome;
      this.banner = { text: 'MISSION · ' + this._pendingMission.sub, life: 2.6 };
    }
    this._pendingMission = null;

    this.ui.hideStart();
    this.ui.hideGameOver();
    this.ui.hideLevelUp();
    this.ui.showAbility(this.player);
    document.getElementById('hud').style.display = ''; // restore survival HUD
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
  activateStrike(striker = this.player) {
    const cfg = striker.loopPower;
    const W = this.w, H = this.h;
    // Center the strike region on the striking player (works for any co-op player).
    const camX = striker.x - W / 2, camY = striker.y - H / 2;
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
        const laneY = lanes === 1 ? striker.y : camY + H * (0.22 + 0.56 * (L / Math.max(1, lanes - 1)));
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

  // ================= Co-op (Phase 1: P2P shared arena) =================
  _wireNet() {
    const net = this.mp.net;
    net.on('open', () => this.ui.updateLobby(net.peerCount() + 1, this.mp.isHost));
    net.on('leave', (id) => {
      if (this.mp) { this.mp.remotes.delete(id); this.ui.updateLobby(net.peerCount() + 1, this.mp.isHost); }
    });
    net.on('message', (msg, from) => this._onNetMessage(msg, from));
  }

  async hostCoop() {
    this.mp = { net: new NetSession(), isHost: true, name: getSavedName() || 'Host', code: null, remotes: new Map(), sendTimer: 0 };
    this._wireNet();
    try {
      this.mp.code = await this.mp.net.host();
      this.ui.showCoopRoom(this.mp.code, true);
      this.ui.updateLobby(1, true);
    } catch (e) { this.ui.coopError('Could not host: ' + e.message); this.mp = null; }
  }

  async joinCoop(code) {
    if (!/^[A-Z0-9]{4}$/.test(code)) { this.ui.coopError('Enter a 4-character room code'); return; }
    this.mp = { net: new NetSession(), isHost: false, name: getSavedName() || 'Player', code, remotes: new Map(), sendTimer: 0 };
    this._wireNet();
    try {
      await this.mp.net.join(code);
      this.ui.showCoopRoom(code, false);
      this.ui.updateLobby(this.mp.net.peerCount() + 1, false);
    } catch (e) { this.ui.coopError('Could not join: ' + e.message); this.mp = null; }
  }

  leaveCoop() {
    if (this.mp && this.mp.net) this.mp.net.close();
    this.mp = null;
    this.coopMode = false;
    this.coopOver = false;
    this.snap = null;
    document.getElementById('hud').style.display = '';
    this.ui.hideCoop();
    this.ui.coopHideOver();
    this.state = STATE.START;
    this.ui.showStart();
  }

  // ================= Story mode =================
  openStory() { this.ui.openStory(this); }

  playChapter(idx) {
    const ch = CHAPTERS[idx];
    if (!ch) return;
    this._storyChapter = idx;
    this.ui.hideChapterSelect();
    playStoryboard(ch.intro, () => this.startMission(ch));
  }

  startMission(ch) {
    this._pendingMission = ch;
    this.start(); // start() reads _pendingMission and locks the biome + boss
  }

  missionWin() {
    const ch = CHAPTERS[this._storyChapter];
    this.missionMode = false;
    this.state = STATE.OVER; // freeze the sim behind the comic
    this.ui.hideAbility();
    document.getElementById('hud').style.display = 'none';
    if (this._storyChapter + 1 > this.save.story) { this.save.story = this._storyChapter + 1; writeSave(this.save); }
    playStoryboard(ch.outro, () => { this.state = STATE.START; this.ui.openStory(this); });
  }

  missionFailed() {
    this.missionMode = false;
    this.state = STATE.START;
    this.ui.hideAbility();
    document.getElementById('hud').style.display = 'none';
    this.ui.openStory(this, true);
  }

  // Host clicked START — tell everyone to drop into the shared arena.
  hostStartCoop() {
    if (!this.mp || !this.mp.isHost) return;
    this.mp.net.send({ t: 'start' });
    this.startCoop(true);
  }

  startCoop(isHost) {
    this.audio.init();
    this.audio.setMasterVolume(this.settings.volume);
    const charDef = CHARACTER_DEFS[this.selectedCharacter];
    this.player = new Player(charDef, rand(-80, 80), rand(-80, 80));
    this.mp.isHost = isHost;
    this.mp.sendTimer = 0;
    this.mp.snapTimer = 0;
    this.coopMode = true;
    this.coopOver = false;
    this.snap = null;
    this.camera = { x: this.player.x - this.w / 2, y: this.player.y - this.h / 2 };
    this.ui.hideCoop();
    this.ui.hideStart();
    document.getElementById('hud').style.display = 'none';
    this.banner = { text: '👥 CO-OP — survive together!', life: 2.6 };
    this.state = STATE.RUNNING;

    if (isHost) {
      // The full shared simulation runs on the host.
      this.enemies.clear(); this.allyBullets.clear(); this.enemyBullets.clear();
      this.gems.clear(); this.pickups.clear(); this.fx.clear();
      this.team = new Team();
      this.spawner = new Spawner();
      this.elapsed = 0; this.statScaleNow = 1; this.stage = 0; this.loop = 0;
      this.stageElapsed = 0; this.bossActive = false; this.bossRef = null; this.strike = null;
      // mp.remotes from the lobby become full players once they say 'hello'.
      for (const r of this.mp.remotes.values()) { r.input = r.input || {}; r.player = null; }
    } else {
      this.mp.net.send({ t: 'hello', char: this.selectedCharacter, n: this.mp.name });
    }
  }

  _onNetMessage(msg, from) {
    if (!this.mp) return;
    if (msg.t === 'start' && !this.mp.isHost && !this.coopMode) { this.startCoop(false); return; }
    if (!this.coopMode) return;
    if (this.mp.isHost) {
      if (msg.t === 'hello') this._coopAddRemote(from, msg.char, msg.n);
      else if (msg.t === 'input') { const r = this.mp.remotes.get(from); if (r) r.input = msg; }
    } else {
      if (msg.t === 'snap') this.snap = msg;
      else if (msg.t === 'over') { this.coopOver = true; this.ui.coopShowOver(msg); }
    }
  }

  _coopAddRemote(id, char, name) {
    const def = CHARACTER_DEFS[char] || CHARACTER_DEFS.commando;
    const p = new Player(def, this.player.x + rand(-60, 60), this.player.y + rand(-60, 60));
    this.mp.remotes.set(id, { player: p, input: {}, n: (name || 'Player').slice(0, 16), id });
  }

  // Player objects the host simulates besides itself.
  _coopRemotePlayers() {
    const out = [];
    for (const r of this.mp.remotes.values()) if (r.player) out.push(r.player);
    return out;
  }

  // Drive each remote player on the host: movement, aim, auto-fire, ability, regen.
  _coopHostPlayers(dtMs) {
    const dt = dtMs / 1000;
    for (const r of this.mp.remotes.values()) {
      const p = r.player; if (!p) continue;
      if (p.hp <= 0) continue; // downed
      if (p.invuln > 0) p.invuln -= dtMs;
      if (p.hpRegen > 0) p.heal(p.hpRegen * dt);
      p.updateAbility(dtMs);
      const inp = r.input || {};
      if (inp.ability) { inp.ability = 0; if (p.tryActivateAbility(this)) this.audio.ability(); }
      if (inp.strike) { inp.strike = 0; if (p.loopCharges > 0 && !this.strike) { p.loopCharges--; this.activateStrike(p); } }
      const mx = inp.mx || 0, my = inp.my || 0;
      if (mx || my) { p.x += mx * p.speed * dt; p.y += my * p.speed * dt; p.moveAngle = Math.atan2(my, mx); }
      const aim = this.findNearestEnemy(p.x, p.y, 900);
      p.angle = aim ? Math.atan2(aim.y - p.y, aim.x - p.x) : p.moveAngle;
      for (const w of p.weapons) {
        const shots = w.update(dtMs, p, p.angle);
        if (shots) {
          const gx = p.x + Math.cos(p.angle) * (p.radius + 14), gy = p.y + Math.sin(p.angle) * (p.radius + 14);
          this.muzzleFlash(gx, gy, p.angle); this.ejectShell(gx, gy, p.angle);
          for (const s of shots) this.spawnAllyBullet({ x: gx, y: gy, ...s });
        }
      }
    }
  }

  // Downed players are revived by a living teammate standing close for ~2.5s.
  _coopRevives(dt) {
    const players = [this.player, ...this._coopRemotePlayers()];
    for (const dp of players) {
      if (dp.hp > 0) { dp.reviveT = 0; continue; }
      let nearby = false;
      for (const lp of players) {
        if (lp === dp || lp.hp <= 0) continue;
        if ((lp.x - dp.x) ** 2 + (lp.y - dp.y) ** 2 < 56 * 56) { nearby = true; break; }
      }
      if (nearby) {
        dp.reviveT = (dp.reviveT || 0) + dt;
        if (dp.reviveT >= 2.5) {
          dp.hp = dp.maxHp * 0.4; dp.invuln = 1500; dp.reviveT = 0;
          this.fx.spawn({ type: 'explosion', x: dp.x, y: dp.y, radius: 60, life: 0.4, maxLife: 0.4 });
          this.announce('⚕ REVIVED!');
        }
      } else {
        dp.reviveT = Math.max(0, (dp.reviveT || 0) - dt * 0.6);
      }
    }
  }

  // Award levels to a specific player by auto-picking the best card (co-op never
  // pauses the shared game for a card screen).
  coopAutoLevel(player, levels) {
    const saved = this.player;
    this.player = player;
    try {
      for (let i = 0; i < levels; i++) this.pickAutoCard(generateCards(this), 2).apply();
    } finally { this.player = saved; }
  }

  coopGameOver() {
    if (this.coopOver) return;
    this.coopOver = true;
    const players = 1 + this._coopRemotePlayers().length;
    const info = { el: Math.round(this.elapsed), st: this.stage, lp: this.loop, players };
    if (this.mp.isHost) {
      this.mp.net.send({ t: 'over', ...info });
      // Submit the team run to the co-op leaderboard.
      const all = [this.player, ...this._coopRemotePlayers()];
      const kills = all.reduce((s, q) => s + (q.kills || 0), 0);
      const level = Math.max(1, ...all.map((q) => q.level));
      submitScore({ name: this.mp.name, time: this.elapsed, kills, level, mode: 'coop', players }).catch(() => {});
    }
    this.ui.coopShowOver(info);
  }

  // Host: build and broadcast a world snapshot (~20 Hz).
  coopBroadcast() {
    this.mp.snapTimer -= 16;
    if (this.mp.snapTimer > 0) return;
    this.mp.snapTimer = 50;
    const snapPlayer = (p, id, name) => ({
      i: id, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(2), s: p.sprite,
      hp: Math.round(p.hp), mhp: Math.round(p.maxHp), lv: p.level, n: name,
      d: p.hp <= 0 ? 1 : 0, rv: p.hp <= 0 ? +((p.reviveT || 0) / 2.5).toFixed(2) : 0,
    });
    const pl = [snapPlayer(this.player, this.mp.net.peerId, this.mp.name)];
    for (const [id, r] of this.mp.remotes) { if (r.player) pl.push(snapPlayer(r.player, id, r.n)); }
    // Cap entity counts so a snapshot never exceeds the data channel limit /
    // overflows the send buffer (bosses are always included).
    const en = [];
    for (const e of this.enemies.active) {
      if (!e.alive) continue;
      if (en.length >= 160 && !e.def.boss) continue;
      en.push({ x: Math.round(e.x), y: Math.round(e.y), a: +e.angle.toFixed(2), s: e.def.sprite, r: e.radius, b: e.def.boss ? 1 : 0, hpf: e.def.boss ? +(e.hp / e.maxHp).toFixed(2) : 0 });
    }
    const ab = [];
    for (const b of this.allyBullets.active) { if (!b.alive) continue; if (ab.length >= 110) break; ab.push({ x: Math.round(b.x), y: Math.round(b.y), a: +Math.atan2(b.vy, b.vx).toFixed(2), c: b.color, l: b.len }); }
    const eb = [];
    for (const b of this.enemyBullets.active) { if (!b.alive) continue; if (eb.length >= 90) break; eb.push({ x: Math.round(b.x), y: Math.round(b.y), c: b.color }); }
    const gm = [];
    for (const g of this.gems.active) { if (!g.alive) continue; if (gm.length >= 120) break; gm.push({ x: Math.round(g.x), y: Math.round(g.y) }); }
    const pk = [];
    for (const k of this.pickups.active) if (k.alive) pk.push({ x: Math.round(k.x), y: Math.round(k.y) });
    const tm = [];
    for (const m of this.team.members) if (m.alive) tm.push({ x: Math.round(m.x), y: Math.round(m.y), a: +m.angle.toFixed(2), s: m.def.sprite });
    this.mp.net.send({ t: 'snap', pl, en, ab, eb, gm, pk, tm, m: { st: this.stage, lp: this.loop, bn: this.banner.life > 0 ? this.banner.text : '' } });
  }

  // Client: send input to the host, follow my player from the latest snapshot.
  coopClientUpdate(dtMs) {
    const dt = dtMs / 1000;
    this.input.update();
    this.mp.sendTimer -= dtMs;
    if (this.mp.sendTimer <= 0) {
      this.mp.sendTimer = 50;
      this.mp.net.send({
        t: 'input', mx: +(this.input.mx || 0).toFixed(2), my: +(this.input.my || 0).toFixed(2),
        ability: this._consumeInput('abilityRequested'), strike: this._consumeInput('strikeRequested'),
      });
    }
    if (this.snap) {
      const me = (this.snap.pl || []).find((p) => p.i === this.mp.net.peerId);
      if (me) { this.camera.x = me.x - this.w / 2; this.camera.y = me.y - this.h / 2; }
      if (this.snap.m && this.snap.m.bn && this.snap.m.bn !== this.banner.text) this.banner = { text: this.snap.m.bn, life: 2.4 };
    }
    if (this.banner.life > 0) this.banner.life -= dt;
  }

  _consumeInput(flag) { const v = this.input[flag]; this.input[flag] = false; return v ? 1 : 0; }

  // Client: render purely from the host's snapshot.
  coopClientRender() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const camX = this.camera.x, camY = this.camera.y;
    if (this.snap) this.stage = this.snap.m.st || 0; // pick the right biome ground
    this.drawBackground(camX, camY);
    const s = this.snap;
    if (s) {
      ctx.save();
      ctx.translate(-camX, -camY);
      for (const g of s.gm || []) this.drawCentered(getSprite('xp_gem'), g.x, g.y);
      for (const k of s.pk || []) this.drawCentered(getSprite('health'), k.x, k.y);
      for (const e of s.en || []) {
        this.drawShadow(e.x, e.y, e.r || 16);
        this.drawUnit(getSprite(e.s) || getSprite('enemy_chaser'), e.x, e.y, e.a || 0, 1, false, true);
        if (e.b) this.drawHpBar(e.x, e.y - (e.r || 40) - 14, (e.r || 40) * 2, e.hpf, '#ff5a4a');
      }
      for (const m of s.tm || []) { this.drawShadow(m.x, m.y, 16); this.drawUnit(getSprite(m.s), m.x, m.y, m.a || 0, 1, false); }
      for (const b of s.ab || []) this._drawBulletLine(b.x, b.y, b.a, b.c, b.l);
      for (const b of s.eb || []) { ctx.fillStyle = b.c || '#ff5bd0'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, TAU); ctx.fill(); }
      for (const p of s.pl || []) {
        const me = p.i === this.mp.net.peerId;
        this._drawCoopPlayer(p.x, p.y, p.a, p.s, me ? p.n + ' (you)' : p.n, p.hp, p.mhp, p.d, p.rv, me);
      }
      ctx.restore();
    }
    this.drawVignette();
    if (!s) {
      ctx.save();
      ctx.font = '800 24px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9a8'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.strokeText('Connecting to host…', this.w / 2, this.h / 2);
      ctx.fillText('Connecting to host…', this.w / 2, this.h / 2);
      ctx.restore();
      return;
    }
    this._coopHud();
  }

  _drawBulletLine(x, y, a, color, len) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a || 0);
    ctx.strokeStyle = color || '#ffe08a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-(len || 10) / 2, 0); ctx.lineTo((len || 10) / 2, 0); ctx.stroke();
    ctx.restore();
  }

  // Co-op overlay HUD (room, player count, own HP/level) on host and client.
  _coopHud() {
    const ctx = this.ctx;
    let hp = 0, mhp = 1, lv = 1;
    if (this.mp.isHost) { hp = this.player.hp; mhp = this.player.maxHp; lv = this.player.level; }
    else if (this.snap) { const me = (this.snap.pl || []).find((p) => p.i === this.mp.net.peerId); if (me) { hp = me.hp; mhp = me.mhp; lv = me.lv; } }
    const count = this.mp.isHost ? this._coopRemotePlayers().length + 1 : (this.snap ? (this.snap.pl || []).length : 1);
    ctx.save();
    ctx.font = '700 15px Segoe UI, sans-serif'; ctx.fillStyle = '#ffe9a8'; ctx.textAlign = 'left';
    ctx.fillText(`👥 ROOM ${this.mp.code} · ${count} player${count === 1 ? '' : 's'} · Lv ${lv}`, 16, 26);
    ctx.restore();
    // Own HP bar bottom-center.
    const bw = 240, bx = this.w / 2 - bw / 2, by = this.h - 30;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 12);
    ctx.fillStyle = hp <= 0 ? '#555' : '#d23b3b'; ctx.fillRect(bx, by, bw * Math.max(0, hp / mhp), 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, 12);
    ctx.fillStyle = '#fff'; ctx.font = '700 11px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(hp <= 0 ? 'DOWNED' : `${Math.max(0, Math.round(hp))} / ${Math.round(mhp)}`, this.w / 2, by + 10);
    ctx.restore();
    if (this.banner.life > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.banner.life);
      ctx.font = '800 30px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.strokeText(this.banner.text, this.w / 2, 110);
      ctx.fillText(this.banner.text, this.w / 2, 110);
      ctx.restore();
    }
  }

  _drawName(name, x, y, color = '#fff') {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 12px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(name, x, y);
    ctx.fillStyle = color; ctx.fillText(name, x, y);
    ctx.restore();
  }

  // Draw a co-op player (used by both client snapshot render and host render),
  // showing a downed state with a revive-progress ring.
  _drawCoopPlayer(x, y, a, sprite, name, hp, mhp, downed, rv, me) {
    const ctx = this.ctx;
    this.drawShadow(x, y, 18);
    ctx.save(); if (downed) ctx.globalAlpha = 0.4;
    this.drawUnit(getSprite(sprite) || getSprite('char_commando'), x, y, a || 0, 1, false);
    ctx.restore();
    if (downed) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.stroke();
      if (rv > 0) { ctx.strokeStyle = '#7fff8a'; ctx.beginPath(); ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * rv); ctx.stroke(); }
      ctx.restore();
      this._drawName(me ? 'DOWNED — get help!' : 'DOWNED', x, y - 32, '#ff8a8a');
    } else {
      this._drawName(name, x, y - 32);
      this.drawHpBar(x, y - 26, 34, mhp ? hp / mhp : 0, me ? '#7fff8a' : '#7fd06b');
    }
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
    if (e.def.boss && this.bossActive && e === this.bossRef) {
      if (this.missionMode) this.missionWin();
      else this.advanceStage();
    }

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
    // In co-op, only the host runs the simulation; clients just send input + render.
    if (this.coopMode && this.mp && !this.mp.isHost) { this.coopClientUpdate(dtMs); return; }
    if (this.coopOver) return;
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

    // --- player movement (a downed co-op player can't act until revived) ---
    this.input.update();
    const hostActive = !this.coopMode || p.hp > 0;
    if (hostActive && (this.input.mx || this.input.my)) {
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

    if (hostActive) for (const w of p.weapons) {
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

    // --- co-op: simulate remote players + downed-player revives (host only) ---
    if (this.coopMode) { this._coopHostPlayers(dtMs); this._coopRevives(dt); }

    // --- teammates ---
    this.team.update(dtMs, this);

    // --- enemies: choose target (nearest friendly), move, contact damage ---
    const friendlies = [p, ...(this.coopMode ? this._coopRemotePlayers() : []), ...this.team.members];
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
      // vs co-op remote players
      if (this.coopMode) {
        let hit = false;
        for (const rp of this._coopRemotePlayers()) {
          if (rp.hp > 0 && (rp.x - b.x) ** 2 + (rp.y - b.y) ** 2 <= (rp.radius + 4) ** 2) { rp.takeDamage(b.damage); b.alive = false; hit = true; break; }
        }
        if (hit) continue;
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
    // In co-op, gems home to (and are collected by) the nearest living player.
    const xpPlayers = this.coopMode ? [p, ...this._coopRemotePlayers()].filter((q) => q.hp > 0) : null;
    for (const g of this.gems.active) {
      if (!g.alive) continue;
      let owner = p;
      if (xpPlayers && xpPlayers.length) {
        let nd = Infinity;
        for (const q of xpPlayers) { const dd = (q.x - g.x) ** 2 + (q.y - g.y) ** 2; if (dd < nd) { nd = dd; owner = q; } }
      }
      const dx = owner.x - g.x, dy = owner.y - g.y;
      const d = Math.hypot(dx, dy);
      const sp = 520 + Math.max(0, 600 - d) * 0.9; // faster when close
      g.x += dx / (d || 1) * sp * dt;
      g.y += dy / (d || 1) * sp * dt;
      if (d < owner.radius + 8) {
        g.alive = false;
        const lv = owner.gainXp(g.value);
        collectedXp = true;
        if (this.coopMode) { if (lv > 0) this.coopAutoLevel(owner, lv); }
        else levelsGained += lv;
      }
    }
    if (collectedXp) this.audio.pickupXp();
    if (levelsGained > 0) this.triggerLevelUp(levelsGained);

    // --- health packs: magnet + pickup (nearest living player in co-op) ---
    for (const hpk of this.pickups.active) {
      if (!hpk.alive) continue;
      let owner = p;
      if (xpPlayers && xpPlayers.length) {
        let nd = Infinity;
        for (const q of xpPlayers) { const dd = (q.x - hpk.x) ** 2 + (q.y - hpk.y) ** 2; if (dd < nd) { nd = dd; owner = q; } }
      }
      const dx = owner.x - hpk.x, dy = owner.y - hpk.y;
      const d = Math.hypot(dx, dy);
      if (hpk.magnet || d < owner.pickupRange) {
        hpk.magnet = true;
        hpk.x += dx / (d || 1) * 460 * dt;
        hpk.y += dy / (d || 1) * 460 * dt;
      }
      if (d < owner.radius + 8) {
        hpk.alive = false;
        const before = owner.hp;
        owner.heal(hpk.heal);
        const healed = Math.round(owner.hp - before);
        if (healed > 0) this.addDamageNumber(owner.x, owner.y - 28, healed, '#7fff8a');
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

    // --- death ---
    if (this.coopMode) {
      // The run ends only when every player is down; then broadcast the snapshot.
      const anyAlive = this.player.hp > 0 || this._coopRemotePlayers().some((rp) => rp.hp > 0);
      if (!anyAlive) this.coopGameOver();
      this.coopBroadcast();
    } else if (p.hp <= 0) {
      if (this.reviveAvailable) {
        this.reviveAvailable = false;
        p.hp = p.maxHp * 0.5;
        p.invuln = Math.max(p.invuln, 2500);
        this.fx.spawn({ type: 'explosion', x: p.x, y: p.y, radius: 100, life: 0.5, maxLife: 0.5 });
        this.shakeCamera(8);
        this.announce('⚡ REVIVED');
      } else if (this.missionMode) {
        this.missionFailed();
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

    if (this.coopMode && this.mp && !this.mp.isHost) { this.coopClientRender(); return; }
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

    // co-op remote players (host view)
    if (this.coopMode) {
      for (const r of this.mp.remotes.values()) {
        const rp = r.player; if (!rp) continue;
        const down = rp.hp <= 0;
        this._drawCoopPlayer(rp.x, rp.y, rp.angle, rp.sprite, r.n, rp.hp, rp.maxHp, down ? 1 : 0, down ? (rp.reviveT || 0) / 2.5 : 0, false);
      }
    }

    // player (downed host shows the downed/revive overlay; otherwise normal)
    if (this.coopMode && this.player.hp <= 0) {
      this._drawCoopPlayer(this.player.x, this.player.y, this.player.angle, this.player.sprite, this.mp.name, 0, this.player.maxHp, 1, (this.player.reviveT || 0) / 2.5, true);
    } else {
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
    }

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

    // Co-op (host) draws its own canvas HUD; single-player uses the DOM HUD.
    if (this.coopMode) { this._coopHud(); return; }

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
