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
        uColor: { value: new THREE.Color(0x9e4a17) },  // copper
        uBelly: { value: new THREE.Color(0xcf8a4e) },
        uTime: { value: 0 },
      },
    });
    const fur = this.fur;
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.25 });
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15 });
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const collarMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.25, metalness: 0.9 });

    // Body: long sausage with a slight sag, deeper chest at the front.
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 8, 20), fur);
    this.body.rotation.x = Math.PI / 2;   // capsule axis → z (forward = +z)
    this.body.position.y = 0.26;
    this.body.scale.set(1, 0.92, 1);
    this.body.castShadow = true;
    this.root.add(this.body);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12), fur);
    chest.position.set(0, 0.25, 0.28); chest.scale.set(1, 0.95, 1.1); chest.castShadow = true;
    this.root.add(chest);
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), fur);
    rump.position.set(0, 0.26, -0.3); rump.scale.set(1, 0.9, 1.1); rump.castShadow = true;
    this.root.add(rump);

    // Head: rounder skull, capsule muzzle, big glossy eyes with highlights, long floppy ears.
    this.head.position.set(0, 0.39, 0.46);
    this.head.scale.setScalar(1.15);
    this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), fur);
    skull.scale.set(1, 0.95, 1.05); skull.castShadow = true; this.head.add(skull);
    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.056, 0.1, 6, 14), fur);
    snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.035, 0.155); snout.castShadow = true; this.head.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), black);
    nose.position.set(0, -0.012, 0.245); nose.scale.set(1.1, 0.85, 0.9); this.head.add(nose);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9915a, roughness: 0.8 }));
    for (const s of [-1, 1]) {
      // Eye looks forward: iris/pupil/highlight stacked along the eye normal n.
      const e = new THREE.Vector3(s * 0.06, 0.035, 0.095);
      const n = new THREE.Vector3(s * 0.25, 0.1, 0.96).normalize();
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 12), eyeWhite);
      eye.position.copy(e); this.head.add(eye);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3a2313, roughness: 0.2 }));
      iris.position.copy(e).addScaledVector(n, 0.022); this.head.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), black);
      pupil.position.copy(e).addScaledVector(n, 0.031); this.head.add(pupil);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), glint);
      spark.position.copy(e).addScaledVector(n, 0.034).add(new THREE.Vector3(-s * 0.006, 0.009, 0)); this.head.add(spark);
      const b = brow.clone(); b.position.set(s * 0.06, 0.085, 0.08); b.scale.set(1.2, 0.5, 0.8); this.head.add(b);
      // Floppy ear: flattened capsule hanging from the side of the skull
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.13, 6, 12), fur);
      ear.scale.set(0.4, 1, 1);
      ear.position.set(s * 0.125, -0.06, -0.01);
      ear.rotation.z = s * 0.3; ear.rotation.x = -0.15;
      ear.castShadow = true; this.head.add(ear);
    }
    this.mouth.position.set(0, -0.06, 0.26);
    this.head.add(this.mouth);

    // Collar with a brass tag.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 32), collarMat);
    collar.position.set(0, 0.265, 0.4); collar.rotation.x = 0.2; this.root.add(collar);
    const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 16), brass);
    tag.position.set(0, 0.1, 0.44); tag.rotation.x = Math.PI / 2 + 0.25; this.root.add(tag);

    // Short legs with rounded paws.
    const legOffsets: Array<[number, number]> = [[-0.09, 0.25], [0.09, 0.25], [-0.09, -0.25], [0.09, -0.25]];
    for (const [x, z] of legOffsets) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.16, 12), fur);
      leg.position.set(x, 0.08, z);
      leg.castShadow = true;
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), fur);
      paw.position.set(0, -0.075, 0.015); paw.scale.set(1, 0.6, 1.25); paw.castShadow = true;
      leg.add(paw);
      this.root.add(leg);
      this.legs.push(leg);
    }
    // Tail: a curved tube that sweeps up.
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.05, -0.1), new THREE.Vector3(0, 0.14, -0.19), new THREE.Vector3(0, 0.26, -0.24),
    ]);
    this.tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.022, 8, false), fur);
    this.tail.position.set(0, 0.3, -0.42);
    this.tail.castShadow = true;
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
    this.tail.rotation.y = Math.sin(this.walkPhase * 0.8 * wag) * (0.55 + this.happy * 0.6);
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
