// Movement input: WASD / arrow keys on desktop, virtual joystick on touch.
// Exposes a normalized move vector (mx, my) in [-1, 1].

export class Input {
  constructor(rootEl) {
    this.keys = new Set();
    this.mx = 0;
    this.my = 0;
    this.abilityRequested = false; // one-shot, consumed by the game each frame
    this.strikeRequested = false;  // loop power-up (E), consumed each frame

    this.joyEl = document.getElementById('joystick');
    this.knobEl = document.getElementById('joystick-knob');
    this.touchId = null;
    this.joyOrigin = { x: 0, y: 0 };

    // True while the player is typing in a text field (e.g. the leaderboard
    // name box on the game-over screen). When so, movement keys must reach the
    // input — not get captured and preventDefault'd as WASD/ability commands.
    const typingInField = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    };

    window.addEventListener('keydown', (e) => {
      if (typingInField(e)) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
      if (k === ' ' || k === 'spacebar' || k === 'q') {
        this.abilityRequested = true;
        e.preventDefault();
      }
      if (k === 'e') {
        this.strikeRequested = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    // Touch joystick: appears wherever the first touch lands.
    const start = (e) => {
      if (this.touchId !== null) return;
      const t = e.changedTouches[0];
      this.touchId = t.identifier;
      this.joyOrigin = { x: t.clientX, y: t.clientY };
      this.joyEl.style.left = `${t.clientX - 60}px`;
      this.joyEl.style.top = `${t.clientY - 60}px`;
      this.joyEl.classList.remove('hidden');
      this.updateKnob(0, 0);
    };
    const move = (e) => {
      if (this.touchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.touchId) continue;
        let dx = t.clientX - this.joyOrigin.x;
        let dy = t.clientY - this.joyOrigin.y;
        const max = 50;
        const len = Math.hypot(dx, dy) || 1;
        const clamped = Math.min(len, max);
        dx = dx / len * clamped;
        dy = dy / len * clamped;
        this.updateKnob(dx, dy);
        this.touchVec = { x: dx / max, y: dy / max };
        e.preventDefault();
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchId) {
          this.touchId = null;
          this.touchVec = null;
          this.joyEl.classList.add('hidden');
        }
      }
    };
    rootEl.addEventListener('touchstart', start, { passive: false });
    rootEl.addEventListener('touchmove', move, { passive: false });
    rootEl.addEventListener('touchend', end);
    rootEl.addEventListener('touchcancel', end);
  }

  updateKnob(dx, dy) {
    this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // Recompute the move vector. Call once per frame.
  update() {
    if (this.touchVec) {
      this.mx = this.touchVec.x;
      this.my = this.touchVec.y;
      return;
    }
    let x = 0, y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    const len = Math.hypot(x, y);
    if (len > 0) { x /= len; y /= len; }
    this.mx = x;
    this.my = y;
  }
}
