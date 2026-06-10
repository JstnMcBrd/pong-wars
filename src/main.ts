import "./styles.css";
import { canvas } from "./canvas.js";
import { controls } from "./controls.js";
import { settings } from "./settings.js";
import type { WorkerMessage, WorkerReply } from "./worker.js";

// ── Simulation Worker ──────────────────────────────────────────────────────

let workerBusy = true;

const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
worker.onmessage = function (e: MessageEvent<WorkerReply>) {
  const msg = e.data;
  if (msg.type === "ready") {
    resetWorker();
  }
  if (msg.type === "frame") {
    workerBusy = false;
    canvas.draw(msg.grid, msg.cols, msg.rows, msg.balls);
  }
};
worker.onerror = function (e) {
  console.error("Worker error:", e);
};

function resetWorker(): void {
  workerBusy = true;
  const msg: WorkerMessage = {
    type: "reset",
    numCols: settings.gridSize,
    numRows: settings.gridSize,
    numTeams: settings.numTeams,
  };
  worker.postMessage(msg);
}

// ── Orchestration ──────────────────────────────────────────────────────────

settings.onChange(() => {
  resetWorker();
});

controls.onStart(() => {
  settings.lock();
});

controls.onStop(() => {
  resetWorker();
  settings.unlock();
});

// ── Animation loop ─────────────────────────────────────────────────────────

function loop(): void {
  requestAnimationFrame(loop);

  if (controls.state !== "running") {
    return;
  }
  if (workerBusy) {
    console.warn("Worker not ready for next frame - ticks per frame may be too high");
    return;
  }

  workerBusy = true;
  const msg: WorkerMessage = {
    type: "tick",
    ticks: settings.ticksPerFrame,
  };
  worker.postMessage(msg);
}

requestAnimationFrame(loop);
