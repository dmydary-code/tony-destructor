import * as THREE from 'three';
import { FUR_VERT, FUR_FRAG } from './shaders';
import { InputState, LightUniforms } from './types';
import { World } from './world';
import type { ChewItem, Puddle } from './items';
import type { Human, Slipper } from './human';

export const TONY_RADIUS = 0.22;

export type Carryable = Slipper | ChewItem;

export type BusyAction =
  | { type: 'steal'; t: number; duration: number; human: Human; slipper: Slipper }
  | { type: 'chew'; t: number; item: ChewItem }
  | { type: 'pee'; t: number; duration: number; puddle: Puddle };

/** Tony: a low-poly copper dachshund made out of primitives, lit by a custom GLSL fur shader. */
export class Tony {
  readonly root = new THREE.Group();
  readonly head = new THREE.Group();
  readonly mouth = new THREE.Object3D();
  readonly fur: THREE.ShaderMaterial;
  private readonly tail: THREE.Mesh;
  private readonly body: THREE.Mesh;
  private readonly legs: THREE.Mesh[] = [];

  heading = Math.PI;
  speed = 3.2;
  moving = false;
  walkPhase = 0;
  /** Tail-wag boost after scoring. */
  happy = 0;
  /** Slow-down after being caught. */
  scared = 0;
  busy: BusyAction | null = null;
  carrying: Carryable | null = null;

  get pos(): THREE.Vector3 { return this.root.position; }

  constructor(scene: THREE.Scene, lightUniforms: LightUniforms, private readonly world: World) {
    this.fur = new THREE.ShaderMaterial({
      vertexShader: FUR_VERT,
      fragmentShader: FUR_FRAG,
      uniforms: {
        ...lightUniforms,
        uColor: { value: new THREE.Color(0xb8642a) },  // copper
        uBelly: { value: new THREE.Color(0xd9915a) },
        uTime: { value: 0 },
      },
    });
    const fur = this.fur;
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 6, 14), fur);
    this.body.rotation.x = Math.PI / 2;   // capsule axis → z (forward = +z)
    this.body.position.y = 0.26;
    this.body.castShadow = true;
    this.root.add(this.body);

    this.head.position.set(0, 0.36, 0.42);
    this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), fur);
    skull.castShadow = true; this.head.add(skull);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.2), fur);
    snout.position.set(0, -0.03, 0.16); snout.castShadow = true; this.head.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), black);
    nose.position.set(0, 0, 0.27); this.head.add(nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeWhite);
      eye.position.set(s * 0.06, 0.03, 0.09); this.head.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), black);
      pupil.position.set(s * 0.065, 0.03, 0.11); this.head.add(pupil);
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.17, 0.1), fur);
      ear.position.set(s * 0.13, -0.05, -0.02);
      ear.rotation.z = s * 0.25;
      ear.castShadow = true; this.head.add(ear);
    }
    this.mouth.position.set(0, -0.06, 0.26);
    this.head.add(this.mouth);

    const legOffsets: Array<[number, number]> = [[-0.09, 0.25], [0.09, 0.25], [-0.09, -0.25], [0.09, -0.25]];
    for (const [x, z] of legOffsets) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 8), fur);
      leg.position.set(x, 0.08, z);
      leg.castShadow = true;
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.28, 6), fur);
    this.tail.position.set(0, 0.34, -0.46);
    this.tail.rotation.x = -0.9;
    this.root.add(this.tail);

    scene.add(this.root);
    this.root.position.set(-2.5, 0, 0.5);
    this.root.rotation.y = this.heading;
  }

  private readonly moveDir = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  update(input: InputState, camYaw: number, dt: number): void {
    let ix = 0, iz = 0;
    if (input.w) iz += 1;
    if (input.s) iz -= 1;
    if (input.a) ix -= 1;
    if (input.d) ix += 1;
    const wantsMove = (ix !== 0 || iz !== 0) && !this.busy;
    this.moving = wantsMove;

    if (wantsMove) {
      // camera-relative movement on the XZ plane
      this.moveDir.set(ix, 0, -iz).normalize().applyAxisAngle(Tony.UP, camYaw);
      const targetHeading = Math.atan2(this.moveDir.x, this.moveDir.z);
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
      let spd = this.speed;
      if (this.carrying) spd *= 0.85;
      if (this.scared > 0) spd *= 0.6;
      this.root.position.x += Math.sin(this.heading) * spd * dt;
      this.root.position.z += Math.cos(this.heading) * spd * dt;
      this.world.resolveCollisions(this.root.position, TONY_RADIUS);
      this.walkPhase += dt * 16;
    } else {
      this.walkPhase += dt * 4;
    }
    this.root.rotation.y = this.heading;

    // Procedural animation
    const amp = wantsMove ? 0.45 : 0.0;
    this.legs.forEach((leg, i) => {
      const phase = this.walkPhase + (i === 0 || i === 3 ? 0 : Math.PI);
      leg.rotation.x = Math.sin(phase) * amp;
    });
    const wag = 1 + this.happy * 3;
    this.tail.rotation.y = Math.sin(this.walkPhase * 0.8 * wag) * (0.35 + this.happy * 0.5);
    this.head.position.y = 0.36 + (wantsMove ? Math.sin(this.walkPhase * 2) * 0.01 : Math.sin(this.walkPhase) * 0.006);
    this.body.position.y = 0.26 + (wantsMove ? Math.abs(Math.sin(this.walkPhase)) * 0.015 : 0);

    // Pose overrides per action
    if (this.busy?.type === 'pee') {
      this.legs[3].rotation.z = -1.2;
      this.root.rotation.z = 0.12;
    } else {
      this.legs[3].rotation.z = 0;
      this.root.rotation.z = 0;
    }
    if (this.busy?.type === 'chew') {
      this.head.rotation.x = Math.sin(performance.now() * 0.02) * 0.15;
    } else if (this.busy?.type === 'steal') {
      this.head.rotation.x = 0.35 + Math.sin(performance.now() * 0.03) * 0.1;
    } else {
      this.head.rotation.x = 0;
    }

    this.happy = Math.max(0, this.happy - dt * 0.5);
    this.scared = Math.max(0, this.scared - dt);
    (this.fur.uniforms['uTime'] as THREE.IUniform<number>).value += dt;
  }

  /** Attach a carried object under the snout. */
  attachToMouth(obj3d: THREE.Object3D): void {
    this.mouth.add(obj3d);
    obj3d.position.set(0, 0, 0.05);
    obj3d.rotation.set(0, Math.PI / 2, 0);
  }
}
