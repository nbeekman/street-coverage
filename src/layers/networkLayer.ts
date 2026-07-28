import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedRegion } from '../network/loadSnapshot.ts'

export type { Rgb } from './colors.ts'
import type { Rgb } from './colors.ts'

/**
 * Index-aligned with HIGHWAY_CLASSES. Warm for arterials, cool for
 * residential, green for cycleways -- readable on the dark basemap and
 * distinct enough to spot a misclassified way at a glance.
 */
export const CLASS_COLORS: readonly Rgb[] = [
  [255, 170, 80],  // primary
  [255, 210, 120], // secondary
  [200, 200, 160], // tertiary
  [120, 150, 190], // residential
  [130, 130, 150], // unclassified
  [170, 140, 200], // living_street
  [110, 220, 150], // cycleway
  [90, 190, 130],  // path      (bike-legal only)
  [140, 165, 110], // bridleway (bike-legal only)
]

const FALLBACK_COLOR: Rgb = [255, 0, 255]

export function buildLayerProps(region: LoadedRegion) {
  const classes = region.buffers.classes
  return {
    id: `network-${region.id}`,
    data: {
      length: region.manifest.wayCount,
      startIndices: region.buffers.startIndices,
      attributes: {
        getPath: { value: region.offsets, size: 2 },
      },
    },
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: region.origin,
    // With binary data deck.gl passes (null, {index, data, target}).
    getColor: (_: unknown, info: { index: number }): Rgb =>
      CLASS_COLORS[classes[info.index]] ?? FALLBACK_COLOR,
    widthUnits: 'pixels' as const,
    getWidth: 1,
    widthMinPixels: 0.75,
    widthMaxPixels: 4,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    // M3 recolors by coverage through this same trigger rather than
    // recreating the layer.
    updateTriggers: { getColor: [region.manifest.version] },
  }
}

export function createNetworkLayer(region: LoadedRegion, beforeId?: string): PathLayer {
  return new PathLayer({ ...buildLayerProps(region), beforeId } as never)
}
