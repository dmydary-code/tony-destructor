import * as THREE from 'three';
import { World } from './world';
import type { Tony } from './tony';

export const HUMAN_RADIUS = 0.28;

export type SlipperState = 'worn' | 'carried' | 'hidden' | 'dropped';

export interface Slipper {
  readonly isSlipper: true;
  readonly mesh: THREE.Group;
  readonly foot: THREE.Group;
  owner: Human;
  attached: boolean;
  state: SlipperState;
  /** Seconds until the owner finds a hidden slipper. */
  timer: number;
  /** Seconds until the owner notices it is being carried away. */
  noticeTimer: number | null;
  name: string;
}

export type HumanState = 'idle' | 'walk' | 'chase' | 'slip';

export interface HumanLook {
  name: string;
  skin: number;
  hair: number;
  hairStyle: 'short' | 'bob';
  top: number;
  pants: number;
  slipper: number;
  sleeves?: boolean;
}

interface Waypoint {
  x: number;
  z: number;
  label: string;
  face?: [number, number];
}

const WAYPOINTS: Record<'living' | 'bedroom', Waypoint[]> = {
  living: [
    { x: -4.2, z: 2.0, label: 'sitting on the sofa', face: [0, -1] },
    { x: -1.5, z: -2.4, label: 'watching TV', face: [0, -1] },
    { x: -5.2, z: -1.5, label: 'browsing books', face: [-1, 0] },
    { x: -2.5, z: 0.8, label: 'stretching', face: [1, 0] },
    { x: -3.5, z: -2.6, label: 'looking out of the window', face: [0, -1] },
    { x: -1.0, z: 2.5, label: 'thinking', face: [-1, 0] },
  ],
  bedroom: [
    { x: 2.6, z: -2.0, label: 'checking the phone', face: [1, 0] },
    { x: 2.2, z: 2.3, label: 'working at the desk', face: [0, 1] },
    { x: 3.5, z: -2.7, label: 'looking out of the window', face: [0, -1] },
    { x: 4.9, z: 1.6, label: 'picking clothes', face: [1, 0] },
    { x: 1.4, z: 0.4, label: 'wandering', face: [-1, 0] },
    { x: 3.0, z: 0.6, label: 'yawning', face: [0, 1] },
  ],
};
const DOOR: Waypoint = { x: 0, z: 0, label: 'doorway' };

export interface HumanUpdateContext {
  tony: Tony;
  onCaught(human: Human): void;
}

/** A stylised inhabitant with waypoint AI, a vision cone, and stealable slippers. */
export class Human {
  readonly name: string;
  readonly root = new THREE.Group();
  readonly slippers: Slipper[] = [];

  heading = 0;
  speed = 1.1;
  state: HumanState = 'idle';
  stateTimer = 2 + Math.random() * 3;
  doing = 'standing';
  say: string | null = null;
  alert = 0;
  visionRange = 5.5;
  visionHalfAngle = THREE.MathUtils.degToRad(55);

  private path: Waypoint[] = [];
  private target: Waypoint | null = null;
  private lastWp: Waypoint | null = null;
  private walkPhase = 0;
  private sayTimer = 0;
  private slipDuration = 0;

  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly headG = new THREE.Group();
  private readonly mouthMesh: THREE.Mesh;

  get pos(): THREE.Vector3 { return this.root.position; }

