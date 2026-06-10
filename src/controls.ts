export type SimState = "preview" | "running" | "paused";

// ── Controls class ───────────────────────────────────────────────────────────

class Controls {
  private readonly btnStart: HTMLButtonElement;
  private readonly btnStop: HTMLButtonElement;
  private readonly btnPause: HTMLButtonElement;
  private readonly btnResume: HTMLButtonElement;

  private _state: SimState = "preview";
  private startCb: (() => void) | null = null;
  private stopCb: (() => void) | null = null;

  constructor() {
    this.btnStart = document.getElementById("btn-start") as HTMLButtonElement;
    this.btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
    this.btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
    this.btnResume = document.getElementById("btn-resume") as HTMLButtonElement;

    this.wireButtons();
    this.stop();
  }

  // ── State ─────────────────────────────────────────────────────────────────

  public get state(): SimState {
    return this._state;
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /** Register a callback invoked when the simulation starts. */
  public onStart(cb: () => void): void {
    this.startCb = cb;
  }

  /** Register a callback invoked when the simulation stops. */
  public onStop(cb: () => void): void {
    this.stopCb = cb;
  }

  // ── Button visibility ─────────────────────────────────────────────────────

  private stop(): void {
    this._state = "preview";
    this.btnStart.hidden = false;
    this.btnStop.hidden = true;
    this.btnPause.hidden = true;
    this.btnResume.hidden = true;
  }

  private start(): void {
    this._state = "running";
    this.btnStart.hidden = true;
    this.btnStop.hidden = false;
    this.btnPause.hidden = false;
    this.btnResume.hidden = true;
  }

  private pause(): void {
    this._state = "paused";
    this.btnStart.hidden = true;
    this.btnStop.hidden = false;
    this.btnPause.hidden = true;
    this.btnResume.hidden = false;
  }

  // ── Private setup ─────────────────────────────────────────────────────────

  private wireButtons(): void {
    this.btnStart.addEventListener("click", () => {
      this.start();
      this.startCb?.();
    });

    this.btnStop.addEventListener("click", () => {
      this.stop();
      this.stopCb?.();
    });

    this.btnPause.addEventListener("click", () => {
      this.pause();
    });

    this.btnResume.addEventListener("click", () => {
      this.start();
    });
  }
}

export const controls = new Controls();
