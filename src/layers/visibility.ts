import { bboxesIntersect, type Bbox } from '../geo/bounds.ts'

/**
 * Below this zoom the street network is not drawn at all.
 *
 * Measured: at continental zoom the metro occupies a few hundred pixels while
 * all ~70,000 paths still rasterize, and the map runs at 6 fps. Nothing is
 * legible at that scale -- individual streets are far below a pixel apart --
 * so the frames buy nothing. Panning away from the network restored 60 fps,
 * which is what identified geometry volume rather than compositing as the
 * cost.
 *
 * Ride traces keep drawing at every zoom. They are the reason to zoom out.
 */
export const NETWORK_MIN_ZOOM = 9.5

export function shouldDrawNetwork(zoom: number): boolean {
  return zoom >= NETWORK_MIN_ZOOM
}

/**
 * Pad the viewport before testing, so a region whose geometry extends slightly
 * past its own bbox is not clipped at the edge of the screen during a pan.
 */
const VIEWPORT_PAD_DEGREES = 0.05

export function padViewport(view: Bbox, pad = VIEWPORT_PAD_DEGREES): Bbox {
  return {
    minLon: view.minLon - pad,
    minLat: view.minLat - pad,
    maxLon: view.maxLon + pad,
    maxLat: view.maxLat + pad,
  }
}

/**
 * Drop regions that cannot be on screen.
 *
 * deck.gl culls per-layer, not per-path, so a region layer whose every path is
 * off screen still costs an upload and a draw call. With 19 regions this is
 * most of the win when zoomed into one city.
 *
 * A null viewport means "not measured yet" and keeps everything, so the first
 * paint is never accidentally empty.
 */
export function visibleRegions<T>(
  regions: readonly T[],
  bboxOf: (region: T) => Bbox,
  view: Bbox | null,
): T[] {
  if (view === null) return [...regions]
  const padded = padViewport(view)
  return regions.filter((r) => bboxesIntersect(padded, bboxOf(r)))
}
