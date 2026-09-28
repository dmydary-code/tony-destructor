import * as THREE from 'three';
import { CHEW_VERT, CHEW_FRAG, PUDDLE_VERT, PUDDLE_FRAG, SPARK_VERT, SPARK_FRAG } from './shaders';
import { LightUniforms } from './types';
import { World } from './world';

// ------------------------------------------------------------ chewables
export type ItemState = 'placed' | 'carried' | 'gone';

interface ItemDef {
  name: string;
  color: number;
  geo: () => THREE.BufferGeometry;
  rot?: [number, number, number];
  spots: SpotName[];
}

type SpotName = 'table' | 'sofaSeat' | 'tvStand' | 'nightstand' | 'desk' | 'bed' | 'floorLiving' | 'floorBed';

const ITEM_DEFS: ItemDef[] = [
  { name: 'TV remote', color: 0x222222, geo: () => new THREE.BoxGeometry(0.05, 0.022, 0.18, 3, 2, 8), spots: ['table', 'sofaSeat', 'tvStand', 'floorLiving'] },
  { name: 'sock', color: 0xd8d8e8, geo: () => new THREE.CapsuleGeometry(0.035, 0.16, 4, 10), rot: [0, 0, Math.PI / 2], spots: ['floorBed', 'bed', 'floorLiving'] },
  { name: 'phone charger', color: 0xf5f5f5, geo: () => new THREE.BoxGeometry(0.06, 0.03, 0.06, 4, 2, 4), spots: ['nightstand', 'desk', 'floorBed'] },
  { name: 'cushion', color: 0xc9a13a, geo: () => new THREE.BoxGeometry(0.34, 0.11, 0.34, 8, 3, 8), spots: ['sofaSeat', 'floorLiving', 'bed'] },
  { name: 'newspaper', color: 0xd9d4c5, geo: () => new THREE.BoxGeometry(0.28, 0.015, 0.2, 8, 1, 6), spots: ['table', 'floorLiving', 'desk'] },
  { name: 'sneaker', color: 0xffffff, geo: () => new THREE.CapsuleGeometry(0.05, 0.16, 4, 10), rot: [0, 0, Math.PI / 2], spots: ['floorBed', 'floorLiving'] },
];

/** A thing that is lying around badly and can be chewed to bits, stage by stage. */
export class ChewItem {
  readonly isSlipper = false as const;
  readonly name: string;
  readonly holder = new THREE.Group();
  readonly mat: THREE.ShaderMaterial;
  chew = 0;
  stage = 0;
  state: ItemState = 'placed';
  respawn = 0;
  onFurniture = false;

  constructor(private readonly def: ItemDef, seed: number, private readonly world: World, scene: THREE.Scene, lightUniforms: LightUniforms) {
    this.name = def.name;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: CHEW_VERT, fragmentShader: CHEW_FRAG,
      uniforms: { ...lightUniforms, uColor: { value: new THREE.Color(def.color) }, uChew: { value: 0 }, uSeed: { value: seed } },
    });
    const mesh = new THREE.Mesh(def.geo(), this.mat);
    mesh.castShadow = true;
    if (def.rot) mesh.rotation.set(...def.rot);
    this.holder.add(mesh);
    scene.add(this.holder);
    this.place();
  }

  private spotPosition(name: SpotName): { x: number; y: number; z: number } {
    const f = this.world.furniture;
    switch (name) {
      case 'table': return { x: f['table'].x + (Math.random() - 0.5) * 0.6, y: f['table'].top!, z: f['table'].z + (Math.random() - 0.5) * 0.3 };
      case 'sofaSeat': return { x: f['sofa'].x + (Math.random() - 0.5) * 1.6, y: 0.6, z: f['sofa'].z - 0.05 };
      case 'tvStand': return { x: f['tvStand'].x + (Math.random() - 0.5) * 0.8, y: f['tvStand'].top!, z: f['tvStand'].z + 0.05 };
      case 'nightstand': return { x: f['nightstand'].x, y: f['nightstand'].top!, z: f['nightstand'].z + 0.05 };
      case 'desk': return { x: f['desk'].x + (Math.random() - 0.5) * 0.8, y: f['desk'].top!, z: f['desk'].z - 0.1 };
      case 'bed': return { x: f['bed'].x + (Math.random() - 0.5) * 1.2, y: f['bed'].top!, z: f['bed'].z + (Math.random() - 0.3) * 1.6 };
      case 'floorLiving': return { x: -1.5 - Math.random() * 3, y: 0, z: -1.5 + Math.random() * 3.5 };
      case 'floorBed': return { x: 1 + Math.random() * 2.5, y: 0, z: -1.2 + Math.random() * 3 };
    }
  }

  /** (Re)places the item on a random spawn spot, fully repaired. */
  place(): void {
    const spot = this.def.spots[Math.floor(Math.random() * this.def.spots.length)];
    const p = this.spotPosition(spot);
    this.holder.position.set(p.x, p.y + 0.02, p.z);
    this.holder.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.holder.visible = true;
    this.state = 'placed';
    this.chew = 0; this.stage = 0;
    (this.mat.uniforms['uChew'] as THREE.IUniform<number>).value = 0;
    this.onFurniture = p.y > 0.05;
  }

  setChew(v: number): void {
    this.chew = v;
    (this.mat.uniforms['uChew'] as THREE.IUniform<number>).value = v;
  }
}

