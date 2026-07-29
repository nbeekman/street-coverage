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
  [ 80, 200, 175], // footway   (bicycle=designated only)
]

const FALLBACK_COLOR: Rgb = [255, 0, 255]

type Memo = {
  data: {
    length: number
    startIndices: Uint32Array
    attributes: { getPath: { value: Float32Array; size: 2 } }
  }
  getColor: (_: unknown, info: { index: number }) => Rgb
}

/**
 * Per-region `data` and accessor, built once and reused.
 *
 * deck.gl compares props by reference, and a binary `data` payload is a plain
 * object wrapping typed arrays. Building a fresh one per render reads as new
 * data and re-uploads every vertex, which is what made viewport culling cost
 * more than it saved. Weak, so a dropped region does not pin its buffers.
 */
const memo = new WeakMap<LoadedRegion, Memo>()

export function networkMemo(region: LoadedRegion): Memo {
  let m = memo.get(region)
  if (m === undefined) {
    const classes = region.buffers.classes
    m = {
      data: {
        length: region.manifest.wayCount,
        startIndices: region.buffers.startIndices,
        attributes: { getPath: { value: region.offsets, size: 2 } },
      },
      // With binary data deck.gl passes (null, {index, data, target}).
      getColor: (_, info) => CLASS_COLORS[classes[info.index]] ?? FALLBACK_COLOR,
    }
    memo.set(region, m)
  }
  return m
}

export function buildLayerProps(region: LoadedRegion) {
  const { data, getColor } = networkMemo(region)
  return {
    id: `network-${region.id}`,
    data,
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: region.origin,
    getColor,
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

/**
 * In rides mode the class colors are scenery, not the subject. Dimming the
 * whole layer lets the red traces dominate without changing the palette, so
 * the map key stays truthful about which class is which.
 */
export const DIMMED_OPACITY = 0.35

export function createNetworkLayer(
  region: LoadedRegion,
  beforeId?: string,
  dimmed = false,
): PathLayer {
  return new PathLayer({
    ...buildLayerProps(region),
    beforeId,
    opacity: dimmed ? DIMMED_OPACITY : 1,
  } as never)
}
