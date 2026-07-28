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

/**
 * Unridden. Cool and recessive so ridden streets read as the figure -- but
 * still bright enough to see.
 *
 * An earlier [70, 82, 100] was so dark against the basemap that streets with
 * no ride near them looked absent rather than uncovered, which made the map
 * read as empty in exactly the places the project is about. It sits just below
 * the residential class color so the network stays as legible here as in the
 * class-colored view.
 */
export const UNRIDDEN_COLOR: Rgb = [112, 133, 162]

/**
 * Ride traces: the ridden hue, semi-transparent so overlapping traces
 * accumulate and streets ridden many times read brighter.
 */
export const RIDE_TRACE_COLOR: Rgba = [...RIDDEN_COLOR, 90]
