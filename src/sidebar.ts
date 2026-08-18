import { createIcons, Pause, Play, Square } from "lucide";

createIcons({ icons: { Pause, Play, Square } });

type SimState = "preview" | "running" | "paused";

// ── Settings ────────────────────────────────────────────────────────────────

/** Largest grid we choose to offer, even if the device could hold more. */
const MAX_GRID_SIZE_CAP = 500;

/** The maximum number of teams depends on the current grid size. */
function maxTeams(gridSize: number): number {
  const circumference = Math.PI * 2 * (gridSize / 4);
  return Math.floor(circumference / 2);
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

  private readonly gridSizeSlider: Slider;
  private readonly numTeamsSlider: Slider;
  private readonly ticksPerFrameSlider: Slider;

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

    this.gridSizeSlider = new Slider("grid-size", {
      min: 10,
      max: Math.min(gpuMaxGridSize, MAX_GRID_SIZE_CAP),
      default: 26,
      format: (gridSize) => `${gridSize}x${gridSize}`,
      onInput: () => {
        this.numTeamsSlider.max = maxTeams(this.gridSizeSlider.value);
        this.resetCb?.();
      },
    });

    this.numTeamsSlider = new Slider("num-teams", {
      min: 2,
      max: maxTeams(this.gridSizeSlider.value),
      default: 2,
      onInput: () => this.resetCb?.(),
    });

    this.ticksPerFrameSlider = new Slider("ticks-per-frame", {
      min: 1,
      max: 500,
      default: 1,
      onInput: () => {}, // Speed affects running speed only; no simulation reset needed.
    });

    this.fpsCounter = document.getElementById("fps-counter") as HTMLSpanElement;

    this.wireButtons();
    this.setState("preview");
  }

  // ── State ─────────────────────────────────────────────────────────────────

  public get state(): SimState {
    return this._state;
  }

  // ── DOM-backed setting getters ──────────────────────────────────────────────

  public get gridSize(): number {
    return this.gridSizeSlider.value;
  }
  public get numTeams(): number {
    return this.numTeamsSlider.value;
  }
  public get ticksPerFrame(): number {
    return this.ticksPerFrameSlider.value;
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
    this.gridSizeSlider.disabled = locked;
    this.numTeamsSlider.disabled = locked;
  }

  // ── Private setup ─────────────────────────────────────────────────────────

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
}

// ── Slider class ────────────────────────────────────────────────────────────

/**
 * DOM wrapper for one labeled range input and its decrement/increment buttons.
 * Finds its own elements by convention, so the four ids stay in agreement:
 * `inp-<id>`, `val-<id>`, `dec-<id>`, `inc-<id>`.
 */
class Slider {
  private readonly input: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly format: (value: number) => string;
  private readonly onInput: () => void;

  public constructor(
    id: string,
    options: {
      min: number;
      max: number;
      default: number;
      /** Renders the value into the label. Defaults to `String`. */
      format?: (value: number) => string;
      onInput: () => void;
    },
  ) {
    this.input = document.getElementById(`inp-${id}`) as HTMLInputElement;
    this.label = document.getElementById(`val-${id}`) as HTMLSpanElement;
    const dec = document.getElementById(`dec-${id}`) as HTMLButtonElement;
    const inc = document.getElementById(`inc-${id}`) as HTMLButtonElement;

    this.format = options.format ?? String;
    this.onInput = options.onInput;

    this.input.min = String(options.min);
    this.input.max = String(options.max);
    this.input.value = String(options.default);
    this.paint();

    this.input.addEventListener("input", () => this.changed());
    dec.addEventListener("click", () => this.step(-1));
    inc.addEventListener("click", () => this.step(+1));
  }

  public get value(): number {
    return this.input.valueAsNumber;
  }

  public set max(max: number) {
    this.input.max = String(max);

    // The browser automatically clamps the value, so all we need to do is repaint.
    this.paint();

    // `onInput` does not fire — the caller already knows the setting changed.
  }

  public set disabled(disabled: boolean) {
    this.input.disabled = disabled;
  }

  /** Nudge the value by `delta`, clamped to the bounds. */
  private step(delta: number): void {
    const next = Math.min(Math.max(this.value + delta, +this.input.min), +this.input.max);
    if (next === this.value) {
      return;
    }
    this.input.valueAsNumber = next;
    this.changed();
  }

  /** Both a slider drag and a step button land here. */
  private changed(): void {
    this.paint();
    this.onInput();
  }

  private paint(): void {
    this.label.textContent = this.format(this.value);
  }
}
