/// An RGBA color, one byte per channel.
pub type Rgba = [u8; 4];

/// Generate a range of evenly-spaced hues.
///
/// WARNING: may encounter color collisions when `num_colors`` >= 902.
pub fn color_palette(num_colors: usize) -> Vec<Rgba> {
    (0..num_colors)
        .map(|i| hsl_to_rgba((i as f32 / num_colors as f32) * 360.0, 0.70, 0.55))
        .collect()
}

/// Convert an HSL color to RGBA (alpha 255), replicating CSS `hsl(h, s%, l%)`.
/// `h` is in degrees `[0, 360)`, `s` and `l` are fractions in `[0, 1]`.
fn hsl_to_rgba(h: f32, s: f32, l: f32) -> Rgba {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h / 60.0;
    let x = c * (1.0 - (h_prime % 2.0 - 1.0).abs());
    let m = l - c / 2.0;

    let (r1, g1, b1) = match h_prime as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };

    let to_byte = |v: f32| ((v + m) * 255.0).round() as u8;
    [to_byte(r1), to_byte(g1), to_byte(b1), 255]
}
