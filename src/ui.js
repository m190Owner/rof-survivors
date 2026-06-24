// DOM UI layer: HUD updates, the level-up card screen, start + game-over modals.
// World-space FX (damage numbers, banners, shake) live in game.js / render.

import { WEAPON_DEFS } from './weapons.js';
import { TEAMMATE_DEFS } from './teammates.js';
import { CHARACTER_DEFS } from './characters.js';
import { STAGES } from './config.js';
import { getSprite, spriteSize } from './sprites.js';
import { fetchBoard, submitScore, getSavedName, saveName } from './leaderboard.js';
import { META_UPGRADES, OPERATOR_UNLOCKS, upgradeCost, writeSave } from './save.js';

export class UI {
  constructor() {
    this.el = {
      timer: document.getElementById('timer'),
      level: document.getElementById('stat-level'),
      kills: document.getElementById('stat-kills'),
      xpFill: document.getElementById('xp-bar-fill'),
      xpLabel: document.getElementById('xp-bar-label'),
      hpFill: document.getElementById('hp-bar-fill'),
      hpLabel: document.getElementById('hp-bar-label'),
      weaponList: document.getElementById('weapon-list'),
      teamList: document.getElementById('team-list'),
      levelup: document.getElementById('levelup-screen'),
      cardRow: document.getElementById('card-row'),
      gameover: document.getElementById('gameover-screen'),
      gameoverTitle: document.getElementById('gameover-title'),
      summary: document.getElementById('run-summary'),
      restart: document.getElementById('restart-btn'),
      start: document.getElementById('start-screen'),
      charSelect: document.getElementById('char-select'),
      abilityBtn: document.getElementById('ability-btn'),
      abilityIcon: document.getElementById('ability-icon'),
      abilityCd: document.getElementById('ability-cd'),
      abilityName: document.getElementById('ability-name'),
      strikeBtn: document.getElementById('strike-btn'),
      strikeIcon: document.getElementById('strike-icon'),
      strikeCount: document.getElementById('strike-count'),
      strikeName: document.getElementById('strike-name'),
      muteBtn: document.getElementById('mute-btn'),
      lbStartList: document.getElementById('lb-start-list'),
      lbGoList: document.getElementById('lb-go-list'),
      lbName: document.getElementById('lb-name'),
      lbSubmitBtn: document.getElementById('lb-submit-btn'),
      lbSubmitMsg: document.getElementById('lb-submit-msg'),
      startCoins: document.getElementById('start-coins'),
      shopBtn: document.getElementById('shop-btn'),
      shopScreen: document.getElementById('shop-screen'),
      shopCoins: document.getElementById('shop-coins'),
      shopUpgrades: document.getElementById('shop-upgrades'),
      shopOperators: document.getElementById('shop-operators'),
      shopBack: document.getElementById('shop-back-btn'),
      pauseScreen: document.getElementById('pause-screen'),
      resumeBtn: document.getElementById('resume-btn'),
      quitBtn: document.getElementById('quit-btn'),
      setVolume: document.getElementById('set-volume'),
      setShake: document.getElementById('set-shake'),
      setAuto: document.getElementById('set-auto'),
      setAutoLabel: document.getElementById('set-auto-label'),
    };
    this.AUTO_LABELS = ['Off', 'Random', 'Best'];

    // The run currently shown on the game-over screen, set in showGameOver().
    this.pendingRun = null;
    this.el.lbSubmitBtn.addEventListener('click', () => this.submitRun());
    this.el.lbName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitRun();
    });
    this.el.shopBack.addEventListener('click', () => this.closeShop());

    // Load the board onto the start screen, which is visible on first load.
    this.loadStartLeaderboard();
  }

  // ---------- Leaderboard ----------

  // Render an array of entries into an <ol>. highlightRank (1-based) tints the
  // player's own row. Pass null entries to show an "unavailable" message.
  renderBoard(listEl, entries, highlightRank = null, limit = 10) {
    if (!listEl) return;
    if (entries === null) {
      listEl.innerHTML = '<li class="lb-empty">Leaderboard unavailable.</li>';
      return;
    }
    if (entries.length === 0) {
      listEl.innerHTML = '<li class="lb-empty">No runs yet — be the first.</li>';
      return;
    }
    let html = '';
    entries.slice(0, limit).forEach((e, i) => {
      const rank = i + 1;
      const me = rank === highlightRank ? ' lb-me' : '';
      const name = String(e.name).replace(/[<>&]/g, '');
      html += `<li class="lb-row${me}">` +
        `<span class="lb-rank">${rank}</span>` +
        `<span class="lb-name">${name}</span>` +
        `<span class="lb-time">${this.fmtTime(e.time)}</span>` +
        `<span class="lb-kills">${e.kills} kills</span>` +
        `</li>`;
    });
    listEl.innerHTML = html;
  }

  async loadStartLeaderboard() {
    this.renderBoard(this.el.lbStartList, await fetchBoard(), null, 10);
  }

  async submitRun() {
    if (!this.pendingRun || this.pendingRun.submitted) return;
    const name = this.el.lbName.value.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) {
      this.el.lbSubmitMsg.textContent = 'Name must be 3-16 letters, numbers or _.';
      return;
    }
    this.el.lbSubmitBtn.disabled = true;
    this.el.lbSubmitMsg.textContent = 'Submitting…';
    const res = await submitScore({ ...this.pendingRun, name });
    if (!res.ok) {
      this.el.lbSubmitBtn.disabled = false;
      this.el.lbSubmitMsg.textContent = res.error;
      return;
    }
    this.pendingRun.submitted = true;
    saveName(name);
    this.el.lbName.disabled = true;
    this.el.lbSubmitMsg.textContent = res.your_rank
      ? `Submitted — you ranked #${res.your_rank}!`
      : 'Submitted!';
    this.renderBoard(this.el.lbGoList, res.leaderboard, res.your_rank, 10);
  }

  // Build the character-select cards on the start screen. `game` is used to
  // read which operators are unlocked; locked ones route to the Armoury.
  buildCharacterSelect(defs, order, onPick, game = null) {
    this.game = game; // kept for shop interactions
    const unlocked = game ? game.save.unlockedChars : order;
    this.el.charSelect.innerHTML = '';
    for (const id of order) {
      const def = defs[id];
      const isLocked = !unlocked.includes(id);
      const card = document.createElement('div');
      card.className = isLocked ? 'char-card locked' : 'char-card';

      // sprite preview drawn from the (placeholder or real) sprite
      const preview = document.createElement('canvas');
      preview.width = 88; preview.height = 88;
      const pctx = preview.getContext('2d');
      const spr = getSprite(def.sprite);
      if (spr) {
        const sz = spriteSize(spr);
        const scale = 72 / sz;
        pctx.translate(44, 44);
        pctx.rotate(-Math.PI / 2); // face up in the preview
        pctx.drawImage(spr, -sz * scale / 2, -sz * scale / 2, sz * scale, sz * scale);
      }

      const info = document.createElement('div');
      info.className = 'char-info';
      info.innerHTML = `
        <div class="char-name">${def.name}</div>
        <div class="char-blurb">${def.blurb}</div>
        <div class="char-weapon">🔫 ${WEAPON_DEFS[def.startWeapon].name} · ${WEAPON_DEFS[def.startWeapon].rof} RPM</div>
        <div class="char-ability">${def.ability.icon} <b>${def.ability.name}</b> — ${def.ability.desc}
          <span class="char-cd">(${Math.round(def.ability.cooldownMs / 1000)}s)</span></div>
      `;

      card.appendChild(preview);
      card.appendChild(info);
      if (isLocked) {
        const cost = OPERATOR_UNLOCKS[id];
        const lock = document.createElement('div');
        lock.className = 'char-lock';
        lock.innerHTML = `🔒 <span>Unlock in Armoury · 🪙 ${cost}</span>`;
        card.appendChild(lock);
        card.addEventListener('click', () => this.openShop(game));
      } else {
        card.addEventListener('click', () => onPick(id));
      }
      this.el.charSelect.appendChild(card);
    }
  }

  showStart() {
    this.el.start.classList.remove('hidden');
    this.hideAbility();
    this.refreshStartMeta();
    this.loadStartLeaderboard(); // refresh after a run so new scores show
  }

  // ---------- Armoury / shop ----------

  refreshStartMeta() {
    if (this.game && this.el.startCoins) this.el.startCoins.textContent = this.game.save.coins;
  }

  openShop(game) {
    this.game = game;
    this.renderShop();
    this.el.start.classList.add('hidden');
    this.el.shopScreen.classList.remove('hidden');
  }

  closeShop() {
    this.el.shopScreen.classList.add('hidden');
    // Rebuild character select so freshly unlocked operators become playable.
    if (this.game) this.buildCharacterSelect(CHARACTER_DEFS, Object.keys(CHARACTER_DEFS), (id) => this.game.start(id), this.game);
    this.el.start.classList.remove('hidden');
    this.refreshStartMeta();
  }

  renderShop() {
    const save = this.game.save;
    this.el.shopCoins.textContent = save.coins;

    // Permanent upgrades.
    this.el.shopUpgrades.innerHTML = '';
    for (const key of Object.keys(META_UPGRADES)) {
      const u = META_UPGRADES[key];
      const lvl = save.upgrades[key] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? null : upgradeCost(key, lvl);
      const afford = !maxed && save.coins >= cost;
      const card = document.createElement('div');
      card.className = 'shop-card';
      card.innerHTML = `
        <div class="shop-icon">${u.icon}</div>
        <div class="shop-name">${u.name}</div>
        <div class="shop-lvl">Lv ${lvl}/${u.max}</div>
        <div class="shop-desc">${u.fmt(lvl + (maxed ? 0 : 1))}</div>
        <button class="lb-btn shop-buy" ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'MAX' : `🪙 ${cost}`}</button>`;
      if (!maxed && afford) {
        card.querySelector('.shop-buy').addEventListener('click', () => {
          save.coins -= cost;
          save.upgrades[key] = lvl + 1;
          writeSave(save);
          this.renderShop();
        });
      }
      this.el.shopUpgrades.appendChild(card);
    }

    // Operator unlocks.
    this.el.shopOperators.innerHTML = '';
    for (const id of Object.keys(OPERATOR_UNLOCKS)) {
      const def = CHARACTER_DEFS[id];
      const owned = save.unlockedChars.includes(id);
      const cost = OPERATOR_UNLOCKS[id];
      const afford = !owned && save.coins >= cost;
      const card = document.createElement('div');
      card.className = 'shop-card';
      card.innerHTML = `
        <div class="shop-name">${def.name}</div>
        <div class="shop-desc">${def.blurb}</div>
        <button class="lb-btn shop-buy" ${owned || !afford ? 'disabled' : ''}>${owned ? 'OWNED' : `🪙 ${cost}`}</button>`;
      if (!owned && afford) {
        card.querySelector('.shop-buy').addEventListener('click', () => {
          save.coins -= cost;
          save.unlockedChars.push(id);
          writeSave(save);
          this.renderShop();
        });
      }
      this.el.shopOperators.appendChild(card);
    }
  }

  showAbility() { this.el.abilityBtn.classList.remove('hidden'); }
  hideAbility() { this.el.abilityBtn.classList.add('hidden'); this.el.strikeBtn.classList.add('hidden'); }

  // Loop power-up button: visible only once a charge is banked.
  updateStrike(player) {
    const p = player;
    if (p.loopPower && p.loopCharges > 0) {
      this.el.strikeBtn.classList.remove('hidden');
      this.el.strikeBtn.classList.toggle('ready', !this._strikeActive);
      this.el.strikeIcon.textContent = p.loopPower.icon;
      this.el.strikeName.textContent = p.loopPower.name;
      this.el.strikeCount.textContent = `×${p.loopCharges}`;
    } else {
      this.el.strikeBtn.classList.add('hidden');
    }
  }

  // Pause overlay — sync the controls to current settings, then show.
  showPause(game) {
    this.el.setVolume.value = game.settings.volume;
    this.el.setShake.checked = game.settings.shake;
    this.el.setAuto.value = game.settings.autoLevel || 0;
    this.el.setAutoLabel.textContent = this.AUTO_LABELS[game.settings.autoLevel || 0];
    this.el.pauseScreen.classList.remove('hidden');
  }
  hidePause() { this.el.pauseScreen.classList.add('hidden'); }

  updateAbility(player) {
    const a = player.ability;
    this.el.abilityIcon.textContent = a.icon;
    this.el.abilityName.textContent = a.name;
    const frac = player.abilityCooldownFrac();
    if (frac >= 1) {
      this.el.abilityBtn.classList.add('ready');
      this.el.abilityCd.style.background = 'transparent';
      this.el.abilityCd.textContent = '';
    } else {
      this.el.abilityBtn.classList.remove('ready');
      const deg = (1 - frac) * 360;
      this.el.abilityCd.style.background =
        `conic-gradient(rgba(0,0,0,0.66) ${deg}deg, transparent 0deg)`;
      this.el.abilityCd.textContent = Math.ceil(player.abilityCdLeft / 1000);
    }
  }

  fmtTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  updateHud(game) {
    const p = game.player;
    this.el.timer.textContent = this.fmtTime(game.elapsed);
    this.el.level.textContent = `Lv ${p.level}`;
    this.el.kills.textContent = `Kills ${p.kills}`;

    this.el.xpFill.style.width = `${(p.xp / p.xpToNext) * 100}%`;
    this.el.xpLabel.textContent = `XP ${p.xp} / ${p.xpToNext}`;

    const hpPct = Math.max(0, p.hp / p.maxHp) * 100;
    this.el.hpFill.style.width = `${hpPct}%`;
    this.el.hpLabel.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`;

    // Weapons + live effective RPM
    let html = '';
    for (const w of p.weapons) {
      const rpm = Math.round(w.effectiveRpm(p));
      const cls = w.reloading ? 'weapon-chip reloading' : 'weapon-chip';
      const status = w.reloading ? 'RELOADING' : `${w.ammo}/${w.maxAmmo(p)}`;
      html += `<div class="${cls}"><b>${w.def.name}</b> <span class="rpm">${rpm} RPM</span> · ${status}</div>`;
    }
    this.el.weaponList.innerHTML = html;

    // Teammates
    const counts = game.team.summary();
    let thtml = '';
    for (const id of Object.keys(counts)) {
      const d = TEAMMATE_DEFS[id];
      thtml += `<div class="team-chip">${d.icon} ${d.name} ×${counts[id]}</div>`;
    }
    this.el.teamList.innerHTML = thtml;
  }

  showLevelUp(cards, onPick) {
    this.el.cardRow.innerHTML = '';
    for (const card of cards) {
      const div = document.createElement('div');
      div.className = 'card';
      div.style.setProperty('--rarity', card.rarity.color);
      div.innerHTML = `
        <div class="rarity-tag">${card.rarity.name}</div>
        <div class="card-icon">${card.icon}</div>
        <div class="card-name">${card.name}</div>
        <div class="card-desc">${card.desc}</div>
        <div class="card-kind">${card.kindLabel}</div>
      `;
      div.addEventListener('click', () => onPick(card));
      this.el.cardRow.appendChild(div);
    }
    this.el.levelup.classList.remove('hidden');
  }

  hideLevelUp() { this.el.levelup.classList.add('hidden'); }

  showGameOver(game) {
    const p = game.player;
    this.el.summary.innerHTML = `
      <div class="go-killedby">Killed by <b>${p.lastHitBy}</b></div>
      <div>Survived <b>${this.fmtTime(game.elapsed)}</b></div>
      <div>Reached <b>${STAGES[game.stage % STAGES.length].name}</b> · Loop <b>${game.loop + 1}</b></div>
      <div>Level reached <b>${p.level}</b></div>
      <div>Enemies eliminated <b>${p.kills}</b></div>
      <div>Firearms fielded <b>${p.weapons.length}</b></div>
      <div>Soldiers recruited <b>${game.totalRecruited}</b></div>
      <div class="go-coins">🪙 Salvage earned <b>+${game.coinsEarned}</b> &nbsp;·&nbsp; total <b>${game.save.coins}</b></div>
    `;

    // Prepare the leaderboard submission for this run.
    this.pendingRun = {
      time: Math.floor(game.elapsed),
      kills: p.kills,
      level: p.level,
      submitted: false,
    };
    this.el.lbName.value = getSavedName();
    this.el.lbName.disabled = false;
    this.el.lbSubmitBtn.disabled = false;
    this.el.lbSubmitMsg.textContent = '';
    this.renderBoard(this.el.lbGoList, null); // placeholder until the fetch lands
    fetchBoard().then((b) => {
      // Don't clobber the post-submit board if the player already submitted.
      if (this.pendingRun && !this.pendingRun.submitted) {
        this.renderBoard(this.el.lbGoList, b, null, 10);
      }
    });

    this.el.gameover.classList.remove('hidden');
  }
  hideGameOver() { this.el.gameover.classList.add('hidden'); }

  hideStart() { this.el.start.classList.add('hidden'); }
}
