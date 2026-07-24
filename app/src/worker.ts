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
 *   worker → main:  { type: 'frame', pixels: Uint8ClampedArray, cols: number, rows: number, ballPosX: Float32Array, ballPosY: Float32Array }
 *
 *   main → worker:  { type: 'tick', ticks: number }
 *   worker → main:  { type: 'frame', pixels: Uint8ClampedArray, cols: number, rows: number, ballPosX: Float32Array, ballPosY: Float32Array }
 *
 * `pixels` is a flat RGBA buffer painted by the Rust engine (1 pixel per cell),
 * ready to construct an ImageData from directly. Balls layout: [x,y]×N.
 *
 * All ArrayBuffers are transferred zero-copy.
 *
 * All coordinates returned are in grid-space units.
 * The Worker never needs to know about canvas pixels or window dimensions.
 */

import { Simulation } from "sim";

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

    const pixels = sim.get_pixels();
    const ballPosX = sim.get_ball_pos_x();
    const ballPosY = sim.get_ball_pos_y();
    const frame: WorkerReply = { type: "frame", pixels, cols, rows, ballPosX, ballPosY };
    postMessage(frame, [pixels.buffer, ballPosX.buffer, ballPosY.buffer]);
  }

  if (msg.type === "tick") {
    sim.tick_n(msg.ticks);
    const pixels = sim.get_pixels();
    const ballPosX = sim.get_ball_pos_x();
    const ballPosY = sim.get_ball_pos_y();
    const frame: WorkerReply = { type: "frame", pixels, cols, rows, ballPosX, ballPosY };
    postMessage(frame, [pixels.buffer, ballPosX.buffer, ballPosY.buffer]);
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
  | {
      type: "frame";
      pixels: Uint8ClampedArray;
      cols: number;
      rows: number;
      ballPosX: Float32Array;
      ballPosY: Float32Array;
    };
