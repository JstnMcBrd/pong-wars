import { Engine } from "../src/engine.js";
import { requestDevice } from "../src/gpu.js";
import { TextureTarget } from "../src/target.js";

/** One rendered frame, as raw RGBA plus the tick count that produced it. */
export interface Frame {
  ticks: number;
  pixels: number[];
}

/**
 * Render the simulation offscreen and hand the pixels back.
 *
 * Exposed on `window` so Playwright can drive it. Everything here runs the same
 * `Engine` and the same `main.wgsl` the real page does — only the render target
 * differs, so a shader that breaks here breaks in the browser too.
 */
async function renderFrames(options: {
  width: number;
  height: number;
  gridSize: number;
  numTeams: number;
  ticksPerFrame: number;
  frames: number;
}): Promise<Frame[]> {
  const device = await requestDevice();
  const target = new TextureTarget(device, options.width, options.height);
  const engine = new Engine(device, target);

  engine.reset(options.gridSize, options.gridSize, options.numTeams);

  const out: Frame[] = [];
  for (let i = 0; i < options.frames; i++) {
    // The engine drops frames while the queue is full, so wait it out.
    while (!engine.render(i === 0 ? 0 : options.ticksPerFrame)) {
      await device.queue.onSubmittedWorkDone();
    }
    await device.queue.onSubmittedWorkDone();
    out.push({
      ticks: i * options.ticksPerFrame,
      pixels: Array.from(await target.read()),
    });
  }
  return out;
}

declare global {
  interface Window {
    renderFrames: typeof renderFrames;
  }
}

window.renderFrames = renderFrames;
