import "./styles.css";
import { createIcons, Pause, Play, Square } from "lucide";

import { canvas } from "./canvas.js";
import { sidebar } from "./sidebar.js";
import type { WorkerMessage, WorkerReply } from "./worker.js";

createIcons({ icons: { Pause, Play, Square } });

// ── Simulation Worker ──────────────────────────────────────────────────────

let workerBusy = true;

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
worker.onmessage = function (e: MessageEvent<WorkerReply>) {
  const msg = e.data;
  if (msg.type === "ready") {
    resetSimulation();
  }
  if (msg.type === "frame") {
    workerBusy = false;
    canvas.draw(msg.grid, msg.cols, msg.rows, msg.balls);
    sidebar.recordFrame();
  }
};
worker.onerror = function (e) {
  console.error("Worker error:", e);
};

function resetSimulation(): void {
  workerBusy = true;
  const msg: WorkerMessage = {
    type: "reset",
    numCols: sidebar.gridSize,
    numRows: sidebar.gridSize,
    numTeams: sidebar.numTeams,
  };
  worker.postMessage(msg);
}

// ── Orchestration ──────────────────────────────────────────────────────────

sidebar.onReset(resetSimulation);

// ── Animation loop ─────────────────────────────────────────────────────────

function loop(): void {
  requestAnimationFrame(loop);

  if (sidebar.state !== "running") {
    return;
  }
  if (workerBusy) {
    console.warn("Worker not ready for next frame - ticks per frame may be too high");
    return;
  }

  workerBusy = true;
  const msg: WorkerMessage = {
    type: "tick",
    ticks: sidebar.ticksPerFrame,
  };
  worker.postMessage(msg);
}

requestAnimationFrame(loop);