export function createItems(scene: THREE.Scene, world: World, lightUniforms: LightUniforms): ChewItem[] {
  return ITEM_DEFS.map((def, i) => new ChewItem(def, i * 3.7, world, scene, lightUniforms));
}

// ------------------------------------------------------------ planar reflection
/**
 * Renders the scene from a camera mirrored through the floor plane into a
 * render target; puddles sample it with a projective texture matrix.
 */
export class PlanarReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly textureMatrix = new THREE.Matrix4();
  private readonly virtualCamera = new THREE.PerspectiveCamera();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly n = new THREE.Vector3();
  private readonly q = new THREE.Vector4();
  private readonly clip = new THREE.Plane();

  constructor(size = 512) {
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType });
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const cam = this.virtualCamera;
    const n = this.n.copy(this.plane.normal);
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const dist = this.plane.distanceToPoint(camPos);
    cam.position.copy(camPos).addScaledVector(n, -2 * dist);
    const worldQuat = camera.getWorldQuaternion(new THREE.Quaternion());
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
    look.addScaledVector(n, -2 * look.dot(n));
    up.addScaledVector(n, -2 * up.dot(n));
    cam.up.copy(up);
    cam.lookAt(cam.position.clone().add(look));
    cam.near = camera.near; cam.far = camera.far;
    cam.aspect = camera.aspect; cam.fov = camera.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

    // Oblique near-plane clipping (Lengyel): clip everything below the floor.
    const clip = this.clip.copy(this.plane);
    clip.applyMatrix4(cam.matrixWorldInverse);
    const q = this.q;
    const P = cam.projectionMatrix;
    q.x = (Math.sign(clip.normal.x) + P.elements[8]) / P.elements[0];
    q.y = (Math.sign(clip.normal.y) + P.elements[9]) / P.elements[5];
    q.z = -1.0;
    q.w = (1.0 + P.elements[10]) / P.elements[14];
    const c = new THREE.Vector4(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    c.multiplyScalar(2.0 / c.dot(q));
    P.elements[2] = c.x; P.elements[6] = c.y; P.elements[10] = c.z + 1.0; P.elements[14] = c.w;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(P).multiply(cam.matrixWorldInverse);

    cam.layers.set(0);            // puddles live on layer 1 → not in their own reflection
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }
}

// ------------------------------------------------------------ puddles
export class Puddle {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  readonly x: number;
  readonly z: number;
  readonly radius = 0.4;
  size = 0;
  discovered = false;
  cleanTimer = 0;

  constructor(scene: THREE.Scene, reflection: PlanarReflection, x: number, z: number) {
    this.x = x; this.z = z;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PUDDLE_VERT, fragmentShader: PUDDLE_FRAG,
      transparent: true, depthWrite: false,
      uniforms: {
        tReflection: { value: reflection.rt.texture },
        uTextureMatrix: { value: reflection.textureMatrix },
        uTime: { value: 0 }, uSize: { value: 0 }, uSeed: { value: Math.random() * 10 },
        uTint: { value: new THREE.Color(0xd8c24a) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(x, 0.012, z);
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  setSize(v: number): void {
    this.size = v;
    (this.mat.uniforms['uSize'] as THREE.IUniform<number>).value = v;
  }

  setTime(t: number): void {
    (this.mat.uniforms['uTime'] as THREE.IUniform<number>).value = t;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mat.dispose();
    this.mesh.geometry.dispose();
  }
}

// ------------------------------------------------------------ particles
export class Sparkles {
  private readonly max: number;
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly col: Float32Array;
  private next = 0;

  constructor(scene: THREE.Scene, max = 400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      uniforms: { uSize: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.geo, mat);
    points.frustumCulled = false;
    scene.add(points);
  }

  burst(p: THREE.Vector3, n: number, color: number, speed = 1.5): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.cos(a) * Math.sin(b) * s;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(b)) * s + 0.5;
      this.vel[i * 3 + 2] = Math.sin(a) * Math.sin(b) * s;
      this.life[i] = 1;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 1.2;
      this.vel[i * 3 + 1] -= 3 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
    }
    this.geo.attributes['position'].needsUpdate = true;
    this.geo.attributes['aLife'].needsUpdate = true;
    this.geo.attributes['aColor'].needsUpdate = true;
  }
}

/** Drifting dust motes in the window light. */
export class Dust {
  private readonly geo = new THREE.BufferGeometry();
  private readonly pos: Float32Array;
  private readonly n = 90;

  constructor(scene: THREE.Scene) {
    const n = this.n;
    this.pos = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const room = Math.random() < 0.5 ? -3.5 : 3.5;
      this.pos[i * 3] = room + (Math.random() - 0.5) * 2.2;
      this.pos[i * 3 + 1] = 0.2 + Math.random() * 2.2;
      this.pos[i * 3 + 2] = -3.4 + Math.random() * 3.5;
      life[i] = 0.05 + Math.random() * 0.12;
      col[i * 3] = 1; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 0.8;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      uniforms: { uSize: { value: 0.16 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  update(t: number): void {
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] += Math.sin(t * 0.5 + i) * 0.0006;
      this.pos[i * 3 + 1] += Math.cos(t * 0.3 + i * 0.7) * 0.0005;
    }
    this.geo.attributes['position'].needsUpdate = true;
  }
}
