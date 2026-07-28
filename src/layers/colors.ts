export type Rgb = [number, number, number]
export type Rgba = [number, number, number, number]

/**
 * Ridden. Warm and bright so covered streets read as the figure.
 *
 * The ride-trace overlay uses the same hue with alpha, because both encode the
 * same fact -- "you were here". Two different warm colors for one meaning read
 * as two different meanings.
 */
export const RIDDEN_COLOR: Rgb = [255, 190, 60]

/** Unridden. Dim and cool so the uncovered network reads as ground. */
export const UNRIDDEN_COLOR: Rgb = [70, 82, 100]

/**
 * Ride traces: the ridden hue, semi-transparent so overlapping traces
 * accumulate and streets ridden many times read brighter.
 */
export const RIDE_TRACE_COLOR: Rgba = [...RIDDEN_COLOR, 90]
