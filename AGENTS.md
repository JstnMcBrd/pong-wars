# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

Keep `AGENTS.md` and `README.md` up-to-date whenever you modify the project.

## Commands

```bash
# Full project
npm install         # Install JS dependencies
npm run dev         # Dev server (builds Wasm first, then starts Vite)
npm run build       # Production build
npm run preview     # Preview production build

# UI
npm run fmt         # Format
npm run lint        # Lint
npm run check       # Type-check

# Worker
cd worker
cargo fmt           # Format
cargo clippy        # Lint
cargo check         # Compile-check
```

There are no tests. The Rust `wasm32-unknown-unknown` target must be installed for any build that touches the Wasm crate.

## Architecture

A browser-based multi-ball pong simulation where each ball paints the grid with its team color. Physics runs in a **Web Worker** backed by a **Rust/Wasm** engine, keeping the main thread free for rendering.

### Data flow

```
main thread                       Web Worker
──────────────────────────────    ──────────────────────────────
main.ts  ────[reset / tick]──────► worker.ts
                                      │  Rust Simulation (worker)
                                      │    tick_n(n)
                                      │    get_grid()           → Uint16Array
                                      │    get_ball_positions() → Float32Array
 ◄──[frame: grid, cols, rows, balls]──┘  (transferred zero-copy)
canvas.ts  draws frame
```

- `main.ts` — orchestration layer. Wires the singletons together via callbacks and reads `sidebar.state` / `sidebar.ticksPerFrame` each frame. Sends one `tick` per frame; back-pressure via `workerBusy` flag. `resetWorker()` sends a `reset` message to reinitialize the simulation.
- `worker.ts` — thin wrapper; translates `reset` and `tick` messages into Rust `Simulation` calls and transfers results back zero-copy.
- `sidebar.ts` — `Sidebar` singleton. Owns the entire sidebar panel: the simulation control buttons (start/stop/pause/resume, in the `#controls` row), the settings sliders, and the FPS counter. Tracks `SimState` (`preview | running | paused`), transitions it on button clicks, and locks the reset-required sliders (teams, size) while the sim is active. Exposes a readonly `state` getter, DOM-backed `numTeams` / `gridSize` / `ticksPerFrame` getters (bounds/defaults in module-level `BOUNDS` / `DEFAULTS`), a single `onReset(cb)` hook fired whenever the worker must reinitialize (stop, or a reset-required slider change in preview), and a `recordFrame()` method called by `main.ts` each time the canvas is painted. A `setInterval` fires every second to write the accumulated frame count to the FPS counter and reset it; when the sim is not running the interval is stopped and the counter's `textContent` is cleared to an empty string.
- `canvas.ts` — `Canvas` singleton. Renders frames via a 1px-per-cell `OffscreenCanvas` scaled up with `drawImage`. A `ResizeObserver` syncs buffer resolution with the CSS-rendered size and redraws on resize. `draw(grid, cols, rows, balls)` reconfigures the offscreen canvas and team colors lazily when dimensions or team count change.
- `worker/src/lib.rs` — the physics engine. `Simulation` stores grid, positions, and directions as flat `Vec`s in grid-space. Each tick: move → wall-bounce → cell-collision.

### Layout and canvas sizing

The canvas and sidebar panel live in an `#app` flex container. A `min-aspect-ratio: 1/1` media query in `styles.css` flips it between **side-by-side** (panel right of the canvas, stretched to its height — when the page is landscape) and **stacked** (panel below the canvas — when portrait). The square `--canvas-size` is computed per layout as a `min()` of the two viewport bounds, reserving room for the panel (`--panel-w` side-by-side, `--panel-h` stacked) plus padding and gap. The buffer resolution is kept in sync with the CSS-rendered size by a `ResizeObserver` in `canvas.ts`.

### Coordinate space

All physics operates in **grid-space** (1 unit = 1 cell). `canvas.ts` converts to pixel-space. `TICK_VELOCITY` and `BALL_RADIUS` are both `0.45` grid units — chosen so the bounding box covers at most 4 cells per tick, preventing tunnelling.

### TypeScript strictness

`tsconfig.json` enables a large set of strict checks. Ensure correctness by type-checking after edits.

### Vite base path

`vite.config.ts` sets `base: '/pong-wars/'` for GitHub Pages deployment. Reference static assets via `import` or `new URL(…, import.meta.url)` — Vite rewrites those paths automatically. Hardcoded URL strings in JS/TS are not rewritten and will break under the subpath.

## Deployment

`.github/workflows/ci.yml` runs checks on every PR and every push to `main`.
`.github/workflows/cd.yml` deploys to GitHub Pages on every push to `main`.
