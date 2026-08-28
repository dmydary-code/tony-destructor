import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { GameService } from '../game.service';

/** In-game overlay: score, bladder meter, prompts, log, speech bubbles, toast. */
@Component({
  selector: 'app-hud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hud">
      <div class="panel top-left">
        <div class="label">MISCHIEF SCORE</div>
        <div class="score" #scoreEl>{{ game.score() }}</div>
        <div class="label">BLADDER
          @if (game.bladder() >= 1) { <span>— FULL, press Q</span> }
        </div>
        <div class="meter">
          <div class="meter-fill" [class.full]="game.bladder() >= 1" [style.width.%]="game.bladder() * 100"></div>
        </div>
      </div>

      <div class="panel top-right">
        <div class="seen" [class.on]="game.seen()">👁 SEEN!</div>
        @for (h of game.status(); track h.name) {
          <div><b>{{ h.name }}</b>: {{ h.doing }}</div>
        }
      </div>

      @if (game.prompt(); as prompt) {
        <div class="prompt">{{ prompt }}</div>
      }

      @if (game.progress(); as p) {
        <div class="progress">
          <div class="progress-fill" [style.width.%]="p.frac * 100"></div>
          <div class="progress-label">{{ p.label }}</div>
        </div>
      }

      <div class="log">
        @for (line of game.logLines(); track line.id) {
          <div class="line" [class]="line.cls" [class.fade]="line.fading">{{ line.text }}</div>
        }
      </div>

      @for (b of game.bubbles(); track $index) {
        <div class="bubble" [style.left.px]="b.x" [style.top.px]="b.y">{{ b.text }}</div>
      }

      @if (game.toastState(); as t) {
        <div class="toast" #toastEl [class.bad]="t.cls === 'bad'">{{ t.text }}</div>
      }
    </div>
  `,
  styleUrl: './hud.component.css',
})
export class HudComponent {
  protected readonly game = inject(GameService);
  private readonly scoreEl = viewChild<ElementRef<HTMLElement>>('scoreEl');
  private readonly toastEl = viewChild<ElementRef<HTMLElement>>('toastEl');

  constructor() {
    // Restart the CSS pop/toast animations whenever the value changes.
    effect(() => {
      this.game.score();
      this.replay(this.scoreEl()?.nativeElement, 'pop');
    });
    effect(() => {
      this.game.toastState();
      this.replay(this.toastEl()?.nativeElement, 'show');
    });
  }

  private replay(el: HTMLElement | undefined, cls: string): void {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;   // reflow restarts the animation
    el.classList.add(cls);
  }
}
