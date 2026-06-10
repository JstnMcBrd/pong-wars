use wasm_bindgen::prelude::*;
use js_sys::Uint16Array;
use js_sys::Float32Array;

/// Fraction of a cell that the ball moves per tick.
/// Must be < 0.5 to guarantee no cell skipping.
const TICK_VELOCITY: f32 = 0.45;

/// Ball radius in grid-space units (same as TICK_VELOCITY so the
/// collision bounding box always covers at most 4 cells).
const BALL_RADIUS: f32 = 0.45;

#[wasm_bindgen]
pub struct Simulation {
    num_cols: usize,
    num_rows: usize,
    num_teams: usize,

    /// Layout: `grid[col + row * grid_cols] = team index`
    grid: Vec<u16>,

    /// Layout: `[x_0, y_0, x_1, y_1, …, x_n, y_n]` where `n=num_teams-1`
    ball_positions: Vec<f32>,

    /// Layout: `[dx_0, dy_0, dx_1, dy_1, …, dx_n, dy_n]`
    /// where `n=num_teams-1` and each value is ±1.
    ball_directions: Vec<f32>,
}

#[wasm_bindgen]
impl Simulation {
    /// Create and initialize a new simulation.
    #[wasm_bindgen(constructor)]
    pub fn new(num_cols: usize, num_rows: usize, num_teams: usize) -> Simulation {
        if num_cols > f32::MAX as usize || num_rows > f32::MAX as usize {
            panic!("num_cols and num_rows cannot exceed {}", f32::MAX);
        }
        if num_teams > u16::MAX as usize {
            panic!("num_teams cannot exceed {}", u16::MAX);
        }

        let grid = vec![0; num_cols * num_rows];
        let ball_positions = vec![0.0; num_teams * 2];
        let ball_directions = vec![0.0; num_teams * 2];

        let mut sim = Simulation {
            num_cols,
            num_rows,
            num_teams,

            grid,
            ball_positions,
            ball_directions,
        };
        sim.init();
        sim
    }

    /// Advance the simulation by `n` ticks.
    pub fn tick_n(&mut self, n: u32) {
        for _ in 0..n {
            self.tick();
        }
    }

    /// Return a view of the grid as a flat `Uint16Array`.
    /// 
    /// Layout: `grid[col + row * grid_cols] = team index`.
    /// 
    /// UNSAFE: provides direct access into wasm's linear memory.
    /// The caller **must** clone/copy the view to transfer across worker threads.
    pub unsafe fn get_grid(&self) -> Uint16Array {
        unsafe { Uint16Array::view(&self.grid) }
    }

    /// Return a view of all ball positions as a flat `Float32Array`.
    /// 
    /// Layout: `[x_0, y_0, x_1, y_1, …]` in grid-space units.
    /// 
    /// UNSAFE: provides direct access into wasm's linear memory.
    /// The caller **must** clone/copy the view to transfer across worker threads.
    pub unsafe fn get_ball_positions(&self) -> Float32Array {
        unsafe { Float32Array::view(&self.ball_positions) }
    }
}

