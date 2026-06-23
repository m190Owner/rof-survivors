// Procedural audio via the Web Audio API. No binary assets — every sound is
// synthesized, so the game ships with sound out of the box.
//
// Gunshots are filtered-noise "cracks" + a low body thump, tuned per weapon
// class so a pistol, rifle, LMG and minigun read differently. High-frequency
// events (shots, hits, deaths, XP) are throttled so that firing at 1200–3000
// RPM doesn't overload the audio graph or turn into a wall of noise.
//
// Background music is a sparse, generative minor-key bed (drone + slow bass +
// soft percussion) kept deliberately quiet.

const SHOT_PARAMS = {
  pistol:  { freq: 1800, decay: 0.09, gain: 0.45, body: 180, bodyGain: 0.35, gap: 0.05 },
  smg:     { freq: 2200, decay: 0.07, gain: 0.40, body: 160, bodyGain: 0.30, gap: 0.045 },
  rifle:   { freq: 1400, decay: 0.14, gain: 0.55, body: 110, bodyGain: 0.45, gap: 0.05 },
  lmg:     { freq: 1150, decay: 0.16, gain: 0.60, body: 90,  bodyGain: 0.50, gap: 0.05 },
  minigun: { freq: 950,  decay: 0.05, gain: 0.42, body: 80,  bodyGain: 0.42, gap: 0.028 },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.unavailable = false;
    this.lastShot = 0;
    this.lastHit = 0;
    this.lastXp = 0;
    this.lastDeath = 0;
    this.lastHurt = 0;
    this._musicTimer = null;
    this._beat = 0;
  }

  // Must be called from a user gesture (the deploy click) to satisfy autoplay.
  init() {
    if (this.unavailable) return;
    if (this.ctx) { this.resume(); this._restoreMusic(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.unavailable = true; return; }
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    this.music = this.ctx.createGain();
    this.music.gain.value = 0.0;
    this.music.connect(this.master);

    this.noise = this._makeNoise(1.0);
    this.startMusic();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  // Bring the music bed back to its normal low level (e.g. after a game over
  // ducked it on the previous run).
  _restoreMusic() {
    if (!this.music) return;
    const t = this.t;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(Math.max(0.0001, this.music.gain.value), t);
    this.music.gain.exponentialRampToValueAtTime(0.12, t + 1.0);
  }
  get t() { return this.ctx.currentTime; }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.baseVolume ?? 0.6;
  }
  toggleMute() { this.setMuted(this.enabled); return !this.enabled; }

  // Master volume 0..1 (mapped to a sane ceiling). Persists via settings.
  setMasterVolume(v) {
    this.baseVolume = Math.max(0, Math.min(1, v)) * 0.9;
    if (this.master && this.enabled) this.master.gain.value = this.baseVolume;
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseBurst(dest, { type = 'bandpass', freq, q = 0.8, gain, decay, t0 }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + decay + 0.02);
    return f;
  }

  _tone(dest, { type = 'sine', f0, f1, gain, decay, t0 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + decay + 0.02);
  }

  // ---------------- SFX ----------------
  shot(cls = 'rifle') {
    if (!this._ok()) return;
    const p = SHOT_PARAMS[cls] || SHOT_PARAMS.rifle;
    const t = this.t;
    if (t - this.lastShot < p.gap) return; // global throttle
    this.lastShot = t;
    const detune = 0.92 + Math.random() * 0.16;
    // crack
    this._noiseBurst(this.sfx, { freq: p.freq * detune, q: 0.7, gain: p.gain, decay: p.decay, t0: t });
    // high transient click
    this._noiseBurst(this.sfx, { type: 'highpass', freq: 4000, gain: p.gain * 0.5, decay: 0.012, t0: t });
    // body thump
    this._tone(this.sfx, { f0: p.body * detune, f1: p.body * 0.5, gain: p.bodyGain, decay: 0.08, t0: t });
  }

  reload() {
    if (!this._ok()) return;
    const t = this.t;
    // two mechanical clicks
    this._noiseBurst(this.sfx, { type: 'bandpass', freq: 2600, q: 3, gain: 0.18, decay: 0.03, t0: t });
    this._noiseBurst(this.sfx, { type: 'bandpass', freq: 1800, q: 3, gain: 0.2, decay: 0.04, t0: t + 0.12 });
  }

  explosion() {
    if (!this._ok()) return;
    const t = this.t;
    this._noiseBurst(this.sfx, { type: 'lowpass', freq: 700, q: 0.6, gain: 0.8, decay: 0.55, t0: t });
    this._tone(this.sfx, { type: 'sine', f0: 90, f1: 30, gain: 0.7, decay: 0.5, t0: t });
  }

  hit() {
    if (!this._ok()) return;
    const t = this.t;
    if (t - this.lastHit < 0.03) return;
    this.lastHit = t;
    this._noiseBurst(this.sfx, { type: 'bandpass', freq: 3200, q: 1.5, gain: 0.1, decay: 0.03, t0: t });
  }

  enemyDeath() {
    if (!this._ok()) return;
    const t = this.t;
    if (t - this.lastDeath < 0.045) return;
    this.lastDeath = t;
    this._noiseBurst(this.sfx, { type: 'lowpass', freq: 500, q: 0.7, gain: 0.18, decay: 0.12, t0: t });
  }

  pickupXp() {
    if (!this._ok()) return;
    const t = this.t;
    if (t - this.lastXp < 0.05) return; // XP auto-collects → keep this soft + sparse
    this.lastXp = t;
    this._tone(this.sfx, { type: 'triangle', f0: 740, f1: 1180, gain: 0.05, decay: 0.06, t0: t });
  }

  pickupHealth() {
    if (!this._ok()) return;
    const t = this.t;
    this._tone(this.sfx, { type: 'sine', f0: 523, gain: 0.18, decay: 0.12, t0: t });
    this._tone(this.sfx, { type: 'sine', f0: 784, gain: 0.18, decay: 0.16, t0: t + 0.09 });
  }

  levelUp() {
    if (!this._ok()) return;
    const t = this.t;
    [523, 659, 784, 1047].forEach((f, i) =>
      this._tone(this.sfx, { type: 'triangle', f0: f, gain: 0.22, decay: 0.22, t0: t + i * 0.08 }));
  }

  ability() {
    if (!this._ok()) return;
    const t = this.t;
    this._noiseBurst(this.sfx, { type: 'lowpass', freq: 1800, q: 0.7, gain: 0.3, decay: 0.3, t0: t });
    this._tone(this.sfx, { type: 'sawtooth', f0: 180, f1: 720, gain: 0.22, decay: 0.3, t0: t });
  }

  playerHurt() {
    if (!this._ok()) return;
    const t = this.t;
    if (t - this.lastHurt < 0.15) return;
    this.lastHurt = t;
    this._tone(this.sfx, { type: 'square', f0: 150, f1: 80, gain: 0.18, decay: 0.12, t0: t });
  }

  uiClick() {
    if (!this._ok()) return;
    this._noiseBurst(this.sfx, { type: 'bandpass', freq: 2000, q: 2, gain: 0.12, decay: 0.03, t0: this.t });
  }

  gameOver() {
    if (!this._ok(true)) return;
    const t = this.t;
    [392, 330, 262, 196].forEach((f, i) =>
      this._tone(this.sfx, { type: 'triangle', f0: f, gain: 0.25, decay: 0.5, t0: t + i * 0.18 }));
    // duck the music for a moment
    if (this.music) {
      this.music.gain.cancelScheduledValues(t);
      this.music.gain.setValueAtTime(this.music.gain.value, t);
      this.music.gain.exponentialRampToValueAtTime(0.03, t + 0.6);
    }
  }

  _ok(ignoreEnabled = false) {
    return this.ctx && (ignoreEnabled || this.enabled);
  }

  // ---------------- Music (generative, quiet) ----------------
  startMusic() {
    if (!this.ctx || this._droneStarted) return;
    this._droneStarted = true;
    const t = this.t;

    // Continuous low drone (root + fifth), very quiet, slowly wavering.
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.22;
    droneGain.connect(this.music);
    for (const f of [55, 82.4]) { // A1 + E2
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 320;
      o.connect(lp); lp.connect(droneGain);
      o.start(t);
    }

    // Fade the music bed in to a low target volume.
    this.music.gain.setValueAtTime(0.0001, t);
    this.music.gain.exponentialRampToValueAtTime(0.12, t + 3);

    // Step sequencer (eighth notes).
    this.tempo = 92;
    this._beat = 0;
    this._nextNote = t + 0.2;
    this._schedule();
  }

  _schedule() {
    if (!this.ctx) return;
    const lookahead = 0.25;
    const stepDur = 60 / this.tempo / 2;
    // A minor pentatonic bassline (Hz), 16 steps; null = rest.
    const A = 55, C = 65.41, D = 73.42, E = 82.41, G = 98;
    const BASS = [A, null, A, null, C, null, A, null, E, null, D, null, C, null, G, null];

    while (this._nextNote < this.t + lookahead) {
      const step = this._beat % 16;
      const time = this._nextNote;
      const n = BASS[step];
      if (n) {
        this._tone(this.music, { type: 'triangle', f0: n, gain: 0.5, decay: stepDur * 1.4, t0: time });
      }
      // soft kick on quarter notes
      if (step % 4 === 0) {
        this._tone(this.music, { type: 'sine', f0: 110, f1: 45, gain: 0.45, decay: 0.16, t0: time });
      }
      // soft hat on offbeats
      if (step % 2 === 1) {
        this._noiseBurst(this.music, { type: 'highpass', freq: 7000, gain: 0.06, decay: 0.03, t0: time });
      }
      this._beat++;
      this._nextNote += stepDur;
    }
    this._musicTimer = setTimeout(() => this._schedule(), 50);
  }
}

export const audio = new AudioManager();
