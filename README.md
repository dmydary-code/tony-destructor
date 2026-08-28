# Tony: Copper Menace — Angular + TypeScript

A 3D WebGL stealth-mischief game about Tony, a copper dachshund. Angular 21 (standalone components, signals, zoneless change detection) + Three.js + hand-written GLSL.

## Run

```bash
npm install
npm start          # ng serve → http://localhost:4200
npm run build      # production build → dist/tony-ng/browser
```

Node ≥ 22.12 required.

## Architecture

```
src/app/
├── game/                  # framework-free engine (plain TS, no Angular imports)
│   ├── types.ts           # GameUi bridge interface, shared types
│   ├── shaders.ts         # hand-written GLSL: fur, chew displacement, puddle reflection, particles
│   ├── world.ts           # World class: BufferGeometry apartment, lights, collisions, occluders
│   ├── tony.ts            # Tony class: model, movement, procedural animation
│   ├── human.ts           # Human class: waypoint AI state machine, vision cone raycasts, slippers
│   ├── items.ts           # ChewItem, Puddle, PlanarReflection (mirrored camera + oblique clipping), particles
│   ├── audio.ts           # Web Audio synth (no sound files)
│   └── engine.ts          # GameEngine: game rules, scoring, input, render loop
├── game.service.ts        # owns the engine, mirrors GameUi callbacks into signals
├── ui/
│   ├── hud.component.ts   # score / bladder / prompts / log / speech bubbles (renders from signals)
│   └── start-screen.component.ts
└── app.ts                 # canvas host, engine lifecycle
```

The engine never touches Angular: it reports to the `GameUi` interface, which
`GameService` implements with signals. Components render purely from those
signals under zoneless change detection; the render loop runs in
`renderer.setAnimationLoop` outside any framework machinery.

## Headless smoke test

```bash
npm run build
node test-ng.js    # needs `npm i -D playwright` + a Chromium; drives steal → hide → chew → puddle → slip
```

`window.__tony` exposes the engine in the console for debugging
(`__tony.dtScale = 4` speeds up time, `__tony.bladder = 1` fills the meter).

## Controls

WASD — run · mouse drag — orbit camera · wheel — zoom · E — grab / steal (hold) / hide / drop · F (hold) — chew · Q — pee when the bladder is full.
