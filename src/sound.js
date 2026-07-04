// ── Sound effects ─────────────────────────────────────────────────────────────
// All sounds are synthesized with the Web Audio API — no audio files needed.
// Browsers block audio until a user gesture, so main.js calls Sfx.unlock()
// on the first keydown/pointerdown.

const Sfx = {
  enabled: true,
  _ctx: null,

  _ac() {
    if (!this.enabled) return null;
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ctx = AC ? new AC() : null;
    }
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  },

  unlock() { this._ac(); },

  // One enveloped oscillator: frequency slides f0 → f1 over dur seconds.
  _tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
    const ac = this._ac();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  // ── Gathering / items ──
  chop()   { this._tone(180, 90, 0.09, 'square', 0.18); },
  stone()  { this._tone(120, 60, 0.12, 'square', 0.2); this._tone(700, 300, 0.05, 'square', 0.06); },
  gather() { this._tone(500, 800, 0.08, 'triangle', 0.15); },
  eat()    { this._tone(300, 500, 0.07, 'triangle', 0.18); this._tone(250, 420, 0.07, 'triangle', 0.15, 0.09); },
  craft()  { this._tone(440, 660, 0.09, 'square', 0.12); this._tone(660, 880, 0.12, 'square', 0.12, 0.09); },
  place()  { this._tone(200, 140, 0.1, 'square', 0.2); },

  // ── Combat ──
  swing()  { this._tone(320, 160, 0.06, 'sawtooth', 0.08); },
  hit()    { this._tone(220, 110, 0.08, 'sawtooth', 0.18); },
  hurt()   { this._tone(160, 70, 0.25, 'sawtooth', 0.22); },
  arrow()  { this._tone(900, 200, 0.15, 'sawtooth', 0.1); },
  starve() { this._tone(200, 100, 0.2, 'sine', 0.15); },

  // ── Events ──
  rescue() { [523, 659, 784, 1047].forEach((f, i) => this._tone(f, f, 0.12, 'square', 0.12, i * 0.1)); },
  night()  { this._tone(110, 55, 1.2, 'sine', 0.25); this._tone(65, 55, 1.2, 'sine', 0.2, 0.1); },
  day()    { [392, 523, 659].forEach((f, i) => this._tone(f, f, 0.25, 'sine', 0.12, i * 0.12)); },
  boss()   { this._tone(80, 40, 1.5, 'sawtooth', 0.3); this._tone(85, 42, 1.5, 'sawtooth', 0.25, 0.05); },
};
