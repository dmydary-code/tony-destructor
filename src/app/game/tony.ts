import * as THREE from 'three';
import { FUR_VERT, FUR_FRAG, SHELL_VERT, SHELL_FRAG } from './shaders';
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

const SHELLS = 14;

/**
 * Dachshund torso as a swept profile: narrow neck, deep keel-shaped chest,
 * tucked-up loin, rounded rump. Built as a lathe along Y, then rotated so the
 * axis runs along +z (forward), with the underside of the chest pulled down.
 */
function torsoGeometry(): THREE.BufferGeometry {
  //            z (along body, front → back)   radius
  const profile: Array<[number, number]> = [
    [0.44, 0.02], [0.42, 0.09], [0.38, 0.13], [0.30, 0.165], [0.18, 0.17], [0.04, 0.16],
    [-0.10, 0.145], [-0.24, 0.14], [-0.36, 0.14], [-0.44, 0.11], [-0.48, 0.05], [-0.49, 0.01],
  ];
  const pts = profile.map(([z, r]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2);                     // lathe axis Y → +z … actually -z; flip below
  g.scale(1, 1, -1);
  const pos = g.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i);
    // deep chest: pull the underside down between the shoulders and the belly
    const chest = THREE.MathUtils.smoothstep(z, -0.05, 0.3) * (1 - THREE.MathUtils.smoothstep(z, 0.3, 0.45));
    if (y < 0) pos.setY(i, y - 0.04 * chest * (-y / 0.17));
    // slight sag in the middle of the back, loin tucks up
    const loin = THREE.MathUtils.smoothstep(z, -0.35, -0.1) * (1 - THREE.MathUtils.smoothstep(z, -0.1, 0.1));
    if (y < 0) pos.setY(i, pos.getY(i) + 0.02 * loin);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Tony: a low-poly copper dachshund made out of primitives, lit by a custom GLSL fur shader. */
export class Tony {
  private readonly shellMats: THREE.ShaderMaterial[] = [];

  /** Draws `mesh` again SHELLS times as fur shells of the given length (metres). */
  private addFurShells(mesh: THREE.Mesh, furLen: number, density = 260): void {
    const base = this.fur.uniforms;
    for (let i = 1; i <= SHELLS; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
        uniforms: {
          ...base,
          uShell: { value: i / SHELLS },
          uFurLen: { value: furLen },
          uDensity: { value: density },
        },
        side: THREE.DoubleSide,
      });
      const shell = new THREE.Mesh(mesh.geometry, mat);
      shell.frustumCulled = false;
      mesh.add(shell);
      this.shellMats.push(mat);
    }
  }

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
    this.body = new THREE.Mesh(torsoGeometry(), fur);
    this.body.position.y = 0.27;
    this.body.castShadow = true;
    this.root.add(this.body);
    this.addFurShells(this.body, 0.035);

    // Head: rounder skull, capsule muzzle, big glossy eyes with highlights, long floppy ears.
    this.head.position.set(0, 0.39, 0.46);
    this.head.scale.setScalar(1.15);
    this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), fur);
    skull.scale.set(1, 0.92, 1.25); skull.position.z = -0.02; skull.castShadow = true; this.head.add(skull);
    this.addFurShells(skull, 0.02, 320);
    // tapered muzzle: cylinder narrowing toward the nose + rounded tip
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.066, 0.19, 16), fur);
    snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.03, 0.15); snout.scale.set(1, 0.85, 1); snout.castShadow = true; this.head.add(snout);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), fur);
    tip.position.set(0, -0.03, 0.255); tip.scale.set(1, 0.85, 0.8); this.head.add(tip);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), black);
    nose.position.set(0, -0.005, 0.28); nose.scale.set(1.15, 0.8, 0.9); this.head.add(nose);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9915a, roughness: 0.8 }));
    for (const s of [-1, 1]) {
      // Eye looks forward: iris/pupil/highlight stacked along the eye normal n.
      // Smaller, almond-shaped eyes set on the sides of a longer skull.
      const e = new THREE.Vector3(s * 0.072, 0.03, 0.085);
      const n = new THREE.Vector3(s * 0.55, 0.15, 0.8).normalize();
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 12), eyeWhite);
      eye.position.copy(e); eye.scale.set(1, 0.8, 1); this.head.add(eye);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3a2313, roughness: 0.2 }));
      iris.position.copy(e).addScaledVector(n, 0.014); this.head.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), black);
      pupil.position.copy(e).addScaledVector(n, 0.022); this.head.add(pupil);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), glint);
      spark.position.copy(e).addScaledVector(n, 0.026).add(new THREE.Vector3(-s * 0.004, 0.007, 0)); this.head.add(spark);
      const b = brow.clone(); b.position.set(s * 0.058, 0.075, 0.09); b.scale.set(1.0, 0.4, 0.8); this.head.add(b);
      // Floppy ear: flattened capsule hanging from the side of the skull
      // Long ears set high and far back, hanging flat against the cheeks.
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.15, 6, 12), fur);
      ear.scale.set(0.35, 1, 1.05);
      ear.position.set(s * 0.11, -0.05, -0.06);
      ear.rotation.z = s * 0.22; ear.rotation.x = -0.1;
      ear.castShadow = true; this.head.add(ear);
      this.addFurShells(ear, 0.018, 320);
    }
    this.mouth.position.set(0, -0.06, 0.26);
    this.head.add(this.mouth);

    // Collar with a brass tag.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.02, 10, 32), collarMat);
    collar.position.set(0, 0.255, 0.415); collar.rotation.x = 0.25; this.root.add(collar);
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
      this.addFurShells(leg, 0.02, 320);
    }
    // Tail: a curved tube that sweeps up.
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.05, -0.1), new THREE.Vector3(0, 0.14, -0.19), new THREE.Vector3(0, 0.26, -0.24),
    ]);
    this.tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.022, 8, false), fur);
    this.tail.position.set(0, 0.3, -0.42);
    this.tail.castShadow = true;
    this.root.add(this.tail);
    this.addFurShells(this.tail, 0.025, 320);

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
