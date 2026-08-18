import { createIcons, Pause, Play, Square } from "lucide";

createIcons({ icons: { Pause, Play, Square } });

type SimState = "preview" | "running" | "paused";

// ── Settings ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  gridSize: 26,
  numTeams: 2,
  ticksPerFrame: 1,
};

/** Largest grid we choose to offer, even if the device could hold more. */
const MAX_GRID_SIZE_CAP = 500;

function getBounds(gpuMaxGridSize: number) {
  return {
    gridSize: { min: 10, max: Math.min(gpuMaxGridSize, MAX_GRID_SIZE_CAP) },
    numTeams: {
      min: 2,
      /** The maximum number of teams depends on the current grid size. */
      max(gridSize: number): number {
        const circumference = Math.PI * 2 * (gridSize / 4);
        return Math.floor(circumference / 2);
      },
    },
    ticksPerFrame: { min: 1, max: 500 },
  };
}

// ── FPS counter ─────────────────────────────────────────────────────────────

const FPS_UPDATE_INTERVAL_MS = 500;
const FPS_WARN_THRESHOLD = 60;
const FPS_DANGER_THRESHOLD = 30;

// ── Sidebar class ───────────────────────────────────────────────────────────

/**
 * DOM wrapper for the sidebar panel. Owns the simulation control buttons
 * (start/stop/pause/resume) and the settings sliders (size/teams/speed),
 * tracks the {@link SimState}, and exposes the live setting values.
 */
export class Sidebar {
  private readonly btnStart: HTMLButtonElement;
  private readonly btnStop: HTMLButtonElement;
  private readonly btnPause: HTMLButtonElement;
  private readonly btnResume: HTMLButtonElement;

  private readonly sliderBounds: ReturnType<typeof getBounds>;

  private readonly inpSize: HTMLInputElement;
  private readonly valSize: HTMLSpanElement;
  private readonly decSize: HTMLButtonElement;
  private readonly incSize: HTMLButtonElement;

  private readonly inpTeams: HTMLInputElement;
  private readonly valTeams: HTMLSpanElement;
  private readonly decTeams: HTMLButtonElement;
  private readonly incTeams: HTMLButtonElement;

  private readonly inpSpeed: HTMLInputElement;
  private readonly valSpeed: HTMLSpanElement;
  private readonly decSpeed: HTMLButtonElement;
  private readonly incSpeed: HTMLButtonElement;

  private readonly fpsCounter: HTMLSpanElement;
  private fpsFrameCount = 0;
  private fpsInterval = 0;

  private _state: SimState = "preview";
  private resetCb: (() => void) | null = null;

  /** @param gpuMaxGridSize the largest grid the GPU can handle. */
  public constructor(gpuMaxGridSize: number) {
    this.btnStart = document.getElementById("btn-start") as HTMLButtonElement;
    this.btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
    this.btnPause = document.getElementById("btn-pause") as HTMLButtonElement;
    this.btnResume = document.getElementById("btn-resume") as HTMLButtonElement;

    this.sliderBounds = getBounds(gpuMaxGridSize);

    this.inpSize = document.getElementById("inp-size") as HTMLInputElement;
    this.valSize = document.getElementById("val-size") as HTMLSpanElement;
    this.decSize = document.getElementById("dec-size") as HTMLButtonElement;
    this.incSize = document.getElementById("inc-size") as HTMLButtonElement;

    this.inpTeams = document.getElementById("inp-teams") as HTMLInputElement;
    this.valTeams = document.getElementById("val-teams") as HTMLSpanElement;
    this.decTeams = document.getElementById("dec-teams") as HTMLButtonElement;
    this.incTeams = document.getElementById("inc-teams") as HTMLButtonElement;

    this.inpSpeed = document.getElementById("inp-speed") as HTMLInputElement;
    this.valSpeed = document.getElementById("val-speed") as HTMLSpanElement;
    this.decSpeed = document.getElementById("dec-speed") as HTMLButtonElement;
    this.incSpeed = document.getElementById("inc-speed") as HTMLButtonElement;

    this.fpsCounter = document.getElementById("fps-counter") as HTMLSpanElement;

    this.initSliders();
    this.wireButtons();
    this.wireSliders();
    this.wireStepButtons();
    this.setState("preview");
  }