  constructor(scene: THREE.Scene, look: HumanLook, private readonly world: World) {
    this.name = look.name;
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 });
    const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ color: look.top, roughness: 0.9 });
    const pants = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.9 });
    const slipperMat = new THREE.MeshStandardMaterial({ color: look.slipper, roughness: 0.95 });

    const limb = (rTop: number, rBottom: number, length: number, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, length, 10), mat);
      m.castShadow = true;
      return m;
    };

    const hipY = 0.85;
    const feet: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.11, hipY, 0);
      const leg = limb(0.075, 0.06, hipY - 0.05, pants);
      leg.position.y = -(hipY - 0.05) / 2;
      hip.add(leg);
      const foot = new THREE.Group();
      foot.position.set(0, -(hipY - 0.05), 0);
      hip.add(foot);
      this.root.add(hip);
      this.legs.push(hip);
      feet.push(foot);
    }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 12), top);
    torso.position.y = hipY + 0.32; torso.castShadow = true;
    this.root.add(torso);
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.26, hipY + 0.5, 0);
      const arm = limb(0.05, 0.045, 0.55, s === -1 && look.sleeves ? top : skin);
      arm.position.y = -0.27;
      shoulder.add(arm);
      shoulder.rotation.z = s * 0.12;
      this.root.add(shoulder);
      this.arms.push(shoulder);
    }
    this.headG.position.y = hipY + 0.85;
    this.root.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 14), skin);
    head.castShadow = true; this.headG.add(head);
    const neck = limb(0.05, 0.06, 0.12, skin); neck.position.y = -0.16; this.headG.add(neck);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      eye.position.set(s * 0.06, 0.02, 0.145); this.headG.add(eye);
    }
    this.mouthMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: 0x9a4a4a }));
    this.mouthMesh.position.set(0, -0.06, 0.155); this.headG.add(this.mouthMesh);

    if (look.hairStyle === 'short') {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
      hair.position.y = 0.02; hair.scale.set(1, 0.85, 1); this.headG.add(hair);
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.06), hairMat);
      fringe.position.set(0, 0.11, 0.13); fringe.rotation.x = 0.4; this.headG.add(fringe);
    } else {
      // black bob: cap to the jaw at the back/sides, straight fringe at the front
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 18, 14, Math.PI * 0.15, Math.PI * 1.7, 0, Math.PI * 0.72), hairMat);
      cap.rotation.y = -Math.PI / 2;
      cap.position.set(0, 0.0, -0.01); this.headG.add(cap);
      const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.07), hairMat);
      fringe.position.set(0, 0.12, 0.13); this.headG.add(fringe);
      const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.12), hairMat);
      sideL.position.set(-0.17, -0.04, 0.05); this.headG.add(sideL);
      const sideR = sideL.clone(); sideR.position.x = 0.17; this.headG.add(sideR);
    }

    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.26), slipperMat);
      sole.castShadow = true;
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.1), slipperMat);
      strap.position.set(0, 0.04, 0.05);
      g.add(sole, strap);
      g.position.set(0, 0.02, 0.05);
      feet[i].add(g);
      this.slippers.push({
        isSlipper: true, mesh: g, foot: feet[i], owner: this,
        attached: true, state: 'worn', timer: 0, noticeTimer: null,
        name: `${look.name}'s slipper`,
      });
    }
    scene.add(this.root);
  }

  private pickWaypoint(): void {
    const room = this.pos.x < 0 ? 'living' : 'bedroom';
    const targetRoom = Math.random() < 0.35 ? (room === 'living' ? 'bedroom' : 'living') : room;
    const list = WAYPOINTS[targetRoom];
    let wp = list[Math.floor(Math.random() * list.length)];
    if (this.lastWp === wp) wp = list[(list.indexOf(wp) + 1) % list.length];
    this.lastWp = wp;
    this.path = targetRoom !== room ? [DOOR, wp] : [wp];
    this.target = wp;
  }

  private static readonly eye = new THREE.Vector3();
  private static readonly toP = new THREE.Vector3();
  private static readonly raycaster = new THREE.Raycaster();

  /** Vision cone + wall raycast: can this human see world point p? */
  canSee(p: THREE.Vector3, extraRange = 0): boolean {
    if (this.state === 'slip') return false;
    const eye = Human.eye.set(this.pos.x, 1.55, this.pos.z);
    const toP = Human.toP.set(p.x - eye.x, p.y - eye.y, p.z - eye.z);
    const dist = toP.length();
    if (dist > this.visionRange + extraRange) return false;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const flat = Math.hypot(toP.x, toP.z);
    if (flat > 0.001) {
      const cos = (toP.x * fx + toP.z * fz) / flat;
      if (cos < Math.cos(this.visionHalfAngle)) return false;
    }
    toP.normalize();
    Human.raycaster.set(eye, toP);
    Human.raycaster.far = dist;
    return Human.raycaster.intersectObjects(this.world.occluders, false).length === 0;
  }

  /** Signed cosine of the angle between the facing direction and a point (>0 = in front). */
  isInFront(p: THREE.Vector3): number {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / d;
  }

  speak(text: string, duration = 2.5): void {
    this.say = text;
    this.sayTimer = duration;
  }

  startChase(duration = 5): void {
    this.state = 'chase';
    this.stateTimer = duration;
    this.doing = 'chasing Tony';
    this.alert = 8;
  }

  stopChase(doing: string): void {
    this.state = 'idle';
    this.stateTimer = 2;
    this.doing = doing;
  }

  startSlip(): void {
    this.state = 'slip';
    this.slipDuration = 3.2;
    this.stateTimer = this.slipDuration;
    this.doing = 'lying in a puddle';
  }

  private turnTowards(tx: number, tz: number, dt: number, rate = 6): void {
    const target = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    let diff = target - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * Math.min(1, dt * rate);
  }

  update(ctx: HumanUpdateContext, dt: number): void {
    const { tony } = ctx;
    this.sayTimer = Math.max(0, this.sayTimer - dt);
    if (this.sayTimer <= 0) this.say = null;
    this.alert = Math.max(0, this.alert - dt);

    let moving = false;
    switch (this.state) {
      case 'idle': {
        this.stateTimer -= dt;
        if (this.target?.face) {
          this.turnTowards(this.pos.x + this.target.face[0], this.pos.z + this.target.face[1], dt, 3);
        } else if (this.alert > 0) {
          this.heading += Math.sin(performance.now() * 0.002) * dt * 1.5;
        }
        if (this.stateTimer <= 0) {
          this.pickWaypoint();
          this.state = 'walk';
          this.doing = 'walking';
        }
        break;
      }
      case 'walk': {
        const wp = this.path[0];
        const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.15) {
          this.path.shift();
          if (this.path.length === 0) {
            this.state = 'idle';
            this.stateTimer = 3 + Math.random() * 6;
            this.doing = this.target!.label;
          }
        } else {
          this.turnTowards(wp.x, wp.z, dt);
          this.pos.x += Math.sin(this.heading) * this.speed * dt;
          this.pos.z += Math.cos(this.heading) * this.speed * dt;
          moving = true;
        }
        break;
      }
      case 'chase': {
        this.stateTimer -= dt;
        const dx = tony.pos.x - this.pos.x, dz = tony.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        this.turnTowards(tony.pos.x, tony.pos.z, dt, 8);
        // naive chase: straight line, but route via the door when in the other room
        const sameRoom = Math.sign(tony.pos.x) === Math.sign(this.pos.x) || Math.abs(this.pos.x) < 0.5;
        const tx = sameRoom ? tony.pos.x : DOOR.x, tz = sameRoom ? tony.pos.z : DOOR.z;
        const cd = Math.hypot(tx - this.pos.x, tz - this.pos.z);
        if (cd > 0.05) {
          this.pos.x += (tx - this.pos.x) / cd * 2.0 * dt;
          this.pos.z += (tz - this.pos.z) / cd * 2.0 * dt;
          moving = true;
        }
        if (d < 0.75) {
          ctx.onCaught(this);
          this.stopChase('grumbling');
        } else if (this.stateTimer <= 0) {
          this.state = 'idle'; this.stateTimer = 1.5; this.doing = 'giving up';
          this.alert = 6;
        }
        break;
      }
      case 'slip': {
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.state = 'idle'; this.stateTimer = 2; this.doing = 'recovering';
          this.alert = 8;
        }
        break;
      }
    }

    if (moving) {
      this.world.resolveCollisions(this.pos, HUMAN_RADIUS);
      this.walkPhase += dt * 7;
    }
    this.root.rotation.y = this.heading;

    // animation
    const amp = moving ? 0.5 : 0;
    this.legs[0].rotation.x = Math.sin(this.walkPhase) * amp;
    this.legs[1].rotation.x = -Math.sin(this.walkPhase) * amp;
    this.arms[0].rotation.x = -Math.sin(this.walkPhase) * amp * 0.7;
    this.arms[1].rotation.x = Math.sin(this.walkPhase) * amp * 0.7;
    this.headG.rotation.y = this.state === 'idle' && this.alert > 0 ? Math.sin(performance.now() * 0.003) * 0.6 : 0;
    this.headG.rotation.x = this.state === 'chase' ? 0.15 : 0;

    if (this.state === 'slip') {
      const t = Math.min(1, (this.slipDuration - this.stateTimer) * 3);
      const recover = Math.max(0, 1 - Math.max(0, this.stateTimer) / 0.6);
      const fall = Math.min(t, 1) * (1 - recover);
      this.root.rotation.x = -fall * 1.45;
      this.root.position.y = -fall * 0.1;
      this.legs[0].rotation.x = fall * 0.8; this.legs[1].rotation.x = -fall * 0.3;
      this.arms[0].rotation.z = -fall * 1.5 - 0.12; this.arms[1].rotation.z = fall * 1.5 + 0.12;
    } else {
      this.root.rotation.x = 0; this.root.position.y = 0;
      this.arms[0].rotation.z = -0.12; this.arms[1].rotation.z = 0.12;
    }
    this.mouthMesh.scale.y = this.say ? 4 : 1;
  }
}
