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
 *   main → worker:  { type: 'reset', numCols, numRows, numTeams }
 *   worker → main:  { type: 'frame', … }
 *
 *   main → worker:  { type: 'tick', ticks }
 *   worker → main:  { type: 'frame', … }
 *
 * `pixels` is a flat RGBA buffer painted by the Rust engine (1 pixel per cell),
 * ready to construct an ImageData from directly. Balls layout: [x,y]×N.
 *
 * All ArrayBuffers are transferred zero-copy.
 * All coordinates are in grid-space units.
 */

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
