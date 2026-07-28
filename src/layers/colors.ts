export type Rgb = [number, number, number]
export type Rgba = [number, number, number, number]

/** Ridden. Warm and bright so covered streets read as the figure. */
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
 * Ride traces: red, deliberately unlike anything else on the map.
 *
 * Coverage and traces are now mutually exclusive views rather than stacked
 * layers, so the trace no longer needs to agree with RIDDEN_COLOR -- it needs
 * to be unmistakably its own thing against the class colors and the basemap.
 *
 * Still semi-transparent, so overlapping traces accumulate and a corridor
 * ridden many times reads brighter than a one-off.
 */
export const RIDE_TRACE_COLOR: Rgba = [255, 60, 70, 110]
