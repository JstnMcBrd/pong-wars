// ── Bindings ────────────────────────────────────────────────────────────────

@group(0) @binding(0) var<uniform> canvas_dim: vec2<u32>;
@group(0) @binding(1) var<uniform> grid_dim: vec2<u32>;
@group(0) @binding(2) var<uniform> num_teams: u32;
@group(0) @binding(3) var<uniform> num_ticks: u32;

@group(1) @binding(0) var<storage, read_write> grid: array<atomic<u32>>;
@group(1) @binding(1) var<storage, read_write> balls: array<Ball>;

struct Ball {
  /// Position in grid-space
  position: vec2<f32>,
  /// Velocity in grid-space
  velocity: vec2<f32>
};

// ── Common ──────────────────────────────────────────────────────────────────

/// Ball radius in grid-space units.
/// 0.5 gives a one-cell diameter, which is what keeps the collision box a constant 2x2.
const BALL_RADIUS = 0.5;

/// Distance a ball moves per tick along each axis.
/// Must be <= 2 * BALL_RADIUS, or a ball could skip over cells.
/// Must not be a unit fraction of 1 (aka 1/N) to avoid resonance / quantized movement.
/// Must not be too close to a unit fraction of 1 because bounce-clamping will re-quantize it.
///
/// Goal: ticks_per_cycle < avg_ticks_per_bounce
///       ticks_per_cycle = 1 / (1 - TICK_DISTANCE)
///       avg_ticks_per_bounce depends on ball density (grid_size / num_teams).
/// Tl;dr - you may need to re-evaluate TICK_DISTANCE if you change the max grid size or number of teams.
const TICK_DISTANCE = 0.45;

/// Convert a grid coordinate into the grid buffer's row-major index.
/// Assumes the coordinates are in-bounds.
fn grid_coord_to_index(coord: vec2<u32>) -> u32 {
  return coord.x + coord.y * grid_dim.x;
}

// ── Initialization ──────────────────────────────────────────────────────────

const PI = 3.141592653589793;
const TAU = PI * 2.0;

override INIT_GRID_WORKGROUP_SIZE = 16u;

@compute @workgroup_size(INIT_GRID_WORKGROUP_SIZE, INIT_GRID_WORKGROUP_SIZE)
fn init_grid(@builtin(global_invocation_id) id: vec3<u32>) {
  let coord = id.xy;
  if any(coord >= grid_dim) {
    return;
  }

  let index = grid_coord_to_index(coord);

  let num_teams_f = f32(num_teams);
  let coord_f = vec2<f32>(coord);
  let grid_dim_f = vec2<f32>(grid_dim);

  let offset = coord_f + 0.5 - grid_dim_f * 0.5;
  let half_sector = TAU / (2.0 * num_teams_f);
  let phi = ((atan2(offset.y, offset.x) + TAU) % TAU + half_sector) % TAU;

  let team = min(u32(phi / TAU * num_teams_f), num_teams - 1u);
  atomicStore(&grid[index], team);
}

override INIT_BALLS_WORKGROUP_SIZE = 64u;

@compute @workgroup_size(INIT_BALLS_WORKGROUP_SIZE)
fn init_balls(@builtin(global_invocation_id) id: vec3<u32>) {
  let team = id.x;
  if team >= num_teams {
    return;
  }

  let team_f = f32(team);
  let num_teams_f = f32(num_teams);
  let grid_dim_f = vec2<f32>(grid_dim);

  let angle = team_f / num_teams_f * TAU;
  let radial = vec2(cos(angle), sin(angle));

  balls[team].position = grid_dim_f * 0.5 + min(grid_dim_f.x, grid_dim_f.y) * 0.3 * radial;
  balls[team].velocity = vec2(
    select(-1.0, 1.0, radial.y < 0.0),
    select(-1.0, 1.0, radial.x >= 0.0)
  ) * TICK_DISTANCE;
}

// ── Simulation ──────────────────────────────────────────────────────────────

override SIM_WORKGROUP_SIZE = 256u;

/// Only 1 workgroup allowed because cross-workgroup synchronization is not supported.
@compute @workgroup_size(SIM_WORKGROUP_SIZE)
fn sim(@builtin(local_invocation_id) id: vec3<u32>) {
  for (var tick = 0u; tick < num_ticks; tick++) {
    for (var team = id.x; team < num_teams; team += SIM_WORKGROUP_SIZE) {
      update_ball(team);
    }
    storageBarrier(); // Sync all invocations before the next tick
  }
}

/// Move one ball, bounce it off the walls, and paint the cells it covers.
/// Balls run concurrently. Conflicts are resolved by last-write-wins.
fn update_ball(team: u32) {
  var pos = balls[team].position;
  var vel = balls[team].velocity;

  // Move, and reverse on whichever axes ran into a wall.
  let low = vec2(BALL_RADIUS);
  let high = vec2<f32>(grid_dim) - BALL_RADIUS;
  let moved = pos + vel;
  pos = clamp(moved, low, high);
  vel = select(vel, -vel, (moved < low) | (moved > high));

  // The collision box is always exactly 2x2. The span [pos - 0.5, pos + 0.5]
  // is one cell wide, so it straddles exactly two cell boundaries per axis.
  let first = vec2<u32>(floor(pos - BALL_RADIUS));
  let last = grid_dim - 1;
  var bounce = vec2<bool>();

  for (var dy = 0u; dy < 2; dy++) {
    for (var dx = 0u; dx < 2; dx++) {
      let cell = clamp(first + vec2(dx, dy), vec2(), last);
      let index = grid_coord_to_index(cell);

      if atomicLoad(&grid[index]) != team {
        atomicStore(&grid[index], team);

        // Bounce along whichever axis the captured cell lies furthest
        // along, measured center to center. A perfect diagonal does both.
        let reach = abs(vec2<f32>(cell) + 0.5 - pos);
        bounce = bounce | vec2(reach.x >= reach.y, reach.x <= reach.y);
      }
    }
  }

  balls[team].position = pos;
  balls[team].velocity = select(vel, -vel, bounce);
}

