type SimState = "preview" | "running" | "paused";

// ── Defaults and bounds ──────────────────────────────────────────────────────

const DEFAULTS = {
  numTeams: 2,
  gridSize: 26,
  ticksPerFrame: 1,
};

const BOUNDS = {
  numTeams: { min: 2 },
  gridSize: { min: 10, max: 500 },
  ticksPerFrame: { min: 1, max: 500 },
} satisfies Record<keyof typeof DEFAULTS, { min: number; max?: number }>;

function computeMaxTeams(gridSize: number): number {
  const circumference = Math.PI * 2 * (gridSize / 4);
  return Math.floor(circumference / 2);
}

// ── Sidebar class ────────────────────────────────────────────────────────────

/**
 * DOM wrapper for the sidebar panel. Owns the simulation control buttons
 * (start/stop/pause/resume) and the settings sliders (teams/size/speed),
 * tracks the {@link SimState}, and exposes the live setting values.
 */
class Sidebar {
  private readonly btnStart: HTMLButtonElement;
  private readonly btnStop: HTMLButtonElement;
  private readonly btnPause: HTMLButtonElement;
  private readonly btnResume: HTMLButtonElement;

  private readonly inpTeams: HTMLInputElement;
  private readonly valTeams: HTMLSpanElement;
  private readonly inpSize: HTMLInputElement;
  private readonly valSize: HTMLSpanElement;
  private readonly inpSpeed: HTMLInputElement;
  private readonly valSpeed: HTMLSpanElement;

  private readonly fpsCounter: HTMLSpanElement;
  private fpsFrameCount = 0;
  private fpsInterval = 0;

  private _state: SimState = "preview";
  private resetCb: (() => void) | null = null;

  constructor() {
    this.btnStart = document.getElementById("btn-start") as HTMLButtonElement;
    this.btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
    this.btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
    this.btnResume = document.getElementById("btn-resume") as HTMLButtonElement;

    this.inpTeams = document.getElementById("inp-teams") as HTMLInputElement;
    this.valTeams = document.getElementById("val-teams") as HTMLSpanElement;
    this.inpSize = document.getElementById("inp-size") as HTMLInputElement;
    this.valSize = document.getElementById("val-size") as HTMLSpanElement;
    this.inpSpeed = document.getElementById("inp-speed") as HTMLInputElement;
    this.valSpeed = document.getElementById("val-speed") as HTMLSpanElement;

    this.fpsCounter = document.getElementById("fps-counter") as HTMLSpanElement;

    this.initSliders();
    this.wireButtons();
    this.wireSliders();
    this.setState("preview");
  }

  // ── State ─────────────────────────────────────────────────────────────────

  public get state(): SimState {
    return this._state;
  }

  // ── DOM-backed setting getters ──────────────────────────────────────────────

  public get numTeams(): number {
    return Number(this.inpTeams.value);
  }
  public get gridSize(): number {
    return Number(this.inpSize.value);
  }
  public get ticksPerFrame(): number {
    return Number(this.inpSpeed.value);
  }

  // ── Public methods ────────────────────────────────────────────────────────

  /** Register a callback invoked whenever the simulation must be (re)initialized. */
  public onReset(cb: () => void): void {
    this.resetCb = cb;
  }

  /** Record one painted frame. */
  public recordFrame(): void {
    this.fpsFrameCount++;
  }

  /** Write the accumulated frame count to the FPS counter and reset it. */
  private updateFps(): void {
    this.fpsCounter.textContent = `${this.fpsFrameCount} FPS`;
    this.fpsFrameCount = 0;
  }

  // ── State transitions ───────────────────────────────────────────────────────

  private setState(state: SimState): void {
    this._state = state;
    this.btnStart.hidden = state !== "preview";
    this.btnStop.hidden = state === "preview";
    this.btnPause.hidden = state !== "running";
    this.btnResume.hidden = state !== "paused";
    this.fpsCounter.hidden = state !== "running";

    if (state === "running") {
      this.fpsFrameCount = 0;
      this.fpsCounter.textContent = "";

      clearInterval(this.fpsInterval);
      this.fpsInterval = setInterval(() => this.updateFps(), 1000);
    }

    // Lock the reset-required sliders (teams, size) while the simulation is active.
    const locked = state !== "preview";
    this.inpTeams.disabled = locked;
    this.inpSize.disabled = locked;
  }

  // ── Private setup ─────────────────────────────────────────────────────────

  private initSliders(): void {
    this.inpTeams.min = String(BOUNDS.numTeams.min);
    this.inpTeams.max = String(computeMaxTeams(DEFAULTS.gridSize));
    this.inpTeams.value = String(DEFAULTS.numTeams);
    this.valTeams.textContent = String(DEFAULTS.numTeams);

    this.inpSize.min = String(BOUNDS.gridSize.min);
    this.inpSize.max = String(BOUNDS.gridSize.max);
    this.inpSize.value = String(DEFAULTS.gridSize);
    this.valSize.textContent = `${DEFAULTS.gridSize}x${DEFAULTS.gridSize}`;

    this.inpSpeed.min = String(BOUNDS.ticksPerFrame.min);
    this.inpSpeed.max = String(BOUNDS.ticksPerFrame.max);
    this.inpSpeed.value = String(DEFAULTS.ticksPerFrame);
    this.valSpeed.textContent = String(DEFAULTS.ticksPerFrame);
  }

  private wireButtons(): void {
    this.btnStart.addEventListener("click", () => {
      this.setState("running");
    });

    this.btnStop.addEventListener("click", () => {
      this.setState("preview");
      this.resetCb?.();
    });

    this.btnPause.addEventListener("click", () => {
      this.setState("paused");
    });

    this.btnResume.addEventListener("click", () => {
      this.setState("running");
    });
  }

  private wireSliders(): void {
    this.inpSize.addEventListener("input", () => {
      const gridSize = Number(this.inpSize.value);
      this.valSize.textContent = `${gridSize}x${gridSize}`;

      const curNumTeams = this.numTeams;
      const newMaxTeams = computeMaxTeams(gridSize);
      this.inpTeams.max = String(newMaxTeams);

      if (curNumTeams > newMaxTeams) {
        // `numTeams` is automatically clamped when the max is updated.
        // But if that happens, we need to update the UI and trigger the change callback.
        this.inpTeams.dispatchEvent(new Event("input"));
      } else {
        this.resetCb?.();
      }
    });

    this.inpTeams.addEventListener("input", () => {
      this.valTeams.textContent = this.inpTeams.value;
      this.resetCb?.();
    });

    this.inpSpeed.addEventListener("input", () => {
      this.valSpeed.textContent = this.inpSpeed.value;
      // ticksPerFrame affects running speed only; no simulation reset needed.
    });
  }
}

export const sidebar = new Sidebar();
