import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { GameService } from './game.service';
import { HudComponent } from './ui/hud.component';
import { StartScreenComponent } from './ui/start-screen.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HudComponent, StartScreenComponent],
  template: `
    <canvas #canvas></canvas>
    <app-hud />
    @if (!game.playing()) {
      <app-start-screen />
    }
  `,
  styles: `
    :host { position: fixed; inset: 0; display: block; }
    canvas { display: block; width: 100%; height: 100%; cursor: grab; }
  `,
})
export class App implements AfterViewInit, OnDestroy {
  protected readonly game = inject(GameService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  ngAfterViewInit(): void {
    this.game.init(this.canvas().nativeElement);
  }

  ngOnDestroy(): void {
    this.game.destroy();
  }
}
