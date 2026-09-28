import * as THREE from 'three';
import { World, APT } from './world';
import { Tony, TONY_RADIUS } from './tony';
import { Human, Slipper } from './human';
import { ChewItem, createItems, PlanarReflection, Puddle, Sparkles, Dust } from './items';
import { Sfx } from './audio';
import { Bubble, GameUi, InputState, LightUniforms } from './types';
import { PostFx } from './postfx';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const KEY_MAP: Record<string, keyof InputState> = {
  KeyW: 'w', ArrowUp: 'w', KeyA: 'a', ArrowLeft: 'a',
  KeyS: 's', ArrowDown: 's', KeyD: 'd', ArrowRight: 'd',
  KeyE: 'e', KeyF: 'f', KeyQ: 'q',
};

const INTERACTION_RANGE = { steal: 0.95, item: 0.8, hide: 1.0 } as const;

/**
 * The whole game, framework-free. The Angular layer owns the canvas and the HUD;
 * the engine talks back through the GameUi interface only.
 */
export class GameEngine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly world: World;
  readonly tony: Tony;
  readonly humans: Human[];
  readonly items: ChewItem[];
  readonly puddles: Puddle[] = [];
  readonly sfx = new Sfx();

  playing = false;
  score = 0;
  bladder = 0.55;
  time = 0;
  /** Test hook: multiplies dt (slow machines / headless runs). */
  dtScale = 1;

  private readonly reflection = new PlanarReflection(768);
  private readonly postfx: PostFx;
  private readonly sparkles: Sparkles;
  private readonly dust: Dust;
  private readonly input: InputState = { w: false, a: false, s: false, d: false, e: false, f: false, q: false, ePressed: false, qPressed: false };
  private readonly orbit = { yaw: 0, pitch: 0.3, dist: 3.4 };
  private bustCooldown = 0;
  private statusTick = 0;
  private last = performance.now();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ui: GameUi) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;  // updated once per frame, in the reflection pass
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(0x1b1713);
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.05, 60);
    this.camera.layers.enable(1);

    // Image-based lighting: a neutral "room" environment gives every PBR material
    // soft reflections and fills the shadows with believable bounce light.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.world = new World(this.scene);
    this.postfx = new PostFx(this.renderer, this.scene, this.camera);

    const lightUniforms: LightUniforms = {
      uSunDir: { value: this.world.sun.position.clone().normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d6).multiplyScalar(1.4) },
      uLampPos: { value: this.world.lampPositions },
      uLampColor: { value: new THREE.Color(0xffe2b8).multiplyScalar(0.9) },
      uSkyColor: { value: new THREE.Color(0xdfe9ff).multiplyScalar(0.5) },
      uGroundColor: { value: new THREE.Color(0x5a4634).multiplyScalar(0.5) },
    };

    this.tony = new Tony(this.scene, lightUniforms, this.world);
    this.humans = [
      new Human(this.scene, { name: 'Carl', skin: 0xf1c9a5, hair: 0xe9d38a, hairStyle: 'short', top: 0x3b6ea5, pants: 0x2f3a4f, slipper: 0x4a4a4a }, this.world),
      new Human(this.scene, { name: 'Mia', skin: 0xf4dcbb, hair: 0x14100f, hairStyle: 'bob', top: 0x7a9e6b, pants: 0x3a2f2f, slipper: 0xe58fb0, sleeves: true }, this.world),
    ];
    this.humans[0].pos.set(-2.0, 0, -1.8); this.humans[0].heading = Math.PI;
    this.humans[1].pos.set(3.0, 0, 1.0); this.humans[1].heading = -Math.PI / 2;

    this.items = createItems(this.scene, this.world, lightUniforms);
    this.sparkles = new Sparkles(this.scene);
    this.dust = new Dust(this.scene);

    this.bindInput();
    this.ui.setBladder(this.bladder);
    this.ui.setStatus(this.humans.map((h) => ({ name: h.name, doing: h.doing })));
    this.renderer.setAnimationLoop((now) => this.frame(now));

    // Debug/testing hook (used by the headless smoke tests).
    (window as unknown as Record<string, unknown>)['__tony'] = this;
  }

  // ---------------------------------------------------------------- lifecycle
  play(): void {
    this.sfx.init();
    this.playing = true;
    this.ui.log('Carl and Mia are home. Time for mischief.');
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.postfx.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    for (const d of this.disposers) d();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    const canvas = this.canvas;
    const onKeyDown = (ev: KeyboardEvent): void => {
      const k = KEY_MAP[ev.code];
      if (!k) return;
      if (!this.input[k]) {
        if (k === 'e') this.input.ePressed = true;
        if (k === 'q') this.input.qPressed = true;
      }
      this.input[k] = true;
      ev.preventDefault();
    };
    const onKeyUp = (ev: KeyboardEvent): void => {
      const k = KEY_MAP[ev.code];
      if (k) this.input[k] = false;
    };
    const onPointerDown = (ev: PointerEvent): void => {
      this.dragging = true; this.lastX = ev.clientX; this.lastY = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
    };
    const onPointerUp = (): void => { this.dragging = false; };
    const onPointerMove = (ev: PointerEvent): void => {
      if (!this.dragging) return;
      this.orbit.yaw -= (ev.clientX - this.lastX) * 0.006;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + (ev.clientY - this.lastY) * 0.005, 0.05, 1.25);
      this.lastX = ev.clientX; this.lastY = ev.clientY;
    };
    const onWheel = (ev: WheelEvent): void => {
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist + ev.deltaY * 0.003, 1.6, 7);
      ev.preventDefault();
    };
    const onResize = (): void => this.resize(window.innerWidth, window.innerHeight);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    });
  }

  // ---------------------------------------------------------------- helpers
  private addScore(n: number, text?: string, cls: 'good' | 'bad' | 'super' = 'good'): void {
    this.score = Math.max(0, this.score + n);
    this.ui.setScore(this.score);
    if (text) this.ui.log(`${text} ${n >= 0 ? '+' : ''}${n}`, cls);
    if (n > 0) { this.tony.happy = 1; this.sfx.points(); }
  }

  private readonly tmpV = new THREE.Vector3();
  private tonyEyePos(): THREE.Vector3 {
    return this.tmpV.set(this.tony.pos.x, 0.3, this.tony.pos.z);
  }

  private static dist2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // ---------------------------------------------------------------- slippers
  private stealComplete(slipper: Slipper): void {
    slipper.attached = false; slipper.state = 'carried';
    slipper.mesh.removeFromParent();
    this.tony.attachToMouth(slipper.mesh);
    slipper.mesh.rotation.set(0.3, Math.PI / 2, 0);
    this.tony.carrying = slipper;
    slipper.noticeTimer = 2.5;
    this.ui.toast('GOT IT!');
    this.ui.log(`Stole ${slipper.name}. Hide it before ${slipper.owner.name} notices!`);
    this.sfx.bark();
  }

  private reattachSlipper(slipper: Slipper): void {
    slipper.mesh.removeFromParent();
    slipper.foot.add(slipper.mesh);
    slipper.mesh.position.set(0, 0.02, 0.05);
    slipper.mesh.rotation.set(0, 0, 0);
    slipper.attached = true; slipper.state = 'worn'; slipper.timer = 0;
  }

  private hideSlipper(slipper: Slipper, spot: { x: number; z: number; name: string }): void {
    slipper.mesh.removeFromParent();
    this.scene.add(slipper.mesh);
    slipper.mesh.position.set(spot.x + (Math.random() - 0.5) * 0.4, 0.02, spot.z + (Math.random() - 0.5) * 0.2);
    slipper.mesh.rotation.set(0, Math.random() * 6, 0);
    slipper.state = 'hidden'; slipper.timer = 45;
    this.tony.carrying = null;
    this.addScore(150, `Hid ${slipper.name} ${spot.name}!`);
    this.sparkles.burst(new THREE.Vector3(spot.x, 0.3, spot.z), 40, 0x7ee787);
    const owner = slipper.owner;
    if (owner.state === 'chase') {
      owner.stopChase('searching for a slipper');
      owner.speak('Where did it go?!');
    }
  }

  private dropCarried(): void {
    const c = this.tony.carrying;
    if (!c) return;
    this.tony.carrying = null;
    const px = this.tony.pos.x + Math.sin(this.tony.heading) * 0.35;
    const pz = this.tony.pos.z + Math.cos(this.tony.heading) * 0.35;
    if (c.isSlipper) {
      c.mesh.removeFromParent();
      this.scene.add(c.mesh);
      c.mesh.position.set(px, 0.02, pz);
      c.mesh.rotation.set(0, this.tony.heading, 0);
      c.state = 'dropped';
    } else {
      c.holder.removeFromParent();
      this.scene.add(c.holder);
      c.holder.position.set(px, 0.02, pz);
      c.holder.rotation.set(0, this.tony.heading, 0);
      c.state = 'placed';
      c.onFurniture = false;
    }
  }

  private grabItem(item: ChewItem): void {
    item.holder.removeFromParent();
    this.tony.attachToMouth(item.holder);
    item.state = 'carried';
    this.tony.carrying = item;
    this.sfx.grab();
    if (item.onFurniture) this.addScore(10, `Snatched the ${item.name}`);
    else this.ui.log(`Picked up the ${item.name}.`);
  }

  private destroyItem(item: ChewItem): void {
    item.holder.removeFromParent();
    item.state = 'gone';
    item.respawn = 40 + Math.random() * 20;
    this.tony.carrying = null;
    this.tony.busy = null;
    this.addScore(120, `Destroyed the ${item.name}!`);
    this.ui.toast('DESTROYED!');
    this.sparkles.burst(new THREE.Vector3(this.tony.pos.x, 0.4, this.tony.pos.z), 60, 0xffd36e, 2.2);
  }

  // ---------------------------------------------------------------- busted / caught
  private bust(human: Human): void {
    if (this.bustCooldown > 0) return;
    this.bustCooldown = 2.5;
    human.speak('TONY! NO!!', 2.5);
    this.sfx.no();
    this.ui.toast('BUSTED!', 'bad');
    if (this.tony.busy) {
      if (this.tony.busy.type === 'pee') {
        this.tony.busy.puddle.discovered = true;
        this.tony.busy.puddle.cleanTimer = 6;
        this.bladder = 0.3;
      }
      this.tony.busy = null;
      this.ui.setProgress(null);
    }
    this.addScore(-40, `${human.name} caught you red-pawed`, 'bad');
    human.startChase(5.5);
  }

  private readonly onCaught = (human: Human): void => {
    human.speak('Bad dog!', 2);
    this.sfx.no();
    this.tony.scared = 2.5;
    this.tony.busy = null;
    this.ui.setProgress(null);
    const c = this.tony.carrying;
    if (c) {
      this.tony.carrying = null;
      if (c.isSlipper) {
        this.reattachSlipper(c);
        this.ui.log(`${human.name} took the slipper back.`, 'bad');
      } else {
        c.holder.removeFromParent();
        this.scene.add(c.holder);
        c.place();
        this.ui.log(`${human.name} confiscated the ${c.name}.`, 'bad');
      }
    }
    this.addScore(-30, 'Caught!', 'bad');
  };

  // ---------------------------------------------------------------- interactions
  private updateInteractions(dt: number): void {
    let prompt = '';
    const tony = this.tony;
    const carrying = tony.carrying;
    const busy = tony.busy;

    if (busy) {
      busy.t += dt;
      if (busy.type === 'steal') {
        const h = busy.human;
        const ok = this.input.e
          && GameEngine.dist2D(tony.pos, h.pos) < INTERACTION_RANGE.steal + 0.2
          && h.isInFront(tony.pos) < 0.45
          && h.state !== 'chase' && h.state !== 'slip';
        if (!ok) { tony.busy = null; this.ui.setProgress(null); }
        else {
          this.ui.setProgress(busy.t / busy.duration, 'STEALING…');
          if (busy.t >= busy.duration) { tony.busy = null; this.ui.setProgress(null); this.stealComplete(busy.slipper); }
        }
      } else if (busy.type === 'chew') {
        const item = busy.item;
        if (!this.input.f || !carrying || carrying.isSlipper) { tony.busy = null; this.ui.setProgress(null); }
        else {
          item.setChew(Math.min(1, item.chew + dt / 7));
          if (Math.random() < dt * 6) this.sfx.chew();
          const stage = item.chew >= 1 ? 3 : Math.floor(item.chew * 3);
          if (stage > item.stage) {
            item.stage = stage;
            if (stage === 1) this.addScore(40, `Chewed the ${item.name}`);
            else if (stage === 2) this.addScore(60, `Mangled the ${item.name}`);
            this.sparkles.burst(new THREE.Vector3(tony.pos.x, 0.35, tony.pos.z), 20, 0xffb86b, 1.2);
          }
          if (item.chew >= 1) this.destroyItem(item);
          else this.ui.setProgress(item.chew, `CHEWING ${item.name.toUpperCase()}`);
        }
      } else {
        const p = busy.puddle;
        p.setSize(Math.min(1, busy.t / busy.duration));
        this.ui.setProgress(p.size, 'MARKING TERRITORY…');
        if (busy.t >= busy.duration) {
          tony.busy = null;
          this.ui.setProgress(null);
          this.bladder = 0;
          let nearest = Infinity;
          let who: Human = this.humans[0];
          for (const h of this.humans) {
            const d = GameEngine.dist2D(h.pos, p);
            if (d < nearest) { nearest = d; who = h; }
          }
          const pts = 30 + Math.round(270 * THREE.MathUtils.clamp(1 - (nearest - 0.6) / 3.5, 0, 1));
          this.addScore(pts, `Peed ${nearest.toFixed(1)} m from ${who.name}`);
          if (pts > 200) this.ui.toast('DARING!');
          this.sparkles.burst(new THREE.Vector3(p.x, 0.2, p.z), 25, 0xf7e77a, 1.0);
        }
      }
      return;
    }

    // Not busy: find the best interaction
    if (!carrying) {
      type Best =
        | { type: 'steal'; human: Human; slipper: Slipper; d: number }
        | { type: 'grab'; item: ChewItem; d: number }
        | { type: 'pickSlipper'; slipper: Slipper; d: number };
      let best: Best | null = null;
      for (const h of this.humans) {
        if (h.state === 'chase' || h.state === 'slip') continue;
        const d = GameEngine.dist2D(tony.pos, h.pos);
        if (d < INTERACTION_RANGE.steal && h.isInFront(tony.pos) < 0.35) {
          const s = h.slippers.find((x) => x.attached);
          if (s) best = { type: 'steal', human: h, slipper: s, d };
        }
      }
      for (const it of this.items) {
        if (it.state !== 'placed') continue;
        const d = GameEngine.dist2D(tony.pos, it.holder.position);
        if (d < INTERACTION_RANGE.item && (!best || d < best.d)) best = { type: 'grab', item: it, d };
      }
      for (const h of this.humans) for (const s of h.slippers) {
        if (s.state !== 'dropped') continue;
        const d = GameEngine.dist2D(tony.pos, s.mesh.position);
        if (d < INTERACTION_RANGE.item && (!best || d < best.d)) best = { type: 'pickSlipper', slipper: s, d };
      }
      if (best) {
        if (best.type === 'steal') {
          prompt = `Hold E to steal ${best.human.name}'s slipper (stay behind!)`;
          if (this.input.ePressed) tony.busy = { type: 'steal', t: 0, duration: 1.7, human: best.human, slipper: best.slipper };
        } else if (best.type === 'grab') {
          prompt = `Press E to grab the ${best.item.name}`;
          if (this.input.ePressed) this.grabItem(best.item);
        } else {
          prompt = 'Press E to pick up the slipper';
          if (this.input.ePressed) {
            best.slipper.mesh.removeFromParent();
            tony.attachToMouth(best.slipper.mesh);
            best.slipper.state = 'carried';
            tony.carrying = best.slipper;
          }
        }
      }
    } else if (carrying.isSlipper) {
      const spot = this.world.hideSpots.find((sp) => GameEngine.dist2D(tony.pos, sp) < INTERACTION_RANGE.hide);
      if (spot) {
        prompt = `Press E to hide the slipper ${spot.name}`;
        if (this.input.ePressed) this.hideSlipper(carrying, spot);
      } else {
        prompt = 'Carry the slipper to the sofa or the bed · E to drop';
        if (this.input.ePressed) this.dropCarried();
      }
    } else {
      prompt = `Hold F to chew the ${carrying.name} · E to drop`;
      if (this.input.ePressed) this.dropCarried();
      else if (this.input.f && !tony.moving) tony.busy = { type: 'chew', t: 0, item: carrying };
    }

    // Pee
    if (this.bladder >= 1 && this.input.qPressed && !carrying) {
      const px = tony.pos.x - Math.sin(tony.heading) * 0.25;
      const pz = tony.pos.z - Math.cos(tony.heading) * 0.25;
      const puddle = new Puddle(this.scene, this.reflection, px, pz);
      this.puddles.push(puddle);
      tony.busy = { type: 'pee', t: 0, duration: 3.2, puddle };
      this.sfx.pee();
    } else if (this.bladder >= 1 && !carrying && !prompt) {
      prompt = 'Bladder full — press Q near a human (unseen!)';
    }
    this.ui.setPrompt(prompt);
  }

  // ---------------------------------------------------------------- detection
  private updateDetection(dt: number): void {
    this.bustCooldown = Math.max(0, this.bustCooldown - dt);
    const busyType = this.tony.busy?.type;
    const crime = !!this.tony.carrying || busyType === 'steal' || busyType === 'chew' || busyType === 'pee';
    let seen = false;
    for (const h of this.humans) {
      if (h.state === 'chase') continue;
      if (h.canSee(this.tonyEyePos())) {
        seen = true;
        if (crime && h.state !== 'slip') this.bust(h);
      }
    }
    this.ui.setSeen(seen);
  }

  private updateSlippers(dt: number): void {
    for (const h of this.humans) for (const s of h.slippers) {
      if (s.state === 'carried' && s.noticeTimer != null) {
        s.noticeTimer -= dt;
        if (s.noticeTimer <= 0) {
          s.noticeTimer = null;
          s.owner.speak('HEY! My slipper!', 2.5);
          s.owner.startChase(6);
          this.ui.log(`${s.owner.name} noticed the missing slipper!`, 'bad');
        }
      } else if (s.state === 'hidden') {
        s.timer -= dt;
        if (s.timer <= 0) {
          this.reattachSlipper(s);
          this.ui.log(`${s.owner.name} found a slipper and put it back on.`);
        }
      } else if (s.state === 'dropped') {
        for (const hh of this.humans) {
          if (hh.state === 'slip') continue;
          if (GameEngine.dist2D(hh.pos, s.mesh.position) < 0.9) {
            this.reattachSlipper(s);
            s.owner.speak('There it is.', 1.5);
            break;
          }
        }
      }
    }
  }

  private updateItems(dt: number): void {
    for (const it of this.items) {
      if (it.state !== 'gone') continue;
      it.respawn -= dt;
      if (it.respawn <= 0) {
        this.scene.add(it.holder);
        it.place();
        this.ui.log(`A new ${it.name} appeared.`);
      }
    }
  }

  private updatePuddles(dt: number): void {
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.setTime(this.time);
      if (p.discovered) {
        p.cleanTimer -= dt;
        if (p.cleanTimer < 1) p.setSize(Math.max(0, p.cleanTimer));
        if (p.cleanTimer <= 0) {
          p.dispose();
          this.puddles.splice(i, 1);
          this.ui.log('The puddle was wiped up.');
        }
        continue;
      }
      if (p.size < 0.5) continue;
      for (const h of this.humans) {
        const walking = h.state === 'walk' || h.state === 'chase';
        if (!walking) continue;
        if (GameEngine.dist2D(h.pos, p) < p.radius * p.size + 0.15) {
          // SUPER PRIZE: stepped right in it
          p.discovered = true;
          p.cleanTimer = 9;
          h.startSlip();
          h.speak('EWWW!! TONYYY!!!', 3.5);
          this.sfx.slip();
          setTimeout(() => this.sfx.superPrize(), 500);
          this.addScore(500, `SUPER PRIZE — ${h.name} stepped in your puddle!`, 'super');
          this.ui.toast('SUPER PRIZE!');
          this.sparkles.burst(new THREE.Vector3(h.pos.x, 0.6, h.pos.z), 120, 0xffd36e, 3);
          break;
        }
        // spotted while walking (short range: they are distracted)
        if (h.canSee(new THREE.Vector3(p.x, 0.02, p.z), -3.5) && Math.random() < dt * 0.5) {
          p.discovered = true;
          p.cleanTimer = 5;
          h.speak('Who did THIS?!', 2.5);
          this.ui.log(`${h.name} spotted the puddle.`, 'bad');
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- camera
  private readonly camRay = new THREE.Raycaster();
  private updateCamera(dt: number): void {
    const target = new THREE.Vector3(this.tony.pos.x, 0.35, this.tony.pos.z);
    const { yaw, pitch } = this.orbit;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let dist = this.orbit.dist;
    this.camRay.set(target, dir);
    this.camRay.far = dist;
    const hits = this.camRay.intersectObjects(this.world.camBlockers, false);
    if (hits.length) dist = Math.max(0.5, hits[0].distance - 0.15);
    const desired = target.clone().addScaledVector(dir, dist);
    desired.y = Math.min(desired.y, APT.height - 0.25);
    this.camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    this.camera.lookAt(target);
  }

  private readonly proj = new THREE.Vector3();
  private collectBubbles(): Bubble[] {
    const list: Bubble[] = [];
    for (const h of this.humans) {
      if (!h.say) continue;
      this.proj.set(h.pos.x, 2.05, h.pos.z).project(this.camera);
      if (this.proj.z > 1) continue;
      list.push({
        x: (this.proj.x * 0.5 + 0.5) * window.innerWidth,
        y: (-this.proj.y * 0.5 + 0.5) * window.innerHeight,
        text: h.say,
      });
    }
    return list;
  }

  // ---------------------------------------------------------------- main loop
  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000) * this.dtScale;
    this.last = now;
    if (this.playing) {
      this.time += dt;
      this.bladder = Math.min(1, this.bladder + dt / 45);
      this.tony.update(this.input, this.orbit.yaw, dt);
      const ctx = { tony: this.tony, onCaught: this.onCaught };
      for (const h of this.humans) h.update(ctx, dt);
      this.updateInteractions(dt);
      this.updateDetection(dt);
      this.updateSlippers(dt);
      this.updateItems(dt);
      this.updatePuddles(dt);
      this.ui.setBladder(this.bladder);
      this.statusTick += dt;
      if (this.statusTick > 0.5) {
        this.statusTick = 0;
        this.ui.setStatus(this.humans.map((h) => ({ name: h.name, doing: h.doing })));
      }
    }
    this.input.ePressed = false;
    this.input.qPressed = false;
    this.sparkles.update(dt);
    this.dust.update(this.time);
    this.updateCamera(dt);
    this.ui.setBubbles(this.collectBubbles());

    // 1) shadow maps + planar reflection pass, 2) main pass
    this.renderer.shadowMap.needsUpdate = true;
    if (this.puddles.length) this.reflection.update(this.renderer, this.scene, this.camera);
    this.postfx.render();
  }
}
