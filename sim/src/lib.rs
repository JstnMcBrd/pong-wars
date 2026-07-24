mod color;

use color::{Rgba, color_palette};
use js_sys::Float32Array;
use js_sys::Uint8ClampedArray;
use wasm_bindgen::prelude::*;

/// Ball radius in grid-space units. 0.5 radius gives a 1-cell diameter
/// so the collision bounding box covers at most 4 cells.
const BALL_RADIUS: f32 = 0.5;

/// Fraction of a cell that the ball moves per tick.
/// Must be <= 2 * BALL_RADIUS to guarantee no cell skipping.
const TICK_DISTANCE: f32 = 0.5;

#[wasm_bindgen]
pub struct Simulation {
    num_cols: usize,
    num_rows: usize,
    num_teams: usize,

    /// The color assigned to each team.
    team_colors: Vec<Rgba>,

    /// The grid as a flat RGBA pixel buffer, ready to hand to the canvas.
    /// A cell's color is its owning team's color.
    ///
    /// Layout: `idx = (col + row * num_cols) * 4, pixels[idx..idx+4] = [R, G, B, A]`.
    pixels: Vec<u8>,

    /// Layout: `[x_0, x_1, …, x_n]` where `n=num_teams-1`
    ball_pos_x: Vec<f32>,

    /// Layout: `[y_0, y_1, …, y_n]` where `n=num_teams-1`
    ball_pos_y: Vec<f32>,

    /// Layout: `[dx_0, dx_1, …, dx_n]` where `n=num_teams-1` and each value is ±1.
    ball_dir_x: Vec<f32>,

    /// Layout: `[dy_0, dy_1, …, dy_n]` where `n=num_teams-1` and each value is ±1.
    ball_dir_y: Vec<f32>,
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

        let team_colors = color_palette(num_teams);

        let pixels = vec![0; num_cols * num_rows * 4];
        let ball_pos_x = vec![0.0; num_teams];
        let ball_pos_y = vec![0.0; num_teams];
        let ball_dir_x = vec![0.0; num_teams];
        let ball_dir_y = vec![0.0; num_teams];

        let mut sim = Simulation {
            num_cols,
            num_rows,
            num_teams,

            team_colors,
            pixels,
            ball_pos_x,
            ball_pos_y,
            ball_dir_x,
            ball_dir_y,
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

    /// Return an owned copy of the grid as a flat RGBA `Uint8ClampedArray`.
    ///
    /// Layout: `idx = (col + row * num_cols) * 4, pixels[idx..idx+4] = [R, G, B, A]`.
    pub fn get_pixels(&self) -> Uint8ClampedArray {
        let arr = Uint8ClampedArray::new_with_length(self.pixels.len() as u32);
        arr.copy_from(&self.pixels);
        arr
    }

    /// Return an owned copy of all ball x positions as a flat `Float32Array`.
    ///
    /// Layout: `[x_0, x_1, …]` in grid-space units.
    pub fn get_ball_pos_x(&self) -> Float32Array {
        let arr = Float32Array::new_with_length(self.ball_pos_x.len() as u32);
        arr.copy_from(&self.ball_pos_x);
        arr
    }

    /// Return an owned copy of all ball y positions as a flat `Float32Array`.
    ///
    /// Layout: `[y_0, y_1, …, y_n]` in grid-space units.
    pub fn get_ball_pos_y(&self) -> Float32Array {
        let arr = Float32Array::new_with_length(self.ball_pos_y.len() as u32);
        arr.copy_from(&self.ball_pos_y);
        arr
    }
}

impl Simulation {
    fn init(&mut self) {
        let width = self.num_cols as f32;
        let height = self.num_rows as f32;
        let num_teams_f = self.num_teams as f32;

        // Place balls evenly on a circle centred on the grid.
        // Set movement direction to the closest diagonal tangent to the placement circle.
        let placement_radius = f32::min(width, height) * 0.3;
        let center_x = width / 2.0;
        let center_y = height / 2.0;
        for i in 0..self.num_teams {
            let angle = (i as f32 / num_teams_f) * std::f32::consts::TAU;
            let sin = angle.sin();
            let cos = angle.cos();

            self.ball_pos_x[i] = center_x + placement_radius * cos;
            self.ball_pos_y[i] = center_y + placement_radius * sin;

            self.ball_dir_x[i] = if sin < 0.0 { 1.0 } else { -1.0 };
            self.ball_dir_y[i] = if cos >= 0.0 { 1.0 } else { -1.0 };
        }

        // Assign each cell to the nearest ball's team on the same circle based on angle.
        // We shift φ by half a sector so each seed sits at the centre of its bucket, not at the boundary.
        let half_sector = std::f32::consts::TAU / (2.0 * num_teams_f);
        for row in 0..self.num_rows {
            for col in 0..self.num_cols {
                let idx = (col + row * self.num_cols) * 4;

                let dx = col as f32 + 0.5 - center_x;
                let dy = row as f32 + 0.5 - center_y;

                let phi = (dy.atan2(dx).rem_euclid(std::f32::consts::TAU) + half_sector)
                    % std::f32::consts::TAU;

                let team = (phi / std::f32::consts::TAU * num_teams_f) as usize;
                self.pixels[idx..idx + 4].copy_from_slice(&self.team_colors[team]);
            }
        }
    }

