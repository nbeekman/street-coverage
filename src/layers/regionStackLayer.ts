import { CompositeLayer } from '@deck.gl/core'
import type { Layer } from '@deck.gl/core'
import type { Bbox } from '../geo/bounds.ts'
import { shouldDrawNetwork, visibleRegions } from './visibility.ts'

/**
 * Draws the per-region network layers, culled to what can actually be seen.
 *
 * Two things make this affordable, and both were missing when earlier attempts
 * made the map slower:
 *
 *  - The layer factories memoize their binary `data` and accessors per region,
 *    so rebuilding a layer hands deck.gl the same references it already
 *    uploaded. Without that, every camera move re-uploaded 613,505 vertices.
 *  - Sublayers are only rebuilt when the *visible set* changes. Panning within
 *    the same regions returns the cached array untouched.
 *
 * It is a CompositeLayer rather than React state because holding the camera in
 * state re-renders react-map-gl's `<Map>`, whose `setProps` throws in
 * `_updateSize`. deck.gl already knows the viewport; this asks it.
 */
type StackProps<T> = {
  id: string
  regions: readonly T[]
  bboxOf: (region: T) => Bbox
  idOf: (region: T) => string
  build: (region: T) => Layer
}

/** deck.gl viewports expose bounds as [minX, minY, maxX, maxY] in lng/lat. */
function viewportBounds(viewport: { getBounds?: () => number[] }): Bbox | null {
  const b = viewport.getBounds?.()
  if (!b || b.length < 4) return null
  return { minLon: b[0], minLat: b[1], maxLon: b[2], maxLat: b[3] }
}

export class RegionStackLayer<T> extends CompositeLayer<StackProps<T>> {
  static layerName = 'RegionStackLayer'

  /**
   * A CompositeLayer does not re-run `renderLayers` on camera change unless it
   * asks to. Without this the gate is evaluated once at construction and never
   * again -- it compiles, renders, and silently does nothing, which is exactly
   * what happened on the previous attempt.
   */
  shouldUpdateState({ changeFlags }: { changeFlags: { somethingChanged: boolean } }): boolean {
    return changeFlags.somethingChanged
  }

  private cached: Layer[] | null = null
  private cachedKey = ''

  renderLayers(): Layer[] {
    const { regions, bboxOf, idOf, build } = this.props
    const viewport = this.context.viewport as unknown as {
      zoom: number
      getBounds?: () => number[]
    }

    const visible = shouldDrawNetwork(viewport.zoom)
      ? visibleRegions(regions, bboxOf, viewportBounds(viewport))
      : []

    // Keyed on which regions are visible, not on where the camera is: panning
    // inside the same set must not rebuild anything.
    const key = visible.map(idOf).join('|')
    if (this.cached !== null && this.cachedKey === key) return this.cached

    this.cached = visible.map(build)
    this.cachedKey = key
    return this.cached
  }
}
