# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

Keep `AGENTS.md` and `README.md` up-to-date whenever you modify the project.

Note that `AGENTS.md` is a high-level overview. Keep updates brief and conceptual and do not simply restate implementation details. Agents should read the code and comments for more information.

## Commands

The repo is an npm workspace with two packages: `app` (the Vite UI) and `sim` (the Rust/Wasm physics engine). Root scripts fan out across both; target one with `--workspace=...`.

```bash
npm install         # Install dependencies
npm run dev         # Dev server (builds Wasm first, then starts Vite)
npm run build       # Production build
npm run preview     # Preview production build
npm run fmt         # Format
npm run lint        # Lint
npm run check       # Type-check (note: sim bindings must be built first to pass app type-check)
```

There are no tests. The Rust `wasm32-unknown-unknown` target must be installed for any script that touches the Wasm crate, including `lint` and `check`. `wasm-pack` installs the target automatically, and CI adds it explicitly.

The app imports the physics engine as a normal workspace package (`import … from "sim"`). The `sim` package's `package.json` points at its generated `pkg/` output.

## Architecture

A browser-based multi-ball pong simulation where each ball paints the grid with its team color. Physics runs in a **Web Worker** backed by a **Rust/Wasm** engine, keeping the main thread free for rendering.

### Data flow

```
main thread                                   Web Worker
──────────────────────────────                ──────────────────────────────
main.ts  ────[reset / tick]───────────────────► worker.ts
                                                  │  Rust Simulation (sim)
                                                  │    tick_n(n)
                                                  │    get_pixels()     → Uint8ClampedArray (RGBA)
                                                  │    get_ball_pos_x() → Float32Array
                                                  │    get_ball_pos_y() → Float32Array
 ◄──────────────[frame: epoch + Frame]────────────┘  (transferred zero-copy)
canvas.ts  draws frame
```

- `app/src/main.ts` — orchestration layer. Wires the singletons together and drives the per-frame loop. Each animation frame asks for the next frame *before* drawing the one that arrived, so the worker computes while the main thread draws. When settings are modified, the loop posts at most one reset per frame.
- `app/src/worker.ts` — thin wrapper; translates `reset` and `tick` messages into Rust `Simulation` calls and transfers results back zero-copy.
- `app/src/protocol.ts` — the message types shared by both sides of the worker boundary.
- `app/src/sidebar.ts` — `Sidebar` singleton. Owns the sidebar panel: the simulation control buttons, the settings sliders, and the FPS counter. Tracks the `SimState` (`preview | running | paused`), exposes the live setting values, and fires an `onReset` hook when the simulation must reinitialize.
- `app/src/canvas.ts` — `Canvas` singleton. Draws a `Frame` by writing the grid to a pixel-sized canvas and overlaying transparent ball strokes on a second canvas, keeping the ball layer in sync with the CSS-rendered size via a `ResizeObserver`.
- `sim/src/lib.rs` — the physics engine. `Simulation` stores the grid as a flat RGBA pixel `Vec` (plus ball positions and velocities as flat `Vec`s) in grid-space, and owns the team color palette. Each tick runs three passes over all balls in turn: move → wall-bounce → cell-collision.

### Layout and canvas sizing

A minimalist `#header` (title and attribution links) sits at the top of the `body`, with the canvas and sidebar panel below in an `#app` flex container. A media query in `styles.css` flips the `#app` layout between **side-by-side** (landscape) and **stacked** (portrait), and the square canvas is sized to fit the viewport with room reserved for both the header and the panel.

### Coordinate space

All physics operates in **grid-space** (1 unit = 1 cell). `canvas.ts` converts to pixel-space.

### TypeScript

`app` splits its TypeScript into three programs via project references, because the environments need conflicting global types.

- `tsconfig.app.json` — the browser code in `src` (DOM lib, `vite/client` types). Excludes `worker.ts`.
- `tsconfig.worker.json` — `worker.ts` alone (WebWorker lib, no `@types`).
- `tsconfig.node.json` — the Node config files (`*.config.ts`, `@types/node`).

`npm run check` runs `tsc --build`, which type-checks all programs. Ensure correctness by type-checking after edits.

### Vite base path

`app/vite.config.ts` sets `base: '/pong-wars/'` for GitHub Pages deployment. Reference static assets via `import` or `new URL(…, import.meta.url)` — Vite rewrites those paths automatically. Hardcoded URL strings in JS/TS are not rewritten and will break under the subpath.

## Deployment

`.github/workflows/ci.yml` runs checks on every PR and every push to `main`.
`.github/workflows/cd.yml` deploys to GitHub Pages on every push to `main`.