    fn tick(&mut self) {
        for i in 0..self.num_teams {
            self.update_ball(i);
        }
    }

    fn update_ball(&mut self, team: usize) {
        let width = self.num_cols as f32;
        let height = self.num_rows as f32;
        let team_color = self.team_colors[team];

        // 1. Move

        self.ball_pos_x[team] += self.ball_dir_x[team] * TICK_DISTANCE;
        self.ball_pos_y[team] += self.ball_dir_y[team] * TICK_DISTANCE;

        // 2. Wall bounce — clamp position to prevent corner-sticking.
        // TODO Maybe instead of clamping, consider reflecting off the wall and moving the remaining distance?

        if self.ball_pos_x[team] < BALL_RADIUS {
            self.ball_pos_x[team] = BALL_RADIUS;
            self.ball_dir_x[team] = 1.0;
        }
        if self.ball_pos_x[team] > width - BALL_RADIUS {
            self.ball_pos_x[team] = width - BALL_RADIUS;
            self.ball_dir_x[team] = -1.0;
        }
        if self.ball_pos_y[team] < BALL_RADIUS {
            self.ball_pos_y[team] = BALL_RADIUS;
            self.ball_dir_y[team] = 1.0;
        }
        if self.ball_pos_y[team] > height - BALL_RADIUS {
            self.ball_pos_y[team] = height - BALL_RADIUS;
            self.ball_dir_y[team] = -1.0;
        }

        // 3. Cell collision

        // Bounding box of the ball's circle in cell coordinates.
        // Because grid-space position == cell index, floor() gives the cell directly.
        // TODO Consider using ball radius to calculate a circular bounding area
        // FIXME Does this create a square collider area?
        let col_min = (self.ball_pos_x[team] - BALL_RADIUS).max(0.0) as usize;
        let col_max = (self.ball_pos_x[team] + BALL_RADIUS).min(width - 1.0) as usize;
        let row_min = (self.ball_pos_y[team] - BALL_RADIUS).max(0.0) as usize;
        let row_max = (self.ball_pos_y[team] + BALL_RADIUS).min(height - 1.0) as usize;

        let mut reflect_x = false;
        let mut reflect_y = false;

        for row in row_min..=row_max {
            for col in col_min..=col_max {
                let idx = (col + row * self.num_cols) * 4;
                if self.pixels[idx..idx + 4] != team_color {
                    self.pixels[idx..idx + 4].copy_from_slice(&team_color);

                    // Determine reflection axis from the cell center → ball vector.
                    let cell_cx = col as f32 + 0.5;
                    let cell_cy = row as f32 + 0.5;
                    let dx = (cell_cx - self.ball_pos_x[team]).abs();
                    let dy = (cell_cy - self.ball_pos_y[team]).abs();
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
            self.ball_dir_x[team] *= -1.0;
        }
        if reflect_y {
            self.ball_dir_y[team] *= -1.0;
        }
        // TODO Consider calculating reflection point and reflecting off the wall and moving the remaining distance,
        // instead of just ignoring the overlap
    }
}
