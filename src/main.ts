import { Engine, maxGpuSupportedGridSize } from "./engine.js";
import { requestGpu, GpuError } from "./gpu.js";
import { Sidebar } from "./sidebar.js";

const failure = document.getElementById("failure") as HTMLElement;
const failureDetail = document.getElementById("failure-detail") as HTMLParagraphElement;
const app = document.getElementById("app") as HTMLElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;

void start().catch((error) =>
  error instanceof GpuError ? showGpuError(error) : console.error(error),
);

async function start(): Promise<void> {
  const gpu = await requestGpu(canvas);

  const gpuMaxGridSize = maxGpuSupportedGridSize(gpu.device);
  const sidebar = new Sidebar(gpuMaxGridSize);

  const engine = new Engine(gpu, canvas);
  engine.reset(sidebar.gridSize, sidebar.gridSize, sidebar.numTeams);

  // Slider drags fire faster than frames, so resets coalesce to at most one per frame.
  let resetPending = false;
  sidebar.onReset(() => {
    resetPending = true;
  });

  requestAnimationFrame(function loop() {
    requestAnimationFrame(loop);

    if (resetPending) {
      resetPending = false;
      engine.reset(sidebar.gridSize, sidebar.gridSize, sidebar.numTeams);
    }

    // A paused or previewing simulation is still drawn, just not advanced.
    const ticks = sidebar.state === "running" ? sidebar.ticksPerFrame : 0;
    if (engine.render(ticks)) {
      sidebar.recordFrame();
    }
  });
}

/** Replace the app with an explanation. There is no CPU fallback to fall back to. */
function showGpuError(error: GpuError): void {
  console.error(error);

  failureDetail.textContent = error.message;

  app.hidden = true;
  failure.hidden = false;
}
