import * as THREE from 'three';
import { Collider, FurnitureSpot, HideSpot } from './types';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Apartment layout (metres).
//   Living room: x in [-6, 0], Bedroom: x in [0, 6], depth z in [-3.5, 3.5]
//   Door between rooms at x = 0, z in [-0.8, 0.8]. Windows in the north wall (z = -3.5).
export const APT = { xMin: -6, xMax: 6, zMin: -3.5, zMax: 3.5, height: 2.8, doorHalf: 0.8 } as const;

interface BoxOpts {
  cast?: boolean;
  collide?: boolean;
  occlude?: boolean;
  rotY?: number;
}

function makeCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Oak planks: per-plank tint, fine grain, dark bevelled joints. Returns colour + roughness maps. */
function parquetTextures(): { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
  const rows = 14, cols = 3;
  const planks: Array<{ x: number; y: number; w: number; h: number; hue: number; light: number }> = [];
  const W = 1024, H = 1024, ph = H / rows, pw = W / cols;
  for (let r = 0; r < rows; r++) {
    const off = ((r * 37) % 100) / 100 * pw;
    for (let c = -1; c < cols + 1; c++) {
      planks.push({ x: c * pw + off, y: r * ph, w: pw, h: ph, hue: 26 + Math.random() * 10, light: 40 + Math.random() * 14 });
    }
  }
  const map = makeCanvas(W, H, (ctx) => {
    for (const p of planks) {
      ctx.fillStyle = `hsl(${p.hue} 42% ${p.light}%)`;
      ctx.fillRect(p.x, p.y, p.w - 3, p.h - 3);
      // wood grain: long soft streaks
      for (let g = 0; g < 26; g++) {
        const x = p.x + Math.random() * p.w;
        ctx.strokeStyle = `hsla(${p.hue} 40% ${p.light + (Math.random() < 0.5 ? -9 : 7)}% / ${0.12 + Math.random() * 0.2})`;
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath(); ctx.moveTo(x, p.y);
        ctx.bezierCurveTo(x + 8, p.y + p.h * 0.3, x - 8, p.y + p.h * 0.7, x + (Math.random() - 0.5) * 10, p.y + p.h); ctx.stroke();
      }
      // bevelled edge + shadow in the joint
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h); ctx.fillRect(p.x, p.y + p.h - 3, p.w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(p.x, p.y, p.w - 3, 2);
    }
  });
  const roughnessMap = makeCanvas(W, H, (ctx) => {
    for (const p of planks) {
      const r = 120 + Math.random() * 60;
      ctx.fillStyle = `rgb(${r},${r},${r})`;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      for (let g = 0; g < 14; g++) {
        ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.25})`;
        ctx.fillRect(p.x + Math.random() * p.w, p.y, 2, p.h);
      }
      ctx.fillStyle = 'rgb(230,230,230)';
      ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h); ctx.fillRect(p.x, p.y + p.h - 3, p.w, 3);
    }
  });
  roughnessMap.colorSpace = THREE.NoColorSpace;
  map.anisotropy = 8;
  return { map, roughnessMap };
}

/** Soft plaster: base colour with fine speckle noise instead of flat stripes. */
function plasterTexture(base: string, speckle: string): THREE.CanvasTexture {
  return makeCanvas(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? speckle : 'rgba(255,255,255,0.06)';
      ctx.globalAlpha = 0.25 + Math.random() * 0.5;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    ctx.globalAlpha = 1;
  });
}

/** Evening sky gradient for the backdrop behind the windows. */
function skyTexture(): THREE.CanvasTexture {
  const t = makeCanvas(64, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5f8fd6'); g.addColorStop(0.55, '#a9cdf2'); g.addColorStop(1, '#ffd9a8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Curtain: a plane folded with a sine wave so it catches light like real fabric. */
function curtainGeometry(width: number, height: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, 40, 4);
  const pos = g.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(x / width * Math.PI * 9) * 0.045);
  }
  g.computeVertexNormals();
  return g;
}


function rugTexture(): THREE.CanvasTexture {
  return makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a3b3b'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {            // woven texture
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
    ctx.strokeStyle = '#d9b26a'; ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.strokeRect(40, 40, w - 80, h - 80);
    ctx.fillStyle = '#c94f4f';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      ctx.beginPath(); ctx.arc(60 + i * 27, 60 + j * 27, 6, 0, Math.PI * 2); ctx.fill();
    }
  });
}

/** Builds a quad from four corners as a raw BufferGeometry (positions, normals, uvs, index). */
function quad(a: number[], b: number[], c: number[], d: number[], uvScale = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([...a, ...b, ...c, ...d]);
  const ab = new THREE.Vector3().subVectors(new THREE.Vector3(...b as [number, number, number]), new THREE.Vector3(...a as [number, number, number]));
  const ad = new THREE.Vector3().subVectors(new THREE.Vector3(...d as [number, number, number]), new THREE.Vector3(...a as [number, number, number]));
  const n = new THREE.Vector3().crossVectors(ab, ad).normalize();
  const nor = new Float32Array([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z]);
  const w = ab.length() * uvScale, h = ad.length() * uvScale;
  const uv = new Float32Array([0, 0, w, 0, w, h, 0, h]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * The apartment: geometry, lights, and the spatial queries the gameplay needs
 * (collision, occlusion, hide spots). One instance per game.
 */
export class World {
  readonly colliders: Collider[] = [];
  /** Meshes used for line-of-sight raycasts (walls + tall furniture). */
  readonly occluders: THREE.Mesh[] = [];
  /** Meshes the third-person camera must not pass through. */
  readonly camBlockers: THREE.Mesh[] = [];
  readonly hideSpots: HideSpot[] = [];
  readonly furniture: Record<string, FurnitureSpot> = {};
  readonly lampPositions: THREE.Vector3[] = [];
  sun!: THREE.DirectionalLight;
  floor!: THREE.Mesh;

  constructor(private readonly scene: THREE.Scene) {
    this.build();
  }

  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, opts: BoxOpts = {}): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    if (opts.rotY) m.rotation.y = opts.rotY;
    this.scene.add(m);
    if (opts.collide !== false) {
      this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h / 2 });
    }
    if (opts.occlude) this.occluders.push(m);
    if (opts.occlude || (y + h / 2 >= 0.55 && Math.max(w, d) >= 0.4)) this.camBlockers.push(m);
    return m;
  }

  private addWall(pts: [number[], number[], number[], number[]], mat: THREE.Material, uvScale = 0.6): THREE.Mesh {
    const m = new THREE.Mesh(quad(...pts, uvScale), mat);
    m.receiveShadow = true; m.castShadow = true;
    this.scene.add(m);
    this.occluders.push(m);
    this.camBlockers.push(m);
    return m;
  }

  private build(): void {
    const scene = this.scene;
    const { xMin, xMax, zMin, zMax, height: H, doorHalf } = APT;

    const parquet = parquetTextures();
    const floorMat = new THREE.MeshStandardMaterial({ map: parquet.map, roughnessMap: parquet.roughnessMap, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.6 });
    floorMat.map!.repeat.set(0.5, 0.5); floorMat.roughnessMap!.repeat.set(0.5, 0.5);
    this.floor = new THREE.Mesh(quad([xMin, 0, zMax], [xMax, 0, zMax], [xMax, 0, zMin], [xMin, 0, zMin]), floorMat);
    this.floor.receiveShadow = true;
    this.floor.name = 'floor';
    scene.add(this.floor);

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95, shadowSide: THREE.DoubleSide });
    const ceil = new THREE.Mesh(quad([xMin, H, zMin], [xMax, H, zMin], [xMax, H, zMax], [xMin, H, zMax]), ceilMat);
    ceil.receiveShadow = true; ceil.castShadow = true;
    scene.add(ceil);

    const wallLiving = new THREE.MeshStandardMaterial({ map: plasterTexture('#e6d6bd', 'rgba(120,90,60,0.5)'), roughness: 0.95, shadowSide: THREE.DoubleSide, envMapIntensity: 0.3 });
    const wallBed = new THREE.MeshStandardMaterial({ map: plasterTexture('#c9d6d0', 'rgba(60,90,80,0.5)'), roughness: 0.95, shadowSide: THREE.DoubleSide, envMapIntensity: 0.3 });
    wallLiving.map!.repeat.set(3, 1.5); wallBed.map!.repeat.set(3, 1.5);

    // South wall (z = zMax), faces inward (-z)
    this.addWall([[xMin, 0, zMax], [xMin, H, zMax], [0, H, zMax], [0, 0, zMax]], wallLiving);
    this.addWall([[0, 0, zMax], [0, H, zMax], [xMax, H, zMax], [xMax, 0, zMax]], wallBed);
    // West / East walls
    this.addWall([[xMin, 0, zMin], [xMin, H, zMin], [xMin, H, zMax], [xMin, 0, zMax]], wallLiving);
    this.addWall([[xMax, 0, zMax], [xMax, H, zMax], [xMax, H, zMin], [xMax, 0, zMin]], wallBed);

    // North wall with two window holes. Window: y in [0.9, 2.2], width 1.6, centred at -3.5 / 3.5.
    const win = { y0: 0.9, y1: 2.2, hw: 0.8 };
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.3 });
    const northSeg = (x0: number, x1: number, y0: number, y1: number, mat: THREE.Material) =>
      this.addWall([[x1, y0, zMin], [x1, y1, zMin], [x0, y1, zMin], [x0, y0, zMin]], mat);
    const windows: Array<[number, THREE.Material, number, number]> = [[-3.5, wallLiving, xMin, 0], [3.5, wallBed, 0, xMax]];
    for (const [cx, mat, x0, x1] of windows) {
      northSeg(x0, cx - win.hw, 0, H, mat);
      northSeg(cx + win.hw, x1, 0, H, mat);
      northSeg(cx - win.hw, cx + win.hw, 0, win.y0, mat);
      northSeg(cx - win.hw, cx + win.hw, win.y1, H, mat);
      const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      const fy = (win.y0 + win.y1) / 2, fh = win.y1 - win.y0;
      this.addBox(win.hw * 2 + 0.1, 0.06, 0.12, cx, win.y0, zMin, frameMat, { collide: false });
      this.addBox(win.hw * 2 + 0.1, 0.06, 0.12, cx, win.y1, zMin, frameMat, { collide: false });
      this.addBox(0.06, fh, 0.12, cx - win.hw, fy, zMin, frameMat, { collide: false });
      this.addBox(0.06, fh, 0.12, cx + win.hw, fy, zMin, frameMat, { collide: false });
      this.addBox(0.04, fh, 0.08, cx, fy, zMin, frameMat, { collide: false });
      this.addBox(win.hw * 2, 0.04, 0.08, cx, fy, zMin, frameMat, { collide: false });
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(win.hw * 2, fh),
        new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.12, roughness: 0.02, metalness: 0, envMapIntensity: 1.5 }));
      glass.position.set(cx, fy, zMin - 0.01);
      scene.add(glass);
      this.addBox(win.hw * 2 + 0.3, 0.05, 0.25, cx, win.y0 - 0.03, zMin + 0.1, frameMat, { collide: false });
      // Curtains: rail + two folded panels either side of the window.
      const curtainMat = new THREE.MeshStandardMaterial({ color: mat === wallLiving ? 0xb8574a : 0x6f7f9c, roughness: 0.9, side: THREE.DoubleSide });
      this.addBox(win.hw * 2 + 1.0, 0.03, 0.03, cx, win.y1 + 0.28, zMin + 0.16, black, { collide: false, cast: false });
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(curtainGeometry(0.45, win.y1 + 0.28 - 0.05), curtainMat);
        panel.position.set(cx + side * (win.hw + 0.28), (win.y1 + 0.28 + 0.05) / 2, zMin + 0.16);
        panel.castShadow = true; panel.receiveShadow = true;
        scene.add(panel);
      }
    }
    // Outer wall collision strips
    this.colliders.push({ minX: xMin - 1, maxX: xMin, minZ: zMin - 1, maxZ: zMax + 1 });
    this.colliders.push({ minX: xMax, maxX: xMax + 1, minZ: zMin - 1, maxZ: zMax + 1 });
    this.colliders.push({ minX: xMin - 1, maxX: xMax + 1, minZ: zMin - 1, maxZ: zMin });
    this.colliders.push({ minX: xMin - 1, maxX: xMax + 1, minZ: zMax, maxZ: zMax + 1 });

    // Interior wall with a door, double sided (two quads per segment)
    const t = 0.12;
    const wallMid = new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.9, shadowSide: THREE.DoubleSide });
    const segments: Array<[number, number]> = [[zMin, -doorHalf], [doorHalf, zMax]];
    for (const [z0, z1] of segments) {
      this.addWall([[-t / 2, 0, z0], [-t / 2, H, z0], [-t / 2, H, z1], [-t / 2, 0, z1]], wallMid);
      this.addWall([[t / 2, 0, z1], [t / 2, H, z1], [t / 2, H, z0], [t / 2, 0, z0]], wallMid);
      this.addBox(t, H, 0.06, 0, H / 2, z0 === zMin ? -doorHalf : doorHalf, wallMid, { collide: false });
      this.colliders.push({ minX: -t / 2 - 0.05, maxX: t / 2 + 0.05, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });
    }
    this.addBox(t, H - 2.1, doorHalf * 2, 0, (H + 2.1) / 2, 0, wallMid, { collide: false });
    this.addBox(t, 0.02, zMax - zMin, 0, H - 0.01, 0, wallMid, { collide: false, cast: false });

    // Skirting boards
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.7 });
    this.addBox(xMax - xMin, 0.08, 0.03, 0, 0.04, zMin + 0.015, skirtMat, { collide: false, cast: false });
    this.addBox(xMax - xMin, 0.08, 0.03, 0, 0.04, zMax - 0.015, skirtMat, { collide: false, cast: false });
    this.addBox(0.03, 0.08, zMax - zMin, xMin + 0.015, 0.04, 0, skirtMat, { collide: false, cast: false });
    this.addBox(0.03, 0.08, zMax - zMin, xMax - 0.015, 0.04, 0, skirtMat, { collide: false, cast: false });

    // Sky backdrop behind the windows
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ map: skyTexture() }));
    sky.position.set(0, 5, zMin - 6);
    scene.add(sky);
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1c0).multiplyScalar(3) }));
    sunDisc.position.set(4, 5.5, zMin - 5.9);
    scene.add(sunDisc);
    // distant houses + a tree line so the windows look out onto something
    const houseMat = new THREE.MeshBasicMaterial({ color: 0x8aa3c4 });
    for (let i = 0; i < 9; i++) {
      const hw = 1.2 + Math.random() * 1.8, hh = 1.5 + Math.random() * 2.5;
      const house = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, 0.5), houseMat);
      house.position.set(-9 + i * 2.3 + Math.random(), -0.4 + hh / 2, zMin - 5.5);
      scene.add(house);
    }
    const treeMat = new THREE.MeshBasicMaterial({ color: 0x5f8f6a });
    for (let i = 0; i < 14; i++) {
      const tree = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.4, 8, 6), treeMat);
      tree.position.set(-9 + i * 1.5, 0.3 + Math.random() * 0.4, zMin - 4.6);
      scene.add(tree);
    }

    // ----------------------------------------------------------- furniture
    const fabric = new THREE.MeshStandardMaterial({ color: 0x4f6d8f, roughness: 0.92, envMapIntensity: 0.25 });
    const cushionA = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.95 });
    const cushionB = new THREE.MeshStandardMaterial({ color: 0xb8574a, roughness: 0.95 });
    const rounded = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, r = 0.05, rot?: THREE.Euler): THREE.Mesh => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
      m.position.set(x, y, z); if (rot) m.rotation.copy(rot);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.78, envMapIntensity: 0.15 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3221, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.8 });
    const bedding = new THREE.MeshStandardMaterial({ color: 0xd8c8e8, roughness: 0.95 });

    // Sofa (living room, south wall) on legs: hide spot underneath.
    const sofaX = -4.2, sofaZ = 2.85;
    this.addBox(2.2, 0.35, 0.9, sofaX, 0.42, sofaZ, fabric);
    this.colliders.pop();
    this.colliders.push({ minX: sofaX - 1.1, maxX: sofaX + 1.1, minZ: sofaZ - 0.45, maxZ: sofaZ + 0.45, top: 0.6, sofa: true });
    rounded(2.2, 0.55, 0.25, sofaX, 0.85, sofaZ + 0.33, fabric, 0.06);
    rounded(0.25, 0.3, 0.9, sofaX - 1.0, 0.75, sofaZ, fabric, 0.06);
    rounded(0.25, 0.3, 0.9, sofaX + 1.0, 0.75, sofaZ, fabric, 0.06);
    // seat cushions + throw pillows
    rounded(1.0, 0.12, 0.8, sofaX - 0.52, 0.65, sofaZ - 0.02, fabric, 0.05);
    rounded(1.0, 0.12, 0.8, sofaX + 0.52, 0.65, sofaZ - 0.02, fabric, 0.05);
    rounded(0.42, 0.42, 0.12, sofaX - 0.6, 0.9, sofaZ + 0.16, cushionA, 0.05, new THREE.Euler(-0.15, 0, 0.1));
    rounded(0.42, 0.42, 0.12, sofaX + 0.55, 0.9, sofaZ + 0.16, cushionB, 0.05, new THREE.Euler(-0.15, 0, -0.08));
    // wall art above the sofa
    const frameDark = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.5 });
    this.addBox(0.9, 0.62, 0.03, sofaX, 1.9, zMax - 0.03, frameDark, { collide: false, cast: false });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.52), new THREE.MeshStandardMaterial({ map: makeCanvas(256, 160, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f3c98b'); g.addColorStop(1, '#c2603f'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff2c9'; ctx.beginPath(); ctx.arc(w * 0.68, h * 0.35, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a3a2a'; for (let i = 0; i < 5; i++) { ctx.fillRect(i * 55 + 10, h - 40 - i * 4, 35, 40 + i * 4); }
    }), roughness: 0.8 }));
    art.position.set(sofaX, 1.9, zMax - 0.05); art.rotation.y = Math.PI; scene.add(art);
    for (const dx of [-1, 1]) for (const dz of [-0.4, 0.4]) this.addBox(0.08, 0.25, 0.08, sofaX + dx, 0.125, sofaZ + dz, darkWood, { collide: false });
    this.furniture['sofa'] = { x: sofaX, z: sofaZ, w: 2.2, d: 0.9 };
    this.hideSpots.push({ x: sofaX, z: sofaZ - 0.55, name: 'under the sofa' });

    // Coffee table on a rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-4.0, 0.005, 1.1); rug.receiveShadow = true; scene.add(rug);
    this.addBox(1.1, 0.05, 0.6, -4.0, 0.42, 1.1, wood, { collide: false });
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.25, 0.25]) this.addBox(0.06, 0.4, 0.06, -4.0 + dx, 0.2, 1.1 + dz, darkWood, { collide: false });
    this.colliders.push({ minX: -4.55, maxX: -3.45, minZ: 0.8, maxZ: 1.4, top: 0.45 });
    this.furniture['table'] = { x: -4.0, z: 1.1, top: 0.45 };

    // TV stand + TV
    this.addBox(1.4, 0.5, 0.45, -1.5, 0.25, -3.2, darkWood, { occlude: false });
    this.addBox(1.1, 0.65, 0.05, -1.5, 0.85, -3.3, black, { collide: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), new THREE.MeshStandardMaterial({ color: 0x0d1220, roughness: 0.15, metalness: 0.2, envMapIntensity: 1.2 }));
    screen.position.set(-1.5, 0.85, -3.27); scene.add(screen);
    this.furniture['tvStand'] = { x: -1.5, z: -3.2, top: 0.5 };

    // Bookshelf (west wall)
    this.addBox(0.35, 2.0, 1.2, -5.8, 1.0, -1.5, wood, { occlude: true });
    const bookColors = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f];
    for (let i = 0; i < 4; i++) {
      const bookMat = new THREE.MeshStandardMaterial({ color: bookColors[i], roughness: 0.8 });
      this.addBox(0.25, 0.22, 0.2 + Math.random() * 0.4, -5.78, 0.55 + Math.floor(i / 2) * 0.6, -1.9 + (i % 2) * 0.55, bookMat, { collide: false });
    }
    // Plant in the corner
    this.addBox(0.35, 0.35, 0.35, -5.6, 0.175, 3.2, new THREE.MeshStandardMaterial({ color: 0xb35a2a }), { occlude: false });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f45, roughness: 0.75, side: THREE.DoubleSide });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2f, roughness: 0.8 });
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2, tilt = 0.55 + (i % 3) * 0.25, len = 0.45 + (i % 4) * 0.08;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, len, 5), stemMat);
      stem.position.set(-5.6 + Math.sin(a) * Math.sin(tilt) * len / 2, 0.35 + Math.cos(tilt) * len / 2, 3.2 + Math.cos(a) * Math.sin(tilt) * len / 2);
      stem.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
      scene.add(stem);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), leafMat);
      leaf.scale.set(1, 0.35, 1.8);
      leaf.position.set(-5.6 + Math.sin(a) * Math.sin(tilt) * len, 0.35 + Math.cos(tilt) * len, 3.2 + Math.cos(a) * Math.sin(tilt) * len);
      leaf.rotation.set(0, a, 0); leaf.castShadow = true;
      scene.add(leaf);
    }
    // Floor lamp by the sofa
    this.addBox(0.3, 0.03, 0.3, -2.4, 0.015, 3.15, black, { collide: false, cast: false });
    this.addBox(0.025, 1.5, 0.025, -2.4, 0.76, 3.15, black, { collide: false, cast: false });
    const floorShade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xffe9c8, emissive: 0xffc98a, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    floorShade.position.set(-2.4, 1.6, 3.15); scene.add(floorShade);
    const floorLight = new THREE.PointLight(0xffd9a0, 2.5, 4, 2);
    floorLight.position.set(-2.4, 1.55, 3.15); scene.add(floorLight);

    // Bed (bedroom): hide spot underneath.
    const bedX = 4.4, bedZ = -1.9;
    this.addBox(1.8, 0.25, 2.4, bedX, 0.42, bedZ, bedding).visible = false;
    this.colliders.pop();
    rounded(1.82, 0.26, 2.4, bedX, 0.42, bedZ, bedding, 0.08);
    rounded(1.7, 0.1, 1.3, bedX, 0.58, bedZ + 0.45, new THREE.MeshStandardMaterial({ color: 0x8f6f9e, roughness: 0.95 }), 0.05);
    this.colliders.push({ minX: bedX - 0.9, maxX: bedX + 0.9, minZ: bedZ - 1.2, maxZ: bedZ + 1.2, top: 0.55, bed: true });
    this.addBox(1.8, 0.12, 2.4, bedX, 0.24, bedZ, wood, { collide: false });
    this.addBox(1.8, 0.9, 0.1, bedX, 0.6, bedZ - 1.25, wood, { collide: false });
    rounded(0.6, 0.12, 0.38, bedX - 0.45, 0.6, bedZ - 0.9, white, 0.05);
    rounded(0.6, 0.12, 0.38, bedX + 0.45, 0.6, bedZ - 0.9, white, 0.05);
    for (const dx of [-0.8, 0.8]) for (const dz of [-1.1, 1.1]) this.addBox(0.08, 0.2, 0.08, bedX + dx, 0.1, bedZ + dz, darkWood, { collide: false });
    this.furniture['bed'] = { x: bedX, z: bedZ, top: 0.55 };
    this.hideSpots.push({ x: bedX - 1.1, z: bedZ + 0.3, name: 'under the bed' });

    // Nightstand + bedside lamp
    this.addBox(0.45, 0.5, 0.45, 2.4, 0.25, -3.2, wood, { occlude: false });
    this.furniture['nightstand'] = { x: 2.4, z: -3.2, top: 0.5 };
    this.addBox(0.12, 0.3, 0.12, 2.4, 0.65, -3.2, black, { collide: false });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xfff1c8, side: THREE.DoubleSide, emissive: 0x443311 }));
    shade.position.set(2.4, 0.9, -3.2); scene.add(shade);

    // Wardrobe (east wall) — tall, blocks sight
    this.addBox(0.6, 2.2, 1.6, 5.7, 1.1, 2.2, wood, { occlude: true });
    this.addBox(0.02, 1.9, 0.02, 5.39, 1.1, 2.2, black, { collide: false });

    // Desk + chair
    this.addBox(1.3, 0.04, 0.6, 2.2, 0.74, 3.1, white, { collide: false });
    for (const dx of [-0.6, 0.6]) this.addBox(0.05, 0.72, 0.55, 2.2 + dx, 0.36, 3.1, white, { collide: false });
    this.colliders.push({ minX: 1.55, maxX: 2.85, minZ: 2.8, maxZ: 3.4, top: 0.75 });
    this.furniture['desk'] = { x: 2.2, z: 3.1, top: 0.76 };
    this.addBox(0.45, 0.05, 0.45, 2.2, 0.45, 2.3, darkWood, { occlude: false });
    this.addBox(0.45, 0.5, 0.05, 2.2, 0.7, 2.5, darkWood, { collide: false });
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) this.addBox(0.04, 0.45, 0.04, 2.2 + dx, 0.22, 2.3 + dz, darkWood, { collide: false });
    this.addBox(0.35, 0.02, 0.25, 2.2, 0.77, 3.1, new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.6, roughness: 0.4 }), { collide: false });

    // Small bedroom rug
    const rug2 = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshStandardMaterial({ color: 0x8fb3a3, roughness: 1 }));
    rug2.rotation.x = -Math.PI / 2; rug2.position.set(2.6, 0.005, -0.6); rug2.receiveShadow = true; scene.add(rug2);

    // ----------------------------------------------------------- lighting
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x5a4634, 0.45));

    // Sun through the windows: directional light, shadow camera covers the flat.
    const sun = new THREE.DirectionalLight(0xffe4b8, 3.6);
    sun.position.set(3, 6, -9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;

    // Ceiling lamps: one spot per room with PCF shadow maps.
    this.lampPositions.push(new THREE.Vector3(-3, H - 0.25, 0), new THREE.Vector3(3, H - 0.25, 0));
    for (const p of this.lampPositions) {
      const spot = new THREE.SpotLight(0xffe2b8, 8, 9, 1.2, 0.7, 1.6);
      spot.position.copy(p);
      spot.target.position.set(p.x, 0, p.z);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0015;
      spot.shadow.normalBias = 0.02;
      spot.shadow.radius = 4;
      scene.add(spot); scene.add(spot.target);
      const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.18, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xfff7e0, emissive: 0xffd9a0, emissiveIntensity: 0.9, side: THREE.DoubleSide }));
      fixture.position.copy(p).add(new THREE.Vector3(0, 0.05, 0));
      scene.add(fixture);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2), black);
      cord.position.copy(p).add(new THREE.Vector3(0, 0.15, 0));
      scene.add(cord);
    }
  }

  /** Circle vs AABB push-out; mutates and returns the position. */
  resolveCollisions(pos: THREE.Vector3, radius: number): THREE.Vector3 {
    for (const c of this.colliders) {
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x += dx / d * (radius - d);
          pos.z += dz / d * (radius - d);
        } else {
          const left = pos.x - c.minX, right = c.maxX - pos.x, front = pos.z - c.minZ, back = c.maxZ - pos.z;
          const m = Math.min(left, right, front, back);
          if (m === left) pos.x = c.minX - radius;
          else if (m === right) pos.x = c.maxX + radius;
          else if (m === front) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
    return pos;
  }
}
