import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedCoverageRegion } from '../coverage/loadCoverage.ts'
import { RIDDEN_COLOR, UNRIDDEN_COLOR, type Rgb } from './colors.ts'

export function buildCoverageLayerProps(region: LoadedCoverageRegion) {
  const flags = region.buffers.flags
  return {
    id: `coverage-${region.id}`,
    data: {
      length: region.region.runCount,
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
      flags[info.index] === 1 ? RIDDEN_COLOR : UNRIDDEN_COLOR,
    widthUnits: 'pixels' as const,
    // Ridden runs draw slightly heavier so they stay legible where they
    // overlap the dim network at low zoom.
    getWidth: (_: unknown, info: { index: number }): number =>
      flags[info.index] === 1 ? 1.6 : 1,
    widthMinPixels: 0.75,
    widthMaxPixels: 5,
    capRounded: true,
    jointRounded: true,
    pickable: false,
    updateTriggers: {
      getColor: [region.region.runCount],
      getWidth: [region.region.runCount],
    },
  }
}

export function createCoverageLayer(region: LoadedCoverageRegion, beforeId?: string): PathLayer {
  return new PathLayer({ ...buildCoverageLayerProps(region), beforeId } as never)
}
