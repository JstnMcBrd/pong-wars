/**
 * The main thread ↔ worker message protocol.
 *
 * Its own module because the two sides are compiled as separate TypeScript
 * programs against conflicting global types — `worker.ts` against WebWorker,
 * the rest of `src` against DOM. Nothing here may reference either lib.
 *
 * Protocol:
 *   worker → main:  { type: 'ready' }
 *
 *   main → worker:  { type: 'reset', epoch, numCols, numRows, numTeams }
 *   main → worker:  { type: 'tick', ticks }
 *   worker → main:  { type: 'frame', epoch, frame }
 *
 * Both requests answer with exactly one frame, so the main thread can treat them
 * alike for pipelining. Every frame carries the `epoch` of the reset that created
 * its simulation, letting the main thread drop frames left over from a simulation
 * it has already replaced.
 *
 * All ArrayBuffers are transferred zero-copy.
 * All coordinates are in grid-space units.
 */

/**
 * Everything needed to draw one frame. `pixels` is a flat RGBA buffer painted by
 * the Rust engine (1 pixel per cell), ready to construct an ImageData from
 * directly. Ball positions are grid-space, one entry per team.
 */
export interface Frame {
  pixels: Uint8ClampedArray;
  cols: number;
  rows: number;
  ballPosX: Float32Array;
  ballPosY: Float32Array;
}

export type WorkerMessage =
  | { type: "reset"; epoch: number; numCols: number; numRows: number; numTeams: number }
  | { type: "tick"; ticks: number };

export type WorkerReply = { type: "ready" } | { type: "frame"; epoch: number; frame: Frame };
