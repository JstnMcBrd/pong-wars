import type { Frame } from "./protocol.js";

const MIN_BALL_RADIUS_PX = 2;

/**
 * DOM wrapper for the <canvas> element. Handles all drawing and keeps the
 * canvas buffer resolution in sync with its CSS-rendered size via ResizeObserver.
 *
 * The grid is rendered via a 1px-per-cell OffscreenCanvas blitted up to the
 * main canvas in a single drawImage call (GPU-accelerated, pixel-perfect).
 */
class Canvas {
  private readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  // 1px-per-cell offscreen canvas — rebuilt when gridSize changes.
  private offscreen: OffscreenCanvas;
  private offCtx: OffscreenCanvasRenderingContext2D;

  private cellW = 0;
  private cellH = 0;
  private ballRadiusPx = 0;

  // Cached last frame so redraw() can repaint after a resize.
  private lastFrame: Frame | null = null;

  constructor() {
    this.el = document.getElementById("canvas") as HTMLCanvasElement;
    // Opaque: the sim always writes alpha 255 and drawFrame covers the full
    // canvas, so there is nothing for the compositor to blend against the page.
    this.ctx = this.el.getContext("2d", { alpha: false })!;

    // Placeholder — replaced by the first draw() when the grid size is known.
    this.offscreen = new OffscreenCanvas(1, 1);
    this.offCtx = this.offscreen.getContext("2d")!;

    // Keep buffer resolution in sync with CSS-rendered size.
    new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      this.el.width = Math.floor(width);
      this.el.height = Math.floor(height);
      this.recomputeCellSize();
      this.redraw();
    }).observe(this.el);
  }

  private recomputeCellSize(): void {
    this.cellW = this.el.width / this.offscreen.width;
    this.cellH = this.el.height / this.offscreen.height;
    this.ballRadiusPx = Math.max(Math.min(this.cellW, this.cellH) * 0.5, MIN_BALL_RADIUS_PX);
  }

  /** Render a frame. The offscreen buffer is reconfigured lazily when the grid size changes. */
  public draw(frame: Frame): void {
    if (frame.cols !== this.offscreen.width || frame.rows !== this.offscreen.height) {
      this.offscreen = new OffscreenCanvas(frame.cols, frame.rows);
      this.offCtx = this.offscreen.getContext("2d")!;
      this.recomputeCellSize();
    }

    // Cache the frame for redraws after resizes.
    this.lastFrame = frame;

    this.drawFrame(frame);
  }

  /** Repaint the last frame at the current canvas size. No-op before the first draw(). */
  private redraw(): void {
    if (this.lastFrame === null) {
      return;
    }
    this.drawFrame(this.lastFrame);
  }

  private drawFrame(frame: Frame): void {
    const { pixels, cols, rows, ballPosX, ballPosY } = frame;

    // 1. Blit the pre-painted RGBA pixels into the 1px-per-cell offscreen buffer.
    const image = new ImageData(pixels as ImageDataArray, cols, rows);
    this.offCtx.putImageData(image, 0, 0);

    // 2. Scale the offscreen canvas up to the main canvas in one GPU blit.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreen, 0, 0, this.el.width, this.el.height);

    // 3. Draw balls as plain white discs.
    const numTeams = ballPosX.length;
    const twoPi = Math.PI * 2;

    this.ctx.fillStyle = "#ffffff";

    for (let i = 0; i < numTeams; i++) {
      const bx = ballPosX[i],
        by = ballPosY[i];
      if (bx === undefined || by === undefined) {
        throw new Error(`draw: ball ${i} missing`);
      }

      this.ctx.beginPath();
      this.ctx.arc(bx * this.cellW, by * this.cellH, this.ballRadiusPx, 0, twoPi);
      this.ctx.fill();
    }
  }
}

export const canvas = new Canvas();
