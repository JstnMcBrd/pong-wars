# AGENTS.md

Guidance for AI coding agents that work in this repository.

Keep `AGENTS.md` and `README.md` up to date when you change the project.

`AGENTS.md` is a high-level overview. Keep updates brief and conceptual. Leave implementation details to the code and its comments.

Update a description only when a large change makes it inaccurate. Do not increase the level of detail.

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

There are no tests. To verify a change, run the app in a browser. For shader changes, this is the only check (see [Shaders](#shaders)).

## Architecture

A multi-ball pong simulation in the browser. Each ball paints grid cells with its team color. The physics and the rendering both run on the GPU through **WebGPU**. The main thread only encodes commands.

### Data flow

```
reset()  ─► init_grid  ──┐
         ─► init_balls ──┤
                         ▼
              grid buffer + ball buffer      (stay on the GPU)
                         ▲           │
render() ─► sim ─────────┘           │       compute pass, skipped while paused
         ─► grid quad + ball quads ◄─┘       render pass
```

### Files

- `src/main.ts` — Bootstrap and frame loop. Gets the GPU, builds the sidebar, and seeds the engine. Then calls `Engine.render()` once per animation frame, with at most one reset per frame. Shows a failure message if WebGPU setup fails.
- `src/gpu.ts` — Gets a WebGPU adapter and device, with the adapter's highest compute limits. Throws `GpuError` if WebGPU is not available.
- `src/engine.ts` — Owns all device resources: buffers, bind group layouts, and pipelines. `reset()` reallocates and seeds the simulation state. `render()` encodes an optional compute pass and a render pass into one command buffer.
- `src/sidebar.ts` — Owns the sidebar panel: control buttons, setting sliders, and FPS counter. Tracks the simulation state (`preview | running | paused`) and exposes the setting values. Calls the `onReset` callback when the simulation must reset. The `Slider` class manages the DOM elements of one setting.
- `shaders/main.wgsl` — The physics and the renderer, in one module.

### Sequential ticks

Read this section before you change the physics.

Each tick depends on the previous tick, so the only parallelism is across balls. Thus `sim` runs as a **single workgroup** that loops over all ticks and calls `storageBarrier()` between ticks. `storageBarrier()` only orders writes inside one workgroup. With more than one workgroup, some balls read an incomplete tick. Thus `dispatchWorkgroups(1)` is intentional.

Within a tick, the balls run concurrently. A ball does not reliably see the writes that other balls make in the same tick. If two balls claim the same cell, the last write wins. Thus **the simulation is not reproducible**. This is intentional.

### Bindings

`@group(0)` holds the settings: one small uniform buffer per setting. The engine creates these buffers once.

`@group(1)` holds the simulation state. `reset()` reallocates these buffers when the grid size or team count changes.

The shader declares read-only aliases of the `@group(1)` buffers, so that the vertex and fragment stages can read them. Two variables can share a binding if no entry point uses both. The compute pipelines bind the buffers through a `storage` layout. The render pipelines bind the same buffers through a `read-only-storage` layout.

Binding numbers appear in both the shader and `engine.ts`, and nothing checks that they agree. After you change either list, compare the two lists.

### Shaders

All shader code is in `shaders/main.wgsl`. `engine.ts` imports the file with Vite's `?raw` suffix. WGSL has no module system, so one file lets the physics and the renderer share declarations.

> If you need separate shader modules with imports, investigate WESL.

**Nothing validates or formats the shader.** `oxfmt` and `oxlint` ignore `.wgsl` files, and the build copies the shader into the bundle as a string. Thus a broken shader passes all automated checks, then fails at `createShaderModule` when the page loads. After each shader edit, run the app and watch the console.

A shader cannot print, so debugging is limited. Two methods work:

- Copy a storage buffer back to the CPU through a `MAP_READ` staging buffer.
- Temporarily return a suspect value as a color from a fragment entry point.

### Coordinate space

All physics uses **grid space**, where 1 unit is 1 cell. The shaders convert grid space to clip space.

### Limits

The maximum of the grid-size slider is the lower of two values: the largest grid that the device can hold, and `MAX_GRID_SIZE_CAP` in `sidebar.ts`.

Every conformant adapter supports a storage buffer binding of at least 128 MB, which holds a grid of about 5,792². For a larger grid, request a higher `maxStorageBufferBindingSize` in `gpu.ts` and split the grid across several bindings.

Workgroup sizes are not hardcoded. `gpu.ts` requests the adapter's highest compute limits. `engine.ts` derives each workgroup size from these limits and passes the size to the shader as an `override` constant. Different hardware needs no code edits.

### TypeScript

There are two TypeScript programs, because the browser code and the config files need different globals:

- `tsconfig.app.json` — `src`, with `@types/web` and `vite/client`. It uses `@types/web` instead of the built-in `DOM` lib, because the TypeScript 7.0.2 `DOM` lib does not have WebGPU's bitflag namespaces. The file tells when to undo this.
- `tsconfig.node.json` — the root config files (`*.config.ts`), with `@types/node`.

`npm run check` runs `tsc --build`, which type-checks both programs. Type-check after each edit.

### Static assets

Reference static assets with `import` or `new URL(…, import.meta.url)`, so that Vite rewrites the paths.

## Deployment

- `.github/workflows/ci.yml` runs checks on each pull request and each push to `main`.
- `.github/workflows/cd.yml` deploys to GitHub Pages on each push to `main`.
