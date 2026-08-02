import "./styles.css";
import { createIcons, Pause, Play, Square } from "lucide";

import { canvas } from "./canvas.js";
import type { Frame, WorkerMessage, WorkerReply } from "./protocol.js";
import { sidebar } from "./sidebar.js";

createIcons({ icons: { Pause, Play, Square } });

// ── Simulation Worker ──────────────────────────────────────────────────────

/** Identifies the simulation a frame belongs to. Frames from a superseded one are dropped. */
let epoch = 0;

/** A reset that has been requested but not posted yet. Flushed once per animation frame. */
let resetPending = false;

/** A request the worker has not answered yet. Starts true: the worker is still booting. */
let workerBusy = true;

/** A computed frame that has not been drawn yet. */
let pendingFrame: Frame | null = null;

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
worker.onmessage = function (e: MessageEvent<WorkerReply>) {
  const msg = e.data;
  if (msg.type === "ready") {
    resetSimulation();
  }
  if (msg.type === "frame" && msg.epoch === epoch) {
    workerBusy = false;
    pendingFrame = msg.frame;
  }
};
worker.onerror = function (e) {
  console.error("Worker error:", e);
};

/** Mark the simulation as needing reinitialization. */
function resetSimulation(): void {
  epoch++;
  resetPending = true;
  workerBusy = true;
  pendingFrame = null;
}

// ── Orchestration ──────────────────────────────────────────────────────────

sidebar.onReset(resetSimulation);

// ── Animation loop ─────────────────────────────────────────────────────────

function loop(): void {
  requestAnimationFrame(loop);

  // Flush before anything else, and return
  if (resetPending) {
    resetPending = false;
    const msg: WorkerMessage = {
      type: "reset",
      epoch,
      numCols: sidebar.gridSize,
      numRows: sidebar.gridSize,
      numTeams: sidebar.numTeams,
    };
    worker.postMessage(msg);
    return;
  }

  const frame = pendingFrame;
  pendingFrame = null;

  // Ask for the next frame before drawing this one, so the worker computes while
  // the main thread draws. Frames still arrive from a paused or preview
  // simulation — they are drawn; only the request for a successor is withheld.
  if (sidebar.state === "running" && !workerBusy) {
    workerBusy = true;
    const msg: WorkerMessage = {
      type: "tick",
      ticks: sidebar.ticksPerFrame,
    };
    worker.postMessage(msg);
  }

  if (frame !== null) {
    canvas.draw(frame);
    sidebar.recordFrame();
  }
}

requestAnimationFrame(loop);
