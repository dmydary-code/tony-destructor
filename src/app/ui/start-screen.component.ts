import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GameService } from '../game.service';

@Component({
  selector: 'app-start-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay">
      <div class="card">
        <h1>TONY<span>Copper Menace</span></h1>
        <p class="tag">A small copper dachshund with big ambitions. Carl and Mia think this is their flat. Prove them wrong.</p>
        <div class="cols">
          <div>
            <h3>Controls</h3>
            <ul>
              <li><b>W A S D</b> — run around</li>
              <li><b>Mouse drag</b> — orbit camera · <b>wheel</b> — zoom</li>
              <li><b>E</b> — grab item / steal slipper (hold) / hide / drop</li>
              <li><b>F</b> (hold) — chew what you carry</li>
              <li><b>Q</b> — pee, when the bladder is full</li>
            </ul>
          </div>
          <div>
            <h3>How to score</h3>
            <ul>
              <li>Sneak up <b>behind</b> a human, steal a slipper and hide it under the sofa or the bed.</li>
              <li>Grab things that are lying around and chew them to pieces, stage by stage.</li>
              <li>When your bladder is full, pee <b>as close to a human as you dare</b> without being seen. If they step in it — <b>SUPER PRIZE</b>.</li>
              <li>Get seen doing something naughty and they'll chase you. Don't get caught.</li>
            </ul>
          </div>
        </div>
        <button type="button" (click)="game.play()">Click to play</button>
        <p class="tech">Angular + TypeScript + Three.js: hand-written GLSL (shell fur, chewable vertex displacement, puddle with planar reflection), GTAO + bloom post-processing, PCF shadow maps, particle buffers.
          Dog model: <a href="https://sketchfab.com/3d-models/dashshund-dog-cb0abb276cc247f095c0c527db987276" target="_blank" rel="noopener">“Dashshund Dog”</a> by spooneystone, CC-BY-4.0.</p>
      </div>
    </div>
  `,
  styleUrl: './start-screen.component.css',
})
export class StartScreenComponent {
  protected readonly game = inject(GameService);
}
