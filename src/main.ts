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

// ── FPS counter ────────────────────────────────────────────────────────────

const fpsCounter = document.getElementById("fps-counter") as HTMLSpanElement;
let fpsFrameCount = 0;
let fpsWindowStart = 0; // 0 = not yet started

// ── Animation loop ─────────────────────────────────────────────────────────

function loop(now: DOMHighResTimeStamp): void {
  requestAnimationFrame(loop);

  if (sidebar.state !== "running") {
    if (fpsWindowStart !== 0) {
      fpsCounter.textContent = "-- FPS";
      fpsFrameCount = 0;
      fpsWindowStart = 0;
    }
    return;
  }

  fpsFrameCount++;
  if (fpsWindowStart === 0) {
    fpsWindowStart = now;
  } else {
    const elapsed = now - fpsWindowStart;
    if (elapsed >= 500) {
      fpsCounter.textContent = `${Math.round((fpsFrameCount / elapsed) * 1000)} FPS`;
      fpsFrameCount = 0;
      fpsWindowStart = now;
    }
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
