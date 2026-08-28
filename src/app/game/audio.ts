/** Tiny Web Audio synth: no sound files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;

  /** Must be called from a user gesture (the Play click). */
  init(): void {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { this.ctx = null; }
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, slideTo: number | null = null, when = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime + when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + when + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.05);
  }

  points(): void { this.tone(660, 0.12, 'square', 0.08); this.tone(990, 0.18, 'square', 0.08, null, 0.1); }
  superPrize(): void { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, null, i * 0.09)); }
  bark(): void { this.tone(420, 0.09, 'sawtooth', 0.12, 250); this.tone(380, 0.1, 'sawtooth', 0.1, 220, 0.12); }
  no(): void { this.tone(160, 0.35, 'sawtooth', 0.12, 90); }
  slip(): void { this.tone(900, 0.5, 'sine', 0.15, 120); }
  chew(): void { this.tone(140 + Math.random() * 60, 0.06, 'square', 0.05); }
  pee(): void { this.tone(1200, 0.15, 'sine', 0.03, 900); }
  grab(): void { this.tone(300, 0.08, 'triangle', 0.1, 500); }
}
