import { METERS_PER_DEGREE, haversineMeters } from '../geo/haversine.ts'
import type { Bbox } from '../geo/bounds.ts'

const DEG_TO_RAD = Math.PI / 180

/**
 * Cells are sized 1% larger than the radius they must span.
 *
 * Without it the guarantee holds only to within floating-point error at the
 * bbox's poleward edge, where the sizing is exact by construction. A 1% wider
 * cell scans a negligible number of extra candidates and removes the question.
 */
const CELL_SAFETY = 1.01

/**
 * Cell dimensions guaranteeing a cell spans at least `radius` meters anywhere
 * inside `bbox`.
 *
 * Longitude is the axis that bites: a degree of longitude shrinks as latitude
 * rises, so the widest cell in degrees is needed at the bbox's poleward edge.
 * Sizing from the smallest meters-per-degree in range makes every cell at
 * least `radius` across, which is what the 3x3 neighborhood scan relies on.
 *
 * Both axes derive from the same sphere `haversineMeters` uses. An earlier
 * version took the ellipsoidal 111320 m/deg for longitude and produced 24.97 m
 * cells for a 25 m radius -- undersized, and undersized cells silently lose
 * matches rather than failing loudly.
 */
export function cellSizeDegrees(
  radiusMeters: number,
  bbox: Bbox,
): { lon: number; lat: number } {
  const maxAbsLat = Math.max(Math.abs(bbox.minLat), Math.abs(bbox.maxLat))
  const metersPerDegLon = METERS_PER_DEGREE * Math.cos(maxAbsLat * DEG_TO_RAD)
  return {
    lon: (radiusMeters * CELL_SAFETY) / metersPerDegLon,
    lat: (radiusMeters * CELL_SAFETY) / METERS_PER_DEGREE,
  }
}

/**
 * Uniform spatial hash over a flat [lon, lat, ...] point array.
 *
 * The grid is a candidate filter only -- haversine makes every final call --
 * so an oversized cell costs speed and an undersized one would cost
 * correctness. Everything here errs toward oversized.
 */
export class PointGrid {
  private readonly cells = new Map<number, number[]>()
  private readonly cellLon: number
  private readonly cellLat: number
  private readonly points: Float64Array

  /** Year index per point, parallel to `points`. Empty when years are unused. */
  private readonly yearIndex: Uint8Array

  constructor(
    points: Float64Array,
    radiusMeters: number,
    bbox: Bbox,
    yearIndex: Uint8Array = new Uint8Array(0),
  ) {
    this.points = points
    this.yearIndex = yearIndex
    const size = cellSizeDegrees(radiusMeters, bbox)
    this.cellLon = size.lon
    this.cellLat = size.lat

    for (let v = 0; v < points.length / 2; v++) {
      const key = this.keyOf(points[v * 2], points[v * 2 + 1])
      const bucket = this.cells.get(key)
      if (bucket) bucket.push(v)
      else this.cells.set(key, [v])
    }
  }

  /**
   * Pack two cell indices into one number key. Cell indices stay well within
   * +/-2^20 for any terrestrial bbox at a sane radius, so this is exact in a
   * float64 and avoids allocating a string per lookup.
   */
  private static pack(cx: number, cy: number): number {
    return (cx + 0x100000) * 0x400000 + (cy + 0x100000)
  }

  private keyOf(lon: number, lat: number): number {
    return PointGrid.pack(
      Math.floor(lon / this.cellLon),
      Math.floor(lat / this.cellLat),
    )
  }

  /** True when any indexed point lies within `radiusMeters` of the position. */
  hasPointWithin(lon: number, lat: number, radiusMeters: number): boolean {
    const cx = Math.floor(lon / this.cellLon)
    const cy = Math.floor(lat / this.cellLat)

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(PointGrid.pack(cx + dx, cy + dy))
        if (!bucket) continue
        for (const v of bucket) {
          const d = haversineMeters(lon, lat, this.points[v * 2], this.points[v * 2 + 1])
          if (d <= radiusMeters) return true
        }
      }
    }
    return false
  }

  /**
   * Bitmask of the years in which some point came within the radius.
   *
   * Bit i corresponds to year index i, so the caller decides what the indices
   * mean. Returns 0 when nothing is in range, which reads the same as `false`
   * from hasPointWithin.
   *
   * Uses the same 3x3 scan: the grid guarantees any point within the radius
   * lies in those cells, so a year cannot be missed that a hit would not be.
   */
  yearsWithin(lon: number, lat: number, radiusMeters: number): number {
    const cx = Math.floor(lon / this.cellLon)
    const cy = Math.floor(lat / this.cellLat)
    let mask = 0

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(PointGrid.pack(cx + dx, cy + dy))
        if (!bucket) continue
        for (const v of bucket) {
          const d = haversineMeters(lon, lat, this.points[v * 2], this.points[v * 2 + 1])
          if (d <= radiusMeters) {
            // With no year index every point counts as year 0, so the mask is
            // simply non-zero on a hit. Written out rather than relying on
            // `1 << undefined` happening to equal 1.
            mask |= 1 << (this.yearIndex.length > 0 ? this.yearIndex[v] : 0)
          }
        }
      }
    }
    return mask
  }

  /** Occupied cell count. Diagnostics and tests. */
  get cellCount(): number {
    return this.cells.size
  }
}
