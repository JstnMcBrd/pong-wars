/**
 * Worker interface — thin wrapper around the Rust/Wasm Simulation.
 *
 * For the bundler target, wasm-bindgen initializes the Wasm module
 * automatically when the ES module is imported, so no explicit init()
 * call is needed.
 *
 * Protocol:
 *   worker → main:  { type: 'ready' }
 *
 *   main → worker:  { type: 'reset', numCols: number, numRows: number, numTeams: number }
 *   worker → main:  { type: 'frame', grid: Uint16Array, cols: number, rows: number, balls: Float32Array }
 *
 *   main → worker:  { type: 'tick', ticks: number }
 *   worker → main:  { type: 'frame', grid: Uint16Array, cols: number, rows: number, balls: Float32Array }
 *
 * Balls layout: [x,y]×N
 *
 * Both ArrayBuffers are transferred zero-copy.
 *
 * All coordinates returned are in grid-space units.
 * The Worker never needs to know about canvas pixels or window dimensions.
 */

import { Simulation } from "../worker/pkg/worker.js";

let cols = 0;
let rows = 0;
let sim = new Simulation(cols, rows, 0); // dummy initial sim; will be reset on 'ready'

// In a Worker, `postMessage` is the dedicated worker's postMessage.
// We use the bare global rather than `self.postMessage` to avoid DOM type conflicts.
declare function postMessage(message: unknown, transfer: Transferable[]): void;
declare function postMessage(message: unknown): void;

onmessage = function (e: MessageEvent<WorkerMessage>) {
  const msg = e.data;

  if (msg.type === "reset") {
    sim.free(); // Free the old sim's Wasm memory before creating a new one.

    cols = msg.numCols;
    rows = msg.numRows;
    sim = new Simulation(cols, rows, msg.numTeams);

    const grid = sim.get_grid().slice();
    const balls = sim.get_ball_positions().slice();
    const frame: WorkerReply = { type: "frame", grid, cols, rows, balls };
    postMessage(frame, [grid.buffer, balls.buffer]);
  }

  if (msg.type === "tick") {
    sim.tick_n(msg.ticks);
    const grid = sim.get_grid().slice();
    const balls = sim.get_ball_positions().slice();
    const frame: WorkerReply = { type: "frame", grid, cols, rows, balls };
    postMessage(frame, [grid.buffer, balls.buffer]);
  }
};

onerror = function (e) {
  console.error("Worker error:", e);
};

// Signal to the main thread that the module is fully loaded and onmessage is set.
// Must be posted here (module scope) rather than inside the init handler so the
// main thread knows it's safe to send 'reset' without racing the Wasm load.
const ready: WorkerReply = { type: "ready" };
postMessage(ready);

// ── Shared message types ─────────────────────────────────────────────────────

export type WorkerMessage =
  | { type: "reset"; numCols: number; numRows: number; numTeams: number }
  | { type: "tick"; ticks: number };

export type WorkerReply =
  | { type: "ready" }
  | { type: "frame"; grid: Uint16Array; cols: number; rows: number; balls: Float32Array };