  // ── State ─────────────────────────────────────────────────────────────────

  public get state(): SimState {
    return this._state;
  }

  // ── DOM-backed setting getters ──────────────────────────────────────────────

  public get gridSize(): number {
    return this.inpSize.valueAsNumber;
  }
  public get numTeams(): number {
    return this.inpTeams.valueAsNumber;
  }
  public get ticksPerFrame(): number {
    return this.inpSpeed.valueAsNumber;
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
    const fps = Math.round(this.fpsFrameCount * (1000 / FPS_UPDATE_INTERVAL_MS));
    const warn = fps < FPS_WARN_THRESHOLD && fps >= FPS_DANGER_THRESHOLD;
    const danger = fps < FPS_DANGER_THRESHOLD;

    // Reset the frame count for the next interval
    this.fpsFrameCount = 0;

    // Update appearance
    this.fpsCounter.textContent = `${fps} FPS`;
    this.fpsCounter.classList.toggle("fps-warn", warn);
    this.fpsCounter.classList.toggle("fps-danger", danger);
  }

  // ── State transitions ───────────────────────────────────────────────────────

  private setState(state: SimState): void {
    this._state = state;
    this.btnStart.hidden = state !== "preview";
    this.btnStop.hidden = state === "preview";
    this.btnPause.hidden = state !== "running";
    this.btnResume.hidden = state !== "paused";

    if (state === "running") {
      this.fpsFrameCount = 0;
      this.fpsInterval = setInterval(() => this.updateFps(), FPS_UPDATE_INTERVAL_MS);
    } else {
      this.fpsCounter.textContent = "";
      clearInterval(this.fpsInterval);
    }

    // Lock the reset-required sliders (size, teams) while the simulation is active.
    const locked = state !== "preview";
    this.inpSize.disabled = locked;
    this.inpTeams.disabled = locked;
  }

  // ── Private setup ─────────────────────────────────────────────────────────

  private initSliders(): void {
    this.inpSize.min = String(this.sliderBounds.gridSize.min);
    this.inpSize.max = String(this.sliderBounds.gridSize.max);
    this.inpSize.value = String(DEFAULTS.gridSize);
    this.valSize.textContent = `${DEFAULTS.gridSize}x${DEFAULTS.gridSize}`;

    this.inpTeams.min = String(this.sliderBounds.numTeams.min);
    this.inpTeams.max = String(this.sliderBounds.numTeams.max(DEFAULTS.gridSize));
    this.inpTeams.value = String(DEFAULTS.numTeams);
    this.valTeams.textContent = String(DEFAULTS.numTeams);

    this.inpSpeed.min = String(this.sliderBounds.ticksPerFrame.min);
    this.inpSpeed.max = String(this.sliderBounds.ticksPerFrame.max);
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

  /** Nudge a slider by `delta`, clamped to its bounds. */
  private step(input: HTMLInputElement, delta: number): void {
    const next = Math.min(Math.max(input.valueAsNumber + delta, +input.min), +input.max);
    if (next === input.valueAsNumber) {
      return;
    }
    input.valueAsNumber = next;
    // Trigger the change callback, as if the user had dragged the slider.
    input.dispatchEvent(new Event("input"));
  }

  private wireStepButtons(): void {
    this.decSize.addEventListener("click", () => this.step(this.inpSize, -1));
    this.incSize.addEventListener("click", () => this.step(this.inpSize, +1));

    this.decTeams.addEventListener("click", () => this.step(this.inpTeams, -1));
    this.incTeams.addEventListener("click", () => this.step(this.inpTeams, +1));

    this.decSpeed.addEventListener("click", () => this.step(this.inpSpeed, -1));
    this.incSpeed.addEventListener("click", () => this.step(this.inpSpeed, +1));
  }

  private wireSliders(): void {
    this.inpSize.addEventListener("input", () => {
      const gridSize = this.inpSize.valueAsNumber;
      this.valSize.textContent = `${gridSize}x${gridSize}`;

      const curNumTeams = this.numTeams;
      const newMaxTeams = this.sliderBounds.numTeams.max(gridSize);
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
