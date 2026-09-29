import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Vignette + gentle warm colour grade, applied after tone mapping. */
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.42 },
    uWarmth: { value: 0.035 },
    uSaturation: { value: 1.08 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uWarmth;
    uniform float uSaturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // warm highlights / slightly cool shadows
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += vec3(uWarmth, uWarmth * 0.4, -uWarmth) * (l - 0.5);
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      // vignette
      vec2 d = vUv - 0.5;
      float v = 1.0 - smoothstep(0.35, 0.95, dot(d, d) * 2.2) * uVignette;
      gl_FragColor = vec4(c.rgb * v, c.a);
    }
  `,
};

/**
 * Post-processing chain: scene → ambient occlusion (GTAO) → soft bloom on the
 * lamps/windows → tone mapping → colour grade + vignette → SMAA anti-aliasing.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const w = size.x, h = size.y;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.2, thickness: 0.6, scale: 1.2, samples: 12 });
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.9;
    this.composer.addPass(this.gtao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.6, 0.88);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());          // tone mapping + sRGB
    this.composer.addPass(new ShaderPass(GRADE_SHADER)); // grade in display space
    this.composer.addPass(new SMAAPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }
}
