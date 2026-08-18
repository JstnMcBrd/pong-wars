/**
 * Where the engine draws.
 *
 * The engine never touches a canvas directly. In the browser the target is the
 * canvas swap chain; headlessly it is a plain texture that can be read back.
 * That split is what lets the renderer run where no swap chain exists — see
 * "Headless rendering" in `AGENTS.md`.
 */
export interface RenderTarget {
  /** Texture format the render pipelines must target. */
  readonly format: GPUTextureFormat;

  /** Current drawing-buffer size, in device pixels. */
  readonly width: number;
  readonly height: number;

  /** The view to draw into for this frame. */
  currentView(): GPUTextureView;

  /** Register a callback fired whenever `width`/`height` change. */
  onResize(listener: () => void): void;
}

/** Presents through a canvas swap chain. The production target. */
export class CanvasTarget implements RenderTarget {
  public readonly format: GPUTextureFormat;

  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly listeners: (() => void)[] = [];

  public constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.format = format;

    this.resize();
    new ResizeObserver(() => {
      this.resize();
    }).observe(canvas);
  }

  public get width(): number {
    return this.canvas.width;
  }

  public get height(): number {
    return this.canvas.height;
  }

  public currentView(): GPUTextureView {
    return this.context.getCurrentTexture().createView();
  }

  public onResize(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** Match the drawing buffer to the element's display box, at device pixels. */
  private resize(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const maxSize = this.device.limits.maxTextureDimension2D;
    const clamp = (size: number): number =>
      Math.max(1, Math.min(Math.round(size * devicePixelRatio), maxSize));

    this.canvas.width = clamp(width);
    this.canvas.height = clamp(height);

    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Draws into an ordinary texture and reads the pixels back.
 *
 * Nothing here goes through a swap chain, so this works on machines that have
 * no display and no real GPU — which is the whole point of it.
 */
export class TextureTarget implements RenderTarget {
  /** `copyTextureToBuffer` requires each row to start on a 256-byte boundary. */
  private static readonly ROW_ALIGNMENT = 256;

  public readonly format: GPUTextureFormat = "rgba8unorm";
  public readonly width: number;
  public readonly height: number;

  private readonly device: GPUDevice;
  private readonly texture: GPUTexture;

  public constructor(device: GPUDevice, width: number, height: number) {
    this.device = device;
    this.width = width;
    this.height = height;
    this.texture = device.createTexture({
      label: "headless target",
      size: [width, height],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  public currentView(): GPUTextureView {
    return this.texture.createView();
  }

  /** The size never changes, so the callback is never fired. */
  public onResize(): void {}

  /** @returns the rendered image as tightly packed RGBA bytes. */
  public async read(): Promise<Uint8Array> {
    const unpadded = this.width * 4;
    const padded = Math.ceil(unpadded / TextureTarget.ROW_ALIGNMENT) * TextureTarget.ROW_ALIGNMENT;

    const staging = this.device.createBuffer({
      label: "headless readback",
      size: padded * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.texture },
      { buffer: staging, bytesPerRow: padded },
      [this.width, this.height],
    );
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(staging.getMappedRange());

    // Drop the per-row padding so callers get a plain RGBA image.
    const pixels = new Uint8Array(unpadded * this.height);
    for (let row = 0; row < this.height; row++) {
      pixels.set(mapped.subarray(row * padded, row * padded + unpadded), row * unpadded);
    }

    staging.unmap();
    staging.destroy();
    return pixels;
  }

  public destroy(): void {
    this.texture.destroy();
  }
}
