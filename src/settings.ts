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

// ── Settings class ───────────────────────────────────────────────────────────

class Settings {
  private readonly popup: HTMLDivElement;
  private readonly btnSettings: HTMLButtonElement;
  private readonly inpTeams: HTMLInputElement;
  private readonly valTeams: HTMLSpanElement;
  private readonly inpSize: HTMLInputElement;
  private readonly valSize: HTMLSpanElement;
  private readonly inpSpeed: HTMLInputElement;
  private readonly valSpeed: HTMLSpanElement;

  private changeCb: (() => void) | null = null;

  constructor() {
    this.popup = document.getElementById("settings-popup") as HTMLDivElement;
    this.btnSettings = document.getElementById("btn-settings") as HTMLButtonElement;
    this.inpTeams = document.getElementById("inp-teams") as HTMLInputElement;
    this.valTeams = document.getElementById("val-teams") as HTMLSpanElement;
    this.inpSize = document.getElementById("inp-size") as HTMLInputElement;
    this.valSize = document.getElementById("val-size") as HTMLSpanElement;
    this.inpSpeed = document.getElementById("inp-speed") as HTMLInputElement;
    this.valSpeed = document.getElementById("val-speed") as HTMLSpanElement;

    this.initSliders();
    this.wirePopup();
    this.wireSliders();
  }

  // ── DOM-backed getters ────────────────────────────────────────────────────

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

  /** Register a callback invoked when a setting changes that requires a simulation reset. */
  public onChange(cb: () => void): void {
    this.changeCb = cb;
  }

  /** Disable reset-required settings (gridSize, numTeams) while the simulation runs. */
  public setRunning(running: boolean): void {
    this.inpTeams.disabled = running;
    this.inpSize.disabled = running;
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

  private wirePopup(): void {
    // Show/hide pop when settings button clicked
    this.btnSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      this.popup.classList.toggle("hidden");
    });

    // Hide popup when clicking outside of it
    document.addEventListener("click", (e) => {
      if (!this.popup.contains(e.target as Node) && !this.popup.classList.contains("hidden")) {
        this.popup.classList.add("hidden");
      }
    });

    // Hide popup on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.popup.classList.add("hidden");
      }
    });

    // Prevent clicks inside the popup from hiding it
    this.popup.addEventListener("click", (e) => e.stopPropagation());
  }

  private wireSliders(): void {
    this.inpSize.addEventListener("input", () => {
      this.valSize.textContent = `${this.gridSize}x${this.gridSize}`;

      const curNumTeams = this.numTeams;
      const newMaxTeams = computeMaxTeams(this.gridSize);
      this.inpTeams.max = String(newMaxTeams);

      if (curNumTeams > newMaxTeams) {
        // `numTeams` is automatically clamped when the max is updated.
        // But if that happens, we need to update the UI and trigger the change callback.
        this.inpTeams.dispatchEvent(new Event("input"));
      } else {
        this.changeCb?.();
      }
    });

    this.inpTeams.addEventListener("input", () => {
      this.valTeams.textContent = this.inpTeams.value;
      this.changeCb?.();
    });

    this.inpSpeed.addEventListener("input", () => {
      this.valSpeed.textContent = this.inpSpeed.value;
      // ticksPerFrame affects running speed only; no simulation reset needed.
    });
  }
}

export const settings = new Settings();
