/**
 * Efectos de sonido sintetizados con WebAudio (sin archivos externos).
 * Deliberadamente muy sutiles y con volumen bajo; se pueden silenciar y la
 * preferencia queda guardada.
 */

const STORAGE_KEY = 'mph.sound';

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = this._loadPreference();
    this.volume = 0.14;
  }

  _loadPreference() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  }

  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* modo privado */ }
    if (on) this.resume();
  }

  /** Debe llamarse desde un gesto del usuario (política de autoplay). */
  resume() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }

  _blip(freq, duration, type = 'sine', gain = 1, detune = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + detune), t0 + duration);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env); env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Cambio de gesto: intervalo ascendente según el número de dedos. */
  modeChange(fingers = 0) {
    const scale = [392, 466, 523, 622, 698, 784];
    this._blip(scale[fingers % scale.length], 0.16, 'triangle', 0.5);
    this._blip(scale[fingers % scale.length] * 2, 0.1, 'sine', 0.18);
  }

  computed() { this._blip(880, 0.09, 'sine', 0.3, 160); }
  cameraOn() { this._blip(330, 0.22, 'triangle', 0.35, 200); }
  functionSet() { this._blip(523, 0.14, 'triangle', 0.4); this._blip(784, 0.16, 'sine', 0.22); }
  error() { this._blip(180, 0.22, 'sawtooth', 0.22, -60); }
}
