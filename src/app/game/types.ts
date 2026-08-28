import * as THREE from 'three';

/** Uniforms shared by every hand-written shader (fur, chewables). */
export interface LightUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uLampPos: { value: THREE.Vector3[] };
  uLampColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color };
  uGroundColor: { value: THREE.Color };
  [uniform: string]: THREE.IUniform;
}

/** Axis-aligned collision box on the XZ plane. */
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top?: number;
  sofa?: boolean;
  bed?: boolean;
}

/** A place where Tony can stash a stolen slipper. */
export interface HideSpot {
  x: number;
  z: number;
  name: string;
}

export interface FurnitureSpot {
  x: number;
  z: number;
  w?: number;
  d?: number;
  top?: number;
}

export type LogClass = 'good' | 'bad' | 'super' | '';

export interface Bubble {
  x: number;
  y: number;
  text: string;
}

export interface HumanStatus {
  name: string;
  doing: string;
}

/**
 * Bridge between the framework-free engine and the Angular HUD.
 * The engine only ever talks to this interface; GameService implements it with signals.
 */
export interface GameUi {
  setScore(score: number): void;
  setBladder(value: number): void;
  setSeen(on: boolean): void;
  setPrompt(text: string): void;
  setProgress(frac: number | null, label?: string): void;
  log(text: string, cls?: LogClass): void;
  toast(text: string, cls?: string): void;
  setStatus(humans: HumanStatus[]): void;
  setBubbles(list: Bubble[]): void;
}

/** Keyboard state sampled by the engine every frame. */
export interface InputState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  e: boolean;
  f: boolean;
  q: boolean;
  ePressed: boolean;
  qPressed: boolean;
}
