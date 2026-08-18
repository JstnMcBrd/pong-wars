# pong-wars

> Inspired by [vnglst/pong-wars](https://github.com/vnglst/pong-wars)

An implementation of the classic "Pong Wars" simulation, powered by WebGPU.

Additional features:

- Settings and customizations
- Support for more than two teams
- Optimized for speed and simulation size

More balls, more squares, more speed!

## Architecture

**App** — TypeScript + Vite, transpiled to pure HTML/CSS/JS for the browser

**Shaders** — WebGPU WGSL, handles simulation and rendering, runs on the GPU

## Requirements

WebGPU, and a supported graphics device. There is no fallback.

See what your setup supports at [webgpucheck.com](https://webgpucheck.com/).

## Development

```bash
npm install
npm run dev
```

To see the simulation where no browser window is available — a container, a CI
runner, a cloud dev environment — render frames to PNG instead:

```bash
npm run render -- --frames 4 --out renders
```

This needs neither a GPU nor a display. It runs the same engine and shader as
the app, drawing into an offscreen texture rather than a canvas.
