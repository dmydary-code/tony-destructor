// Hand-written GLSL (WebGL GLSL ES 1.0) wrapped by THREE.ShaderMaterial.
// Ported 1:1 from the JS version; template literals compose shared chunks.

export const NOISE_GLSL = /* glsl */`
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
          mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
          mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise3(p); p *= 2.02; a *= 0.5; }
    return v;
  }
`;

// Shared lighting: hemisphere ambient + one directional "sun" + two spot-ish
// point lamps with inverse-square falloff, Blinn-Phong specular.
export const LIGHTING_GLSL = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uLampPos[2];
  uniform vec3 uLampColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;

  vec3 shade(vec3 N, vec3 V, vec3 worldPos, vec3 albedo, float shininess, float specStrength) {
    // hemisphere ambient
    float hemi = 0.5 + 0.5 * N.y;
    vec3 col = albedo * mix(uGroundColor, uSkyColor, hemi);
    // sun (directional)
    float nds = max(dot(N, uSunDir), 0.0);
    vec3 H = normalize(uSunDir + V);
    col += albedo * uSunColor * nds * 0.6;
    col += uSunColor * specStrength * pow(max(dot(N, H), 0.0), shininess) * nds;
    // lamps (point, inverse square)
    for (int i = 0; i < 2; i++) {
      vec3 L = uLampPos[i] - worldPos;
      float d2 = dot(L, L);
      L = normalize(L);
      float att = 9.0 / (1.0 + d2);
      float ndl = max(dot(N, L), 0.0);
      vec3 Hl = normalize(L + V);
      col += albedo * uLampColor * ndl * att;
      col += uLampColor * specStrength * pow(max(dot(N, Hl), 0.0), shininess) * att * ndl;
    }
    return col;
  }
`;

// ---- Copper fur shader for Tony ------------------------------------------
export const FUR_VERT = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  void main() {
    vObjPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const FUR_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;       // copper
  uniform vec3 uBelly;       // lighter underside
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  ${NOISE_GLSL}
  ${LIGHTING_GLSL}
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    // fur strands: high-frequency noise darkens/lightens tiny streaks
    float strands = noise3(vObjPos * vec3(60.0, 14.0, 60.0)) * 0.6 + noise3(vObjPos * 9.0) * 0.4;
    float belly = smoothstep(-0.2, -0.9, N.y);
    vec3 albedo = mix(uColor, uBelly, belly) * (0.88 + 0.22 * strands);
    vec3 col = shade(N, V, vWorldPos, albedo, 12.0, 0.12);
    // ambient occlusion baked into the shape: darker underside and between the legs
    col *= 0.7 + 0.3 * smoothstep(-0.6, 0.6, N.y);
    // velvet rim: soft, warm sheen along the silhouette (fur catching the light)
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += rim * vec3(1.0, 0.6, 0.35) * 0.22;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Chewable object shader: vertex displacement by "chew" amount --------
export const CHEW_VERT = /* glsl */`
  uniform float uChew;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  varying float vChewMask;
  ${NOISE_GLSL}
  void main() {
    vObjPos = position;
    // Bite pattern: noise decides which parts get chewed away first.
    float n = fbm3(position * 9.0 + uSeed);
    float bite = smoothstep(0.35, 0.75, n);
    vChewMask = bite * uChew;
    // Push chewed vertices inwards (and slightly randomly) so the silhouette crumples.
    vec3 displaced = position - normal * 0.09 * vChewMask
                     + (vec3(noise3(position * 30.0 + uSeed), noise3(position * 30.0 + 7.0), noise3(position * 30.0 + 13.0)) - 0.5) * 0.06 * uChew;
    vec4 wp = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const CHEW_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform float uChew;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  varying float vChewMask;
  ${NOISE_GLSL}
  ${LIGHTING_GLSL}
  void main() {
    // Holes: the most chewed parts are discarded entirely.
    float holes = fbm3(vObjPos * 14.0 + uSeed * 3.0);
    if (holes < uChew * 0.55 - 0.05) discard;
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorldPos);
    // chewed surfaces look torn: darker and rougher
    vec3 albedo = mix(uColor, uColor * 0.45, vChewMask);
    vec3 col = shade(N, V, vWorldPos, albedo, 16.0, 0.15);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Puddle shader with planar reflection --------------------------------
export const PUDDLE_VERT = /* glsl */`
  uniform mat4 uTextureMatrix;
  varying vec4 vReflUv;
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  void main() {
    vLocal = position.xy;              // plane is built in XY, rotated flat
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vReflUv = uTextureMatrix * wp;     // projective texture coords into the reflection RT
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const PUDDLE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tReflection;
  uniform float uTime;
  uniform float uSize;     // 0..1 growth
  uniform float uSeed;
  uniform vec3 uTint;
  varying vec4 vReflUv;
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  ${NOISE_GLSL}
  void main() {
    // irregular blob: radius modulated by angle noise
    float ang = atan(vLocal.y, vLocal.x);
    float r = length(vLocal);
    float edge = 0.32 + 0.12 * noise3(vec3(cos(ang), sin(ang), uSeed) * 2.5);
    edge *= uSize;
    float inside = 1.0 - smoothstep(edge - 0.03, edge, r);
    if (inside <= 0.001) discard;

    // small ripples distort the reflection lookup
    float ripple = noise3(vec3(vWorldPos.xz * 6.0, uTime * 0.7)) - 0.5;
    vec4 uv4 = vReflUv;
    uv4.xy += ripple * 0.03 * uv4.w;
    vec3 refl = texture2DProj(tReflection, uv4).rgb;

    // fresnel: more reflection at grazing angles
    vec3 V = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - max(V.y, 0.0), 2.0);
    float reflAmount = mix(0.55, 0.9, fres);

    vec3 base = uTint;
    vec3 col = mix(base, refl, reflAmount);
    // subtle wet highlight
    col += vec3(1.0, 0.95, 0.7) * pow(max(dot(reflect(-V, vec3(0,1,0)), normalize(vec3(0.3, 1.0, 0.2))), 0.0), 40.0) * 0.5;
    float alpha = inside * 0.7;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---- Sparkle particles (points) -------------------------------------------
export const SPARK_VERT = /* glsl */`
  uniform float uSize;
  attribute float aLife;   // 1 → 0
  attribute vec3 aColor;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * min(28.0, (5.0 + 9.0 * aLife) * (40.0 / max(-mv.z, 0.5)));
    gl_Position = projectionMatrix * mv;
  }
`;

export const SPARK_FRAG = /* glsl */`
  precision mediump float;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * vLife;
    gl_FragColor = vec4(vColor, a);
  }
`;
