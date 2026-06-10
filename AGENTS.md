# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

Keep `AGENTS.md` and `README.md` up-to-date whenever you modify the project.

## Commands

```bash
npm install         # Install JS dependencies
npm run type-check  # Type-check TypeScript
npm run dev         # Dev server (builds Wasm first, then starts Vite)
npm run build       # Production build
npm run preview     # Preview production build
```

There are no tests. The Rust `wasm32-unknown-unknown` target must be installed for any build that touches the Wasm crate.

## Architecture

A browser-based multi-ball pong simulation where each ball paints the grid with its team color. Physics runs in a **Web Worker** backed by a **Rust/Wasm** engine, keeping the main thread free for rendering.

### Data flow

```
main thread                       Web Worker
──────────────────────────────    ──────────────────────────────
main.ts  ────[reset / tick]──────► worker.ts
                                      │  Rust Simulation (physics-wasm)
                                      │    tick_n(n)
                                      │    get_grid()           → Uint16Array
                                      │    get_ball_positions() → Float32Array
 ◄──[frame: grid, cols, rows, balls]──┘  (transferred zero-copy)
canvas.ts  draws frame
```

- `main.ts` — orchestration layer. Wires the three singletons together via callbacks and reads `controls.state` each frame. Sends one `tick` per frame; back-pressure via `workerBusy` flag. `resetWorker()` sends a `reset` message to reinitialize the simulation.
- `worker.ts` — thin wrapper; translates `reset` and `tick` messages into Rust `Simulation` calls and transfers results back zero-copy.
- `controls.ts` — `Controls` singleton. Owns `SimState` (`preview | running | paused`), transitions it on button clicks, exposes a readonly `state` getter, and surfaces `onStart(cb)` / `onStop(cb)` hooks.
- `canvas.ts` — `Canvas` singleton. Renders frames via a 1px-per-cell `OffscreenCanvas` scaled up with `drawImage`. A `ResizeObserver` syncs buffer resolution with the CSS-rendered size and redraws on resize. `draw(grid, cols, rows, balls)` reconfigures the offscreen canvas and team colors lazily when dimensions or team count change.
- `settings.ts` — `Settings` singleton. Exposes `numTeams`, `gridSize`, `ticksPerFrame` as DOM-backed getters (reading slider values directly). Bounds and defaults in module-level `BOUNDS` / `DEFAULTS` constants. Provides `lock()`, `unlock()`, and `onChange(cb)`.
- `physics-wasm/src/lib.rs` — the physics engine. `Simulation` stores grid, positions, and directions as flat `Vec`s in grid-space. Each tick: move → wall-bounce → cell-collision.

### Canvas sizing

Canvas dimensions are driven by CSS custom properties in `styles.css`, producing a square that fills the viewport with room for the controls bar. The buffer resolution is kept in sync by a `ResizeObserver` in `canvas.ts`.

### Coordinate space

All physics operates in **grid-space** (1 unit = 1 cell). `canvas.ts` converts to pixel-space. `TICK_VELOCITY` and `BALL_RADIUS` are both `0.45` grid units — chosen so the bounding box covers at most 4 cells per tick, preventing tunnelling.

### TypeScript strictness

`tsconfig.json` enables a large set of strict checks. Ensure correctness by type-checking after edits.

### Vite base path

`vite.config.ts` sets `base: '/pong-wars/'` for GitHub Pages deployment. Asset URLs in code must be root-relative (`/src/…`) not bare relative paths, or Vite will handle them correctly via `import`.

## Deployment

`.github/workflows/cd.yml` deploys to GitHub Pages on every push to `main`.
