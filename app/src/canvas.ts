import type { Frame } from "./protocol.js";

const MIN_BALL_RADIUS_PX = 2;

/**
 * DOM wrapper for the rendering surface. The grid is drawn to a pixel-sized
 * canvas that scales via CSS, while the balls are painted to a transparent
 * overlay that is resized to the display box on each container resize.
 */
class Canvas {
  private readonly container: HTMLDivElement;
  private readonly gridCanvas: HTMLCanvasElement;
  private readonly ballsCanvas: HTMLCanvasElement;

  private gridCtx: CanvasRenderingContext2D;
  private ballsCtx: CanvasRenderingContext2D;

  private cellW = 0;
  private cellH = 0;
  private ballRadiusPx = 0;

  private lastBallPosX: Float32Array | null = null;
  private lastBallPosY: Float32Array | null = null;

  constructor() {
    this.container = document.getElementById("canvas") as HTMLDivElement;
    this.gridCanvas = document.getElementById("grid") as HTMLCanvasElement;
    this.ballsCanvas = document.getElementById("balls") as HTMLCanvasElement;

    this.gridCtx = this.gridCanvas.getContext("2d", { alpha: false })!;
    this.ballsCtx = this.ballsCanvas.getContext("2d", { alpha: true })!;

    new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      this.ballsCanvas.width = Math.floor(width);
      this.ballsCanvas.height = Math.floor(height);
      this.recomputeCellSize();
      this.redrawBalls();
    }).observe(this.container);
  }

  private recomputeCellSize(): void {
    this.cellW = this.ballsCanvas.width / this.gridCanvas.width;
    this.cellH = this.ballsCanvas.height / this.gridCanvas.height;
    this.ballRadiusPx = Math.max(Math.min(this.cellW, this.cellH) * 0.5, MIN_BALL_RADIUS_PX);
  }

  /** Render a frame. The grid layer is reconfigured lazily when the grid size changes. */
  public draw(frame: Frame): void {
    if (frame.cols !== this.gridCanvas.width || frame.rows !== this.gridCanvas.height) {
      this.gridCanvas.width = frame.cols;
      this.gridCanvas.height = frame.rows;
      this.recomputeCellSize();
    }

    this.lastBallPosX = frame.ballPosX;
    this.lastBallPosY = frame.ballPosY;

    this.drawGrid(frame);
    this.drawBalls(frame.ballPosX, frame.ballPosY);
  }

  private drawGrid(frame: Frame): void {
    const { pixels, cols, rows } = frame;
    const image = new ImageData(pixels as ImageDataArray, cols, rows);
    this.gridCtx.putImageData(image, 0, 0);
  }

  private drawBalls(ballPosX: Float32Array, ballPosY: Float32Array): void {
    this.ballsCtx.clearRect(0, 0, this.ballsCanvas.width, this.ballsCanvas.height);

    const numTeams = ballPosX.length;
    const twoPi = Math.PI * 2;

    this.ballsCtx.fillStyle = "#ffffff";

    for (let i = 0; i < numTeams; i++) {
      const bx = ballPosX[i],
        by = ballPosY[i];
      if (bx === undefined || by === undefined) {
        throw new Error(`draw: ball ${i} missing`);
      }

      this.ballsCtx.beginPath();
      this.ballsCtx.arc(bx * this.cellW, by * this.cellH, this.ballRadiusPx, 0, twoPi);
      this.ballsCtx.fill();
    }
  }

  /** Repaint the last ball positions at the current display size. No-op before the first draw(). */
  private redrawBalls(): void {
    if (this.lastBallPosX === null || this.lastBallPosY === null) {
      return;
    }
    this.drawBalls(this.lastBallPosX, this.lastBallPosY);
  }
}

export const canvas = new Canvas();
