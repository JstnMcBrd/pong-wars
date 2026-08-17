# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

Keep `AGENTS.md` and `README.md` up-to-date whenever you modify the project.

Note that `AGENTS.md` is a high-level overview. Keep updates brief and conceptual and do not simply restate implementation details. Agents should read the code and comments for more information.

High-level descriptions should only be updated when they become inaccurate due to large changes, and your updates should not increase the overall level of detail.

## Commands

```bash
npm install         # Install dependencies
npm run dev         # Dev server
npm run build       # Production build
npm run preview     # Preview production build
npm run fmt         # Format
npm run lint        # Lint
npm run check       # Type-check
```

There are no tests. Verifying a change means running the app in a browser — and for shader changes that is the _only_ check. See "Shaders".

## Architecture

A browser-based multi-ball pong simulation where each ball paints the grid with its team color.
Both the physics and the rendering run on the GPU through **WebGPU**; the main thread only encodes commands.

### Data flow

```
reset()  ─► init_grid  ──┐
         ─► init_balls ──┤
                         ▼
              grid buffer + ball buffer      (never leave the GPU)
                         ▲           │
render() ─► sim ─────────┘           │       compute pass, skipped while paused
         ─► grid quad + ball quads ◄─┘       render pass
```

### Files

- `src/main.ts` — bootstrap and the frame loop. Acquires the device, builds the sidebar, seeds the engine, then drives one `Engine.render()` per animation frame. Resets are coalesced to at most one per frame. Falls back to a failure message if WebGPU cannot be set up.
- `src/gpu.ts` — the GPU front door. Acquires an adapter and device, and requests the adapter's best compute limits. Throws `GpuError` when WebGPU is unavailable.
- `src/engine.ts` — owns every device resource: four uniform buffers, the grid and ball storage buffers, three bind group layouts, and five pipelines. `reset()` reallocates the simulation state and seeds it; `render()` encodes one optional compute pass plus one render pass into a single command buffer.
- `src/sidebar.ts` — `Sidebar` class. Owns the sidebar panel: the simulation control buttons, the settings sliders, and the FPS counter. Tracks the `SimState` (`preview | running | paused`), exposes the live setting values, and fires an `onReset` hook when the simulation must reinitialize.
- `shaders/main.wgsl` — the physics and the renderer, in one module.

### The one thing to understand before changing the physics

Ticks are strictly sequential, so the only parallelism available is across balls. `sim` is therefore dispatched as a **single workgroup** that loops over every tick internally and calls `storageBarrier()` between them. That barrier only orders writes within one workgroup, so dispatching more than one would read a half-finished tick — `dispatchWorkgroups(1)` is deliberate.

Within a tick the balls run concurrently, so a ball sees the grid as of the start of the tick rather than mid-tick writes from other balls, and two balls claiming the same cell resolve last-write-wins. **The simulation is not reproducible**, by design.

### Bindings

`@group(0)` is the settings — four small uniform buffers, one per setting, created once and never rebuilt. `@group(1)` is the simulation state, reallocated by `reset()` whenever the grid size or team count changes.

Read-only aliases are declared for the `@group(1)` buffers to allow the vertex and fragment stages to read them. Two variables may share one binding as long as no single entry point uses both. The compute pipelines bind those buffers through a `storage` layout, the render pipelines through a `read-only-storage` layout, over the same memory.

Binding numbers are written out in both the shader and `engine.ts`, and nothing checks that the two agree. After touching either list, read them side by side.

### Shaders

Everything lives in one module, `shaders/main.wgsl`, imported by `engine.ts` with Vite's built-in `?raw`. WGSL has no module system, so one file is what lets the physics and the renderer share declarations.

> If you need separate shaders with module imports in the future, investigate WESL.

**Nothing validates or formats the shader.** `oxfmt` and `oxlint` ignore `.wgsl`, and the build only copies the file into the bundle as a string, so a broken shader passes every automated check and fails at `createShaderModule` when the page loads. After any shader edit, run the app and watch the console.

Debugging is thin by nature: there is no way to print from a shader. The two techniques that work are copying a storage buffer back to the CPU through a `MAP_READ` staging buffer, and temporarily returning a suspect value as a color from a fragment entry point.

### Coordinate space

All physics operates in **grid-space** (1 unit = 1 cell). The shaders convert to clip space.

### Limits

The grid-size slider's maximum is either the largest buffer the device can hold, or `MAX_GRID_SIZE_CAP` in `sidebar.ts`, whichever is lowest.

The minimum storage-buffer binding limit every conformant adapter must provide is 128 MB, which could hold a grid of ~5,700². To raise the grid-size limit even higher, a higher `maxStorageBufferBindingSize` would need to be requested in `gpu.ts`, and the grid would have to be split across several bindings.

Workgroup sizes are not hardcoded. `gpu.ts` requests the adapter's best compute limits, and `engine.ts` derives each workgroup size from them and supplies it as a shader `override`, then derives the dispatch count from that size and the item count. Nothing needs editing when the hardware changes.

### TypeScript

Two programs, because the browser code and the config files need different globals.

- `tsconfig.app.json` — `src` (`@types/web` and `vite/client`). It uses `@types/web` in place of the built-in `dom` lib because TypeScript 7.0.2's copy is missing WebGPU's bitflag namespaces. The file explains when to undo that.
- `tsconfig.node.json` — the root config files (`*.config.ts`, `@types/node`).

`npm run check` runs `tsc --build`, which type-checks both. Ensure correctness by type-checking after edits.

### Vite base path

`vite.config.ts` sets `base: '/pong-wars/'` for GitHub Pages deployment.

Reference static assets via `import` or `new URL(…, import.meta.url)` — Vite rewrites those paths automatically. Hardcoded URL strings in JS/TS are not rewritten and will break under the subpath.

`shaders/main.wgsl` is imported with `?raw` — see "Shaders" above.

## Deployment

`.github/workflows/ci.yml` runs checks on every PR and every push to `main`.
`.github/workflows/cd.yml` deploys to GitHub Pages on every push to `main`.
