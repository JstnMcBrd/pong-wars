mod color;

use color::{Rgba, color_palette};
use js_sys::Float32Array;
use js_sys::Uint8ClampedArray;
use wasm_bindgen::prelude::*;

/// Ball radius in grid-space units. 0.5 radius gives a 1-cell diameter
/// so the collision bounding box covers at most 4 cells.
const BALL_RADIUS: f32 = 0.5;

/// Fraction of a cell that the ball moves per tick, along each axis.
/// Seeds the velocity arrays, so a move is a plain add and a bounce is a negation.
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

    /// Layout: `[vx_0, vx_1, …, vx_n]` where `n=num_teams-1` and each value is ±`TICK_DISTANCE`.
    ball_vel_x: Vec<f32>,

    /// Layout: `[vy_0, vy_1, …, vy_n]` where `n=num_teams-1` and each value is ±`TICK_DISTANCE`.
    ball_vel_y: Vec<f32>,
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
        let ball_vel_x = vec![0.0; num_teams];
        let ball_vel_y = vec![0.0; num_teams];

        let mut sim = Simulation {
            num_cols,
            num_rows,
            num_teams,

            team_colors,
            pixels,
            ball_pos_x,
            ball_pos_y,
            ball_vel_x,
            ball_vel_y,
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
        // Set velocity to the closest diagonal tangent to the placement circle.
        let placement_radius = f32::min(width, height) * 0.3;
        let center_x = width / 2.0;
        let center_y = height / 2.0;
        for i in 0..self.num_teams {
            let angle = (i as f32 / num_teams_f) * std::f32::consts::TAU;
            let sin = angle.sin();
            let cos = angle.cos();

            self.ball_pos_x[i] = center_x + placement_radius * cos;
            self.ball_pos_y[i] = center_y + placement_radius * sin;

            self.ball_vel_x[i] = TICK_DISTANCE * if sin < 0.0 { 1.0 } else { -1.0 };
            self.ball_vel_y[i] = TICK_DISTANCE * if cos >= 0.0 { 1.0 } else { -1.0 };
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

    /// Advance every ball by one tick, one phase at a time.
    fn tick(&mut self) {
        self.update_motion();
        self.update_cell_collisions();
    }

    /// Phase 1 — move every ball and bounce it off the grid edges.
    ///
    /// The bounce is a compare-and-select rather than a mutating `if` block,
    /// because selects vectorize and branches do not. `clamp` would be shorter
    /// but its NaN semantics differ from the Wasm `f32.min` / `f32.max`
    /// instructions, which costs fix-up code.
    fn update_motion(&mut self) {
        // Clamp position to prevent corner-sticking.
        // TODO Maybe instead of clamping, consider reflecting off the wall and moving the remaining distance?

        let max_x = self.num_cols as f32 - BALL_RADIUS;
        for (pos, vel) in self.ball_pos_x.iter_mut().zip(self.ball_vel_x.iter_mut()) {
            let moved = *pos + *vel;
            let below = moved < BALL_RADIUS;
            let above = moved > max_x;
            *pos = if below {
                BALL_RADIUS
            } else if above {
                max_x
            } else {
                moved
            };
            *vel = if below || above { -*vel } else { *vel };
        }

        let max_y = self.num_rows as f32 - BALL_RADIUS;
        for (pos, vel) in self.ball_pos_y.iter_mut().zip(self.ball_vel_y.iter_mut()) {
            let moved = *pos + *vel;
            let below = moved < BALL_RADIUS;
            let above = moved > max_y;
            *pos = if below {
                BALL_RADIUS
            } else if above {
                max_y
            } else {
                moved
            };
            *vel = if below || above { -*vel } else { *vel };
        }
    }

    /// Phase 2 — paint the cells each ball overlaps and reflect off the ones it captures.
    ///
    /// Serial by nature: the visited cell count is data-dependent, the write is
    /// conditional, and each ball must see the grid left by the balls before it.
    fn update_cell_collisions(&mut self) {
        let width = self.num_cols as f32;
        let height = self.num_rows as f32;

        for team in 0..self.num_teams {
            let team_color = self.team_colors[team];
            let pos_x = self.ball_pos_x[team];
            let pos_y = self.ball_pos_y[team];

            // Bounding box of the ball's circle in cell coordinates.
            // Because grid-space position == cell index, floor() gives the cell directly.
            // TODO Consider using ball radius to calculate a circular bounding area
            // FIXME Does this create a square collider area?
            let col_min = (pos_x - BALL_RADIUS).max(0.0) as usize;
            let col_max = (pos_x + BALL_RADIUS).min(width - 1.0) as usize;
            let row_min = (pos_y - BALL_RADIUS).max(0.0) as usize;
            let row_max = (pos_y + BALL_RADIUS).min(height - 1.0) as usize;

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
                        let dist_x = (cell_cx - pos_x).abs();
                        let dist_y = (cell_cy - pos_y).abs();
                        if dist_x >= dist_y {
                            reflect_x = true;
                        }
                        if dist_x <= dist_y {
                            reflect_y = true;
                        }
                    }
                }
            }

            if reflect_x {
                self.ball_vel_x[team] *= -1.0;
            }
            if reflect_y {
                self.ball_vel_y[team] *= -1.0;
            }
            // TODO Consider calculating reflection point and reflecting off the wall and moving the remaining distance,
            // instead of just ignoring the overlap
        }
    }
}
