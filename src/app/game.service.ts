import { Injectable, signal } from '@angular/core';
import { GameEngine } from './game/engine';
import { Bubble, GameUi, HumanStatus, LogClass } from './game/types';

export interface LogLine {
  id: number;
  text: string;
  cls: LogClass;
  fading: boolean;
}

export interface Toast {
  key: number;
  text: string;
  cls: string;
}

export interface Progress {
  frac: number;
  label: string;
}

/**
 * Owns the engine and mirrors its UI callbacks into signals.
 * The HUD components render exclusively from these signals (zoneless CD).
 */
@Injectable({ providedIn: 'root' })
export class GameService implements GameUi {
  readonly score = signal(0);
  readonly bladder = signal(0);
  readonly seen = signal(false);
  readonly prompt = signal('');
  readonly progress = signal<Progress | null>(null);
  readonly logLines = signal<LogLine[]>([]);
  readonly toastState = signal<Toast | null>(null);
  readonly status = signal<HumanStatus[]>([]);
  readonly bubbles = signal<Bubble[]>([]);
  readonly playing = signal(false);

  private engine: GameEngine | null = null;
  private logId = 0;
  private toastKey = 0;

  init(canvas: HTMLCanvasElement): void {
    this.engine?.dispose();
    this.engine = new GameEngine(canvas, this);
  }

  play(): void {
    this.engine?.play();
    this.playing.set(true);
  }

  destroy(): void {
    this.engine?.dispose();
    this.engine = null;
  }

  // ------------------------------------------------------------ GameUi
  setScore(score: number): void { this.score.set(score); }
  setBladder(value: number): void { this.bladder.set(value); }
  setSeen(on: boolean): void { this.seen.set(on); }
  setPrompt(text: string): void { this.prompt.set(text); }

  setProgress(frac: number | null, label = ''): void {
    this.progress.set(frac == null ? null : { frac, label });
  }

  log(text: string, cls: LogClass = ''): void {
    const line: LogLine = { id: this.logId++, text, cls, fading: false };
    this.logLines.update((lines) => [...lines, line].slice(-4));
    setTimeout(() => this.logLines.update((lines) => lines.map((l) => l.id === line.id ? { ...l, fading: true } : l)), 5000);
    setTimeout(() => this.logLines.update((lines) => lines.filter((l) => l.id !== line.id)), 6500);
  }

  toast(text: string, cls = ''): void {
    this.toastState.set({ key: this.toastKey++, text, cls });
  }

  setStatus(humans: HumanStatus[]): void { this.status.set(humans); }
  setBubbles(list: Bubble[]): void { this.bubbles.set(list); }
}