impl Simulation {
    fn init(&mut self) {
        let w = self.num_cols as f32;
        let h = self.num_rows as f32;
        let n = self.num_teams;
        let nf = n as f32;

        // Place balls evenly on a circle centred on the grid.
        // Set movement direction to the closest diagonal tangent to the placement circle.
        let r = f32::min(w, h) * 0.3;
        let cx = w / 2.0;
        let cy = h / 2.0;
        for i in 0..n {
            let x_idx = i * 2;
            let y_idx = i * 2 + 1;

            let angle = (i as f32 / nf) * std::f32::consts::TAU;
            let sin = angle.sin();
            let cos = angle.cos();

            self.ball_positions[x_idx] = cx + r * cos;
            self.ball_positions[y_idx] = cy + r * sin;

            self.ball_directions[x_idx] = if sin <  0.0 { 1.0 } else { -1.0 };
            self.ball_directions[y_idx] = if cos >= 0.0 { 1.0 } else { -1.0 };
        }

        // Assign each cell to the nearest ball's team on the same circle based on angle.
        // We shift φ by half a sector so each seed sits at the centre of its bucket, not at the boundary.
        let half_sector = std::f32::consts::TAU / (2.0 * nf);
        for row in 0..self.num_rows {
            for col in 0..self.num_cols {
                let idx = col + row * self.num_cols;

                let dx = col as f32 + 0.5 - cx;
                let dy = row as f32 + 0.5 - cy;

                let phi = (dy.atan2(dx).rem_euclid(std::f32::consts::TAU) + half_sector) % std::f32::consts::TAU;
                
                let team = (phi / std::f32::consts::TAU * nf) as u16;
                self.grid[idx] = team;
            }
        }
    }

    fn tick(&mut self) {
        for i in 0..self.num_teams {
            self.update_ball(i as u16);
        }
    }

    fn update_ball(&mut self, team: u16) {
        let w = self.num_cols as f32;
        let h = self.num_rows as f32;
        let r = BALL_RADIUS;
        let x_idx = team as usize * 2;
        let y_idx = team as usize * 2 + 1;

        // 1. Move

        self.ball_positions[x_idx] += self.ball_directions[x_idx] * TICK_VELOCITY;
        self.ball_positions[y_idx] += self.ball_directions[y_idx] * TICK_VELOCITY;

        // 2. Wall bounce — clamp position to prevent corner-sticking.
        // TODO Maybe instead of clamping, consider reflecting off the wall and moving the remaining distance?

        if self.ball_positions[x_idx] < r {
            self.ball_positions[x_idx] = r;
            self.ball_directions[x_idx] = 1.0;
        }
        if self.ball_positions[x_idx] > w - r {
            self.ball_positions[x_idx] = w - r;
            self.ball_directions[x_idx] = -1.0;
        }
        if self.ball_positions[y_idx] < r {
            self.ball_positions[y_idx] = r;
            self.ball_directions[y_idx] = 1.0;
        }
        if self.ball_positions[y_idx] > h - r {
            self.ball_positions[y_idx] = h - r;
            self.ball_directions[y_idx] = -1.0;
        }

        // 3. Cell collision

        // Bounding box of the ball's circle in cell coordinates.
        // Because grid-space position == cell index, floor() gives the cell directly.
        // TODO Consider using ball radius to calculate a circular bounding area
        let col_min = (self.ball_positions[x_idx] - r).max(0.0) as usize;
        let col_max = (self.ball_positions[x_idx] + r).min(w - 1.0) as usize;
        let row_min = (self.ball_positions[y_idx] - r).max(0.0) as usize;
        let row_max = (self.ball_positions[y_idx] + r).min(h - 1.0) as usize;

        let mut reflect_x = false;
        let mut reflect_y = false;

        for row in row_min..=row_max {
            for col in col_min..=col_max {
                let idx = col + row * self.num_cols;
                if self.grid[idx] != team {
                    self.grid[idx] = team;

                    // Determine reflection axis from the cell center → ball vector.
                    let cell_cx = col as f32 + 0.5;
                    let cell_cy = row as f32 + 0.5;
                    let dx = (cell_cx - self.ball_positions[x_idx]).abs();
                    let dy = (cell_cy - self.ball_positions[y_idx]).abs();
                    if dx >= dy {
                        reflect_x = true;
                    }
                    if dx <= dy {
                        reflect_y = true;
                    }
                }
            }
        }

        if reflect_x {
            self.ball_directions[x_idx] *= -1.0;
        }
        if reflect_y {
            self.ball_directions[y_idx] *= -1.0;
        }
        // TODO Consider calculating reflection point and reflecting off the wall and moving the remaining distance,
        // instead of just ignoring the overlap
    }
}
