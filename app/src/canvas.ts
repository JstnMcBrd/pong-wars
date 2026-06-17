const MIN_BALL_RADIUS_PX = 3;

// Reuse a single 1×1 canvas to resolve HSL strings to RGB triples.
const colorResolverCanvas = document.createElement("canvas");
colorResolverCanvas.width = colorResolverCanvas.height = 1;
const colorResolverCtx = colorResolverCanvas.getContext("2d", { willReadFrequently: true })!;

/** Generates an array of RGB color tuples for the specified number of teams. */
function generateColors(n: number): Array<[number, number, number]> {
  return Array.from({ length: n }, (_, i) => {
    // Evenly space hues around the color wheel.
    colorResolverCtx.fillStyle = `hsl(${((i * 360) / n).toFixed(1)}, 70%, 55%)`;
    colorResolverCtx.fillRect(0, 0, 1, 1);

    // Read back the browser-resolved RGB values.
    const [r, g, b] = colorResolverCtx.getImageData(0, 0, 1, 1).data;
    if (r === undefined || g === undefined || b === undefined) {
      throw new Error("generateColors: pixel data incomplete");
    }

    return [r, g, b];
  });
}

/**
 * DOM wrapper for the <canvas> element. Handles all drawing and keeps the
 * canvas buffer resolution in sync with its CSS-rendered size via ResizeObserver.
 *
 * The grid is rendered via a 1px-per-cell OffscreenCanvas blitted up to the
 * main canvas in a single drawImage call (GPU-accelerated, pixel-perfect).
 *
 * The number of teams is inferred from the ballPosX array on each draw() call and
 * colors are regenerated only when it changes.
 */
class Canvas {
  private readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  // 1px-per-cell offscreen canvas — rebuilt when gridSize changes.
  private offscreen: OffscreenCanvas;
  private offCtx: OffscreenCanvasRenderingContext2D;
  private imgData: ImageData;

  private cellW = 0;
  private cellH = 0;
  private ballRadiusPx = 0;

  // Team colors and pre-computed stroke strings — regenerated lazily when number of teams changes.
  private teamColors: Array<[number, number, number]> = [];
  private teamStrokes: string[] = [];

  // Cached last frame so redraw() can repaint after a resize.
  private lastGrid: Uint16Array | null = null;
  private lastBallPosX: Float32Array | null = null;
  private lastBallPosY: Float32Array | null = null;

  constructor() {
    this.el = document.getElementById("canvas") as HTMLCanvasElement;
    this.ctx = this.el.getContext("2d")!;

    // Placeholder — replaced by the gridSize setter before the first draw.
    this.offscreen = new OffscreenCanvas(1, 1);
    this.offCtx = this.offscreen.getContext("2d")!;
    this.imgData = this.offCtx.createImageData(1, 1);

    // Keep buffer resolution in sync with CSS-rendered size.
    new ResizeObserver(([entry]) => {
      if (!entry) return;
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
    this.ballRadiusPx = Math.max(Math.min(this.cellW, this.cellH) * 0.45, MIN_BALL_RADIUS_PX);
  }

  /** Render a frame. Grid size and team colors are reconfigured lazily when they change. */
  public draw(
    grid: Uint16Array,
    cols: number,
    rows: number,
    ballPosX: Float32Array,
    ballPosY: Float32Array,
  ): void {
    // Reconfigure the offscreen buffer lazily when the grid size changes.
    if (rows !== this.offscreen.height || cols !== this.offscreen.width) {
      this.offscreen = new OffscreenCanvas(cols, rows);
      this.offCtx = this.offscreen.getContext("2d")!;
      this.imgData = this.offCtx.createImageData(cols, rows);
      this.recomputeCellSize();
    }

    // Regenerate team colors lazily when the number of teams changes.
    const numTeams = ballPosX.length;
    if (numTeams !== this.teamColors.length) {
      this.teamColors = generateColors(numTeams);
      this.teamStrokes = this.teamColors.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
    }

    // Cache the last frame for redraws after resizes.
    this.lastGrid = grid;
    this.lastBallPosX = ballPosX;
    this.lastBallPosY = ballPosY;

    this.drawFrame(grid, ballPosX, ballPosY);
  }

  /** Repaint the last frame at the current canvas size. No-op before the first draw(). */
  private redraw(): void {
    if (this.lastGrid === null || this.lastBallPosX === null || this.lastBallPosY === null) {
      return;
    }
    this.drawFrame(this.lastGrid, this.lastBallPosX, this.lastBallPosY);
  }

  private drawFrame(grid: Uint16Array, ballPosX: Float32Array, ballPosY: Float32Array): void {
    // 1. Write cell colors into the tiny offscreen ImageData.
    const data = this.imgData.data;
    for (const [index, teamIndex] of grid.entries()) {
      const rgb = this.teamColors[teamIndex];
      if (rgb === undefined) {
        throw new Error(`draw: no color for team ${teamIndex}`);
      }

      const p = index * 4;
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
    this.offCtx.putImageData(this.imgData, 0, 0);

    // 2. Scale the offscreen canvas up to the main canvas in one GPU blit.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.offscreen, 0, 0, this.el.width, this.el.height);

    // 3. Draw balls: white fill + team-colored outline.
    const numTeams = ballPosX.length;
    const twoPi = Math.PI * 2;

    this.ctx.lineWidth = 2;
    this.ctx.fillStyle = "#ffffff";

    for (let i = 0; i < numTeams; i++) {
      const bx = ballPosX[i],
        by = ballPosY[i];
      if (bx === undefined || by === undefined) {
        throw new Error(`draw: ball ${i} missing`);
      }

      const strokeStyle = this.teamStrokes[i];
      if (strokeStyle === undefined) {
        throw new Error(`draw: no color for ball ${i}`);
      }

      this.ctx.beginPath();
      this.ctx.arc(bx * this.cellW, by * this.cellH, this.ballRadiusPx, 0, twoPi);
      this.ctx.fill();
      this.ctx.strokeStyle = strokeStyle;
      this.ctx.stroke();
    }
  }
}

export const canvas = new Canvas();
