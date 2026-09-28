import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SKIN_FUR_VERT, SKIN_FUR_FRAG } from './shaders';
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

/** "Dashshund Dog" by spooneystone — CC-BY-4.0, https://sketchfab.com/3d-models/dashshund-dog-cb0abb276cc247f095c0c527db987276 */
const MODEL_URL = 'models/dachshund/scene.gltf';
/** Nose-to-tail length we scale the model to, in metres. */
const BODY_LENGTH = 1.0;
const SHELLS = 12;
const FUR_LEN_M = 0.022;

type Clip = 'idle' | 'idle2' | 'walk' | 'run' | 'eat';
const CLIP_NAMES: Record<Clip, string> = {
  idle: 'Armature|Idle_1', idle2: 'Armature|Idle_2', walk: 'Armature|Walk', run: 'Armature|Run', eat: 'Armature|Eating',
};

/** Tony: an animated glTF dachshund with shell fur, driven by the game's input. */
export class Tony {
  readonly root = new THREE.Group();
  readonly mouth = new THREE.Object3D();
  /** Shared uniforms (time + lights) for every fur shell. */
  private readonly furUniforms: Record<string, THREE.IUniform>;
  private readonly furMats: THREE.ShaderMaterial[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private current: Clip | null = null;
  private loaded = false;

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
    this.furUniforms = { ...lightUniforms, uTime: { value: 0 }, uMap: { value: null } };
    // Until the model arrives the mouth sits roughly where the snout will be.
    this.mouth.position.set(0, 0.22, 0.5);
    this.root.add(this.mouth);
    scene.add(this.root);
    this.root.position.set(-2.5, 0, 0.5);
    this.root.rotation.y = this.heading;
    void this.load();
  }

  private async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // Fit: scale so the longest horizontal extent is BODY_LENGTH, feet on the floor.
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const scale = BODY_LENGTH / Math.max(size.x, size.z);
    const holder = new THREE.Group();
    holder.scale.setScalar(scale);
    holder.position.set(-(box.min.x + size.x / 2) * scale, -box.min.y * scale, -(box.min.z + size.z / 2) * scale);
    holder.rotation.y = size.x > size.z ? Math.PI / 2 : 0;   // long axis → z (forward)
    holder.add(model);
    this.root.add(holder);

    let skinned: THREE.SkinnedMesh | null = null;
    model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh; });
    if (skinned) this.setupFur(skinned, scale);

    // Mouth follows the head bone, keeping the root's orientation and scene-unit scale.
    const headBone = model.getObjectByName('Head_031') ?? model.getObjectByName('HeadHandle_055');
    if (headBone) {
      model.updateMatrixWorld(true);
      this.root.updateMatrixWorld(true);
      const headWorld = headBone.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
      const target = headWorld.clone().addScaledVector(forward, 0.2).add(new THREE.Vector3(0, -0.07, 0));
      headBone.add(this.mouth);
      this.mouth.position.copy(headBone.worldToLocal(target.clone()));
      const boneQ = headBone.getWorldQuaternion(new THREE.Quaternion());
      this.mouth.quaternion.copy(boneQ.invert().multiply(this.root.getWorldQuaternion(new THREE.Quaternion())));
      const s = headBone.getWorldScale(new THREE.Vector3());
      this.mouth.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
    }

    this.mixer = new THREE.AnimationMixer(model);
    for (const [key, name] of Object.entries(CLIP_NAMES) as Array<[Clip, string]>) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (clip) this.actions[key] = this.mixer.clipAction(clip);
    }
    this.play('idle', 0);
    this.loaded = true;
  }

  /** Replaces the loader material with the fur shader (shell 0) and stacks fur shells on top. */
  private setupFur(mesh: THREE.SkinnedMesh, worldScale: number): void {
    const src = mesh.material as THREE.MeshStandardMaterial;
    this.furUniforms['uMap'].value = src.map;
    const furLen = FUR_LEN_M / worldScale;        // object units
    const make = (shell: number): THREE.ShaderMaterial => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SKIN_FUR_VERT, fragmentShader: SKIN_FUR_FRAG,
        uniforms: { ...this.furUniforms, uShell: { value: shell }, uFurLen: { value: furLen }, uDensity: { value: worldScale / 0.0055 } },
        side: THREE.DoubleSide,
      });
      this.furMats.push(mat);
      return mat;
    };
    mesh.material = make(0);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    for (let i = 1; i <= SHELLS; i++) {
      const shell = new THREE.SkinnedMesh(mesh.geometry, make(i / SHELLS));
      shell.bind(mesh.skeleton, mesh.bindMatrix);
      shell.frustumCulled = false;
      mesh.add(shell);
    }
  }

  private play(clip: Clip, fade = 0.2): void {
    if (clip === this.current) return;
    const next = this.actions[clip];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : undefined;
    next.reset().setEffectiveWeight(1).play();
    if (prev) prev.crossFadeTo(next, fade, false); else next.fadeIn(fade);
    this.current = clip;
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

    let spd = this.speed;
    if (wantsMove) {
      // camera-relative movement on the XZ plane
      this.moveDir.set(ix, 0, -iz).normalize().applyAxisAngle(Tony.UP, camYaw);
      const targetHeading = Math.atan2(this.moveDir.x, this.moveDir.z);
      let diff = targetHeading - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, dt * 14);
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

    // Animation state
    if (this.busy?.type === 'chew' || this.busy?.type === 'steal') this.play('eat');
    else if (this.busy?.type === 'pee') this.play('idle2');
    else if (wantsMove) this.play(spd < this.speed * 0.9 ? 'walk' : 'run');
    else this.play('idle');
    if (this.mixer) {
      const run = this.actions['run'];
      if (run) run.timeScale = 1.0 + this.happy * 0.3;
      this.mixer.update(dt);
    }
    // Pee pose: lean a little
    this.root.rotation.z = this.busy?.type === 'pee' ? 0.12 : 0;

    this.happy = Math.max(0, this.happy - dt * 0.5);
    this.scared = Math.max(0, this.scared - dt);
    this.furUniforms['uTime'].value += dt;
  }

  /** Attach a carried object under the snout. */
  attachToMouth(obj3d: THREE.Object3D): void {
    this.mouth.add(obj3d);
    obj3d.position.set(0, 0, 0.05);
    obj3d.rotation.set(0, Math.PI / 2, 0);
  }
}
