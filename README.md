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
