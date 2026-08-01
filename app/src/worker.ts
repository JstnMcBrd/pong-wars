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
let epoch = 0; // Reset identifier - allows `main.ts` to drop frames left over from a replaced simulation
let sim = new Simulation(cols, rows, 0); // Dummy initial sim; will be reset on 'ready'

onmessage = function (e: MessageEvent<WorkerMessage>) {
  const msg = e.data;

  if (msg.type === "reset") {
    sim.free(); // Free the old sim's Wasm memory before creating a new one.

    cols = msg.numCols;
    rows = msg.numRows;
    epoch = msg.epoch;
    sim = new Simulation(cols, rows, msg.numTeams);

    postFrame();
  }

  if (msg.type === "tick") {
    sim.tick_n(msg.ticks);
    postFrame();
  }
};

/** Snapshot the simulation and hand the buffers to the main thread. */
function postFrame(): void {
  const pixels = sim.get_pixels();
  const ballPosX = sim.get_ball_pos_x();
  const ballPosY = sim.get_ball_pos_y();

  const frame: WorkerReply = {
    type: "frame",
    epoch,
    frame: {
      pixels,
      cols,
      rows,
      ballPosX,
      ballPosY,
    },
  };
  postMessage(frame, [pixels.buffer, ballPosX.buffer, ballPosY.buffer]);
}

onerror = function (e) {
  console.error("Worker error:", e);
};

// Signal to the main thread that the module is fully loaded and onmessage is set.
// Must be posted here (module scope) rather than inside the init handler so the
// main thread knows it's safe to send 'reset' without racing the Wasm load.
const ready: WorkerReply = { type: "ready" };
postMessage(ready);
