# pong-wars

> Inspired by [vnglst/pong-wars](https://github.com/vnglst/pong-wars)

An implementation of the classic "Pong Wars" simulation with a few key changes:

- Settings and customizations
- Support for more than two teams
- Optimized for speed and simulation size

More balls, more squares, more speed!

## Architecture

- **Front-end**
    - Uses TypeScript + Vite, transpiles to pure HTML/CSS/JS for the browser
    - Paints the grid to the canvas every frame
- **Physics Worker**
    - Written in Rust, compiles to Wasm
    - Runs in a Web Worker so physics never blocks the main thread
    - Supports any number of ticks per frame for turbo-speed simulation

The separation between rendering and physics enables blindly fast simulation speeds!
