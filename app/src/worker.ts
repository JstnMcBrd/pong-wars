/**
 * Worker interface — thin wrapper around the Rust/Wasm Simulation.
 *
 * For the bundler target, wasm-bindgen initializes the Wasm module
 * automatically when the ES module is imported, so no explicit init()
 * call is needed.
 *
 * The message protocol lives in `protocol.ts`.
 *
 * The Worker never needs to know about canvas pixels or window dimensions.
 */

import { Simulation } from "sim";

import type { WorkerMessage, WorkerReply } from "./protocol.js";

let cols = 0;
let rows = 0;
let sim = new Simulation(cols, rows, 0); // dummy initial sim; will be reset on 'ready'

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