// ── Rendering ───────────────────────────────────────────────────────────────

/// Read-only alias for grid to avoid atomics.
@group(1) @binding(0) var<storage, read> grid_ro: array<u32>;

/// Read-only alias for balls because @vertex functions can't read writable storage buffers.
@group(1) @binding(1) var<storage, read> balls_ro: array<Ball>;

const MIN_BALL_RADIUS_PX = 2.0;

/// Convert a position in grid space (0 to grid_dim) to clip space (-1.0 to 1.0).
fn grid_to_clip_pos(grid_pos: vec2<f32>) -> vec2<f32> {
  let norm_pos = grid_pos / vec2<f32>(grid_dim);
  let clip_pos = norm_pos * 2.0 - vec2(1.0, 1.0);
  return clip_pos;
}

/// Convert a size in grid space (0 to grid_dim) to clip space (-1.0 to 1.0).
fn grid_to_clip_size(grid_size: vec2<f32>) -> vec2<f32> {
  let norm_size = grid_size / vec2<f32>(grid_dim);
  let clip_size = norm_size * 2.0;
  return clip_size;
}

/// Convert a position in clip space (-1.0 to 1.0) to grid space (0 to grid_dim).
fn clip_to_grid_pos(clip_pos: vec2<f32>) -> vec2<f32> {
  let norm_pos = (clip_pos + vec2(1.0, 1.0)) / 2.0;
  let grid_pos = norm_pos * vec2<f32>(grid_dim);
  return grid_pos;
}

/// Convert a size in pixel space (0 to canvas_dim) to clip space (-1.0 to 1.0).
fn pixel_to_clip_size(pixel_size: vec2<f32>) -> vec2<f32> {
  let norm_size = pixel_size / vec2<f32>(canvas_dim);
  let clip_size = norm_size * 2.0;
  return clip_size;
}

/// Corners of a unit quad in clip space, drawn as a four-vertex triangle strip.
const unit_quad = array<vec2<f32>, 4>(
  vec2(-1.0, -1.0),
  vec2(1.0, -1.0),
  vec2(-1.0, 1.0),
  vec2(1.0, 1.0),
);

/// The team palette: evenly spaced hues at a fixed saturation and lightness.
fn team_color(team: u32) -> vec4<f32> {
  const SATURATION = 0.70;
  const LIGHTNESS = 0.55;
  const ALPHA = 1.0;

  // The CSS Color 4 HSL-to-RGB formula, evaluated on all three channels at once.
  let chroma = (1.0 - abs(2.0 * LIGHTNESS - 1.0)) * SATURATION;
  let hue = f32(team) / f32(num_teams) * 12.0;
  let k = (vec3(0.0, 8.0, 4.0) + hue) % 12.0;
  let rgb = LIGHTNESS - chroma * 0.5 * clamp(min(k - 3.0, 9.0 - k), vec3(-1.0), vec3(1.0));
  return vec4(rgb, ALPHA);
}

struct GridVertex {
  /// @vertex - clip-space position of the vertex.
  /// @fragment - position of the pixel.
  @builtin(position) pos: vec4<f32>,
  /// Position in grid space.
  @location(0) grid_coord: vec2<f32>,
}

@vertex
fn grid_vertex(@builtin(vertex_index) i: u32) -> GridVertex {
  return GridVertex(
    vec4(unit_quad[i], 0.0, 1.0),
    clip_to_grid_pos(unit_quad[i]),
  );
}

@fragment
fn grid_fragment(pixel: GridVertex) -> @location(0) vec4<f32> {
  // Nearest-neighbor sampling and bounds check
  let grid_coord = min(
    vec2<u32>(pixel.grid_coord),
    grid_dim - 1,
  );
  
  let index = grid_coord_to_index(grid_coord);

  return team_color(grid_ro[index]);
}

struct BallVertex {
  /// @vertex - global clip-space position of the vertex.
  /// @fragment - position of the pixel.
  @builtin(position) pos: vec4<f32>,
  /// Offset to the center of the ball in local clip space.
  /// Smoothly interpolated across the quad's pixels automatically,
  /// and used to determine if a given pixel is within the ball's radius.
  @location(0) offset: vec2<f32>,
}

@vertex
fn ball_vertex(@builtin(vertex_index) i: u32, @builtin(instance_index) team: u32) -> BallVertex {
  let ball_center_clip = grid_to_clip_pos(balls_ro[team].position);
  let ball_extent_clip = max(
    grid_to_clip_size(vec2(BALL_RADIUS, BALL_RADIUS)),
    pixel_to_clip_size(vec2(MIN_BALL_RADIUS_PX, MIN_BALL_RADIUS_PX)),
  );

  let offset_local_clip = unit_quad[i];
  let offset_global_clip = offset_local_clip * ball_extent_clip;

  let vertex_pos_clip = ball_center_clip + offset_global_clip;
  return BallVertex(
    vec4(vertex_pos_clip, 0.0, 1.0),
    offset_local_clip,
  );
}

@fragment
fn ball_fragment(pixel: BallVertex) -> @location(0) vec4f {
  let magnitude = length(pixel.offset);
  if magnitude > 1.0 {
    discard;
  }
  return vec4(1.0, 1.0, 1.0, 1.0);
}
