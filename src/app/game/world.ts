import * as THREE from 'three';
import { Collider, FurnitureSpot, HideSpot } from './types';

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

function parquetTexture(): THREE.CanvasTexture {
  return makeCanvas(512, 512, (ctx, w, h) => {
    const rows = 8, cols = 4;
    const ph = h / rows, pw = w / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * pw * 0.5;
      for (let c = -1; c < cols + 1; c++) {
        const hue = 28 + Math.random() * 8;
        const light = 44 + Math.random() * 10;
        ctx.fillStyle = `hsl(${hue} 45% ${light}%)`;
        ctx.fillRect(c * pw + off, r * ph, pw - 2, ph - 2);
        ctx.strokeStyle = `hsla(${hue} 40% ${light - 10}% / 0.35)`;
        for (let g = 0; g < 6; g++) {
          const y = r * ph + Math.random() * ph;
          ctx.beginPath(); ctx.moveTo(c * pw + off, y);
          ctx.lineTo(c * pw + off + pw, y + (Math.random() - 0.5) * 6); ctx.stroke();
        }
      }
    }
  });
}

function wallpaperTexture(base: string, stripe: string): THREE.CanvasTexture {
  return makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = stripe;
    for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 12, h);
  });
}

function rugTexture(): THREE.CanvasTexture {
  return makeCanvas(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a3b3b'; ctx.fillRect(0, 0, w, h);
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

    const floorMat = new THREE.MeshStandardMaterial({ map: parquetTexture(), roughness: 0.55, metalness: 0.05 });
    floorMat.map!.repeat.set(3, 1.75);
    this.floor = new THREE.Mesh(quad([xMin, 0, zMax], [xMax, 0, zMax], [xMax, 0, zMin], [xMin, 0, zMin]), floorMat);
    this.floor.receiveShadow = true;
    this.floor.name = 'floor';
    scene.add(this.floor);

    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95, shadowSide: THREE.DoubleSide });
    const ceil = new THREE.Mesh(quad([xMin, H, zMin], [xMax, H, zMin], [xMax, H, zMax], [xMin, H, zMax]), ceilMat);
    ceil.receiveShadow = true; ceil.castShadow = true;
    scene.add(ceil);

    const wallLiving = new THREE.MeshStandardMaterial({ map: wallpaperTexture('#e8dcc4', '#e0d2b6'), roughness: 0.9, shadowSide: THREE.DoubleSide });
    const wallBed = new THREE.MeshStandardMaterial({ map: wallpaperTexture('#cfd9d3', '#c4cfc8'), roughness: 0.9, shadowSide: THREE.DoubleSide });
    wallLiving.map!.repeat.set(2, 1); wallBed.map!.repeat.set(2, 1);

    // South wall (z = zMax), faces inward (-z)
    this.addWall([[xMin, 0, zMax], [xMin, H, zMax], [0, H, zMax], [0, 0, zMax]], wallLiving);
    this.addWall([[0, 0, zMax], [0, H, zMax], [xMax, H, zMax], [xMax, 0, zMax]], wallBed);
    // West / East walls
    this.addWall([[xMin, 0, zMin], [xMin, H, zMin], [xMin, H, zMax], [xMin, 0, zMax]], wallLiving);
    this.addWall([[xMax, 0, zMax], [xMax, H, zMax], [xMax, H, zMin], [xMax, 0, zMin]], wallBed);

    // North wall with two window holes. Window: y in [0.9, 2.2], width 1.6, centred at -3.5 / 3.5.
    const win = { y0: 0.9, y1: 2.2, hw: 0.8 };
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
        new THREE.MeshPhysicalMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0 }));
      glass.position.set(cx, fy, zMin - 0.01);
      scene.add(glass);
      this.addBox(win.hw * 2 + 0.3, 0.05, 0.25, cx, win.y0 - 0.03, zMin + 0.1, frameMat, { collide: false });
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
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }));
    sky.position.set(0, 5, zMin - 6);
    scene.add(sky);
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }));
    sunDisc.position.set(4, 5.5, zMin - 5.9);
    scene.add(sunDisc);

    // ----------------------------------------------------------- furniture
    const fabric = new THREE.MeshStandardMaterial({ color: 0x4f6d8f, roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3221, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.8 });
    const bedding = new THREE.MeshStandardMaterial({ color: 0xd8c8e8, roughness: 0.95 });
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.3 });

    // Sofa (living room, south wall) on legs: hide spot underneath.
    const sofaX = -4.2, sofaZ = 2.85;
    this.addBox(2.2, 0.35, 0.9, sofaX, 0.42, sofaZ, fabric);
    this.colliders.pop();
    this.colliders.push({ minX: sofaX - 1.1, maxX: sofaX + 1.1, minZ: sofaZ - 0.45, maxZ: sofaZ + 0.45, top: 0.6, sofa: true });
    this.addBox(2.2, 0.55, 0.25, sofaX, 0.85, sofaZ + 0.33, fabric, { collide: false });
    this.addBox(0.25, 0.3, 0.9, sofaX - 1.0, 0.75, sofaZ, fabric, { collide: false });
    this.addBox(0.25, 0.3, 0.9, sofaX + 1.0, 0.75, sofaZ, fabric, { collide: false });
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
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), new THREE.MeshBasicMaterial({ color: 0x2b3a6b }));
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
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2e8b3d, roughness: 0.9 }));
    leaves.position.set(-5.6, 0.75, 3.2); leaves.castShadow = true; scene.add(leaves);

    // Bed (bedroom): hide spot underneath.
    const bedX = 4.4, bedZ = -1.9;
    this.addBox(1.8, 0.25, 2.4, bedX, 0.42, bedZ, bedding);
    this.colliders.pop();
    this.colliders.push({ minX: bedX - 0.9, maxX: bedX + 0.9, minZ: bedZ - 1.2, maxZ: bedZ + 1.2, top: 0.55, bed: true });
    this.addBox(1.8, 0.12, 2.4, bedX, 0.24, bedZ, wood, { collide: false });
    this.addBox(1.8, 0.9, 0.1, bedX, 0.6, bedZ - 1.25, wood, { collide: false });
    this.addBox(0.6, 0.1, 0.35, bedX - 0.45, 0.6, bedZ - 0.9, white, { collide: false });
    this.addBox(0.6, 0.1, 0.35, bedX + 0.45, 0.6, bedZ - 0.9, white, { collide: false });
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
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x5a4634, 0.75));

    // Sun through the windows: directional light, shadow camera covers the flat.
    const sun = new THREE.DirectionalLight(0xfff2d6, 3.2);
    sun.position.set(3, 6, -9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;

    // Ceiling lamps: one spot per room with PCF shadow maps.
    this.lampPositions.push(new THREE.Vector3(-3, H - 0.25, 0), new THREE.Vector3(3, H - 0.25, 0));
    for (const p of this.lampPositions) {
      const spot = new THREE.SpotLight(0xffe2b8, 9, 9, 1.15, 0.5, 1.6);
      spot.position.copy(p);
      spot.target.position.set(p.x, 0, p.z);
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0015;
      spot.shadow.normalBias = 0.02;
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
