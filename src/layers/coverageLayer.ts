import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedCoverageRegion } from '../coverage/loadCoverage.ts'
import { RIDDEN_COLOR, UNRIDDEN_COLOR, type Rgb } from './colors.ts'

type Memo = {
  data: {
    length: number
    startIndices: Uint32Array
    attributes: { getPath: { value: Float32Array; size: 2 } }
  }
  getColor: (_: unknown, info: { index: number }) => Rgb
  getWidth: (_: unknown, info: { index: number }) => number
}

/**
 * Per-region `data` and accessors, built once and reused.
 *
 * deck.gl compares props by reference. A binary `data` payload is a plain
 * object wrapping typed arrays, so building a fresh one per render reads as
 * *new data* and re-uploads every vertex -- 613,505 across the metro. That is
 * what made two attempts at viewport culling slower than the problem they were
 * fixing: culling rebuilds layers as the camera moves, and each rebuild paid
 * for the entire network.
 *
 * Weak, so dropping a region from state does not pin its buffers.
 */
const memo = new WeakMap<LoadedCoverageRegion, Memo>()

export function coverageMemo(region: LoadedCoverageRegion): Memo {
  let m = memo.get(region)
  if (m === undefined) {
    const flags = region.buffers.flags
    m = {
      data: {
        length: region.region.runCount,
        startIndices: region.buffers.startIndices,
        attributes: { getPath: { value: region.offsets, size: 2 } },
      },
      // With binary data deck.gl passes (null, {index, data, target}).
      getColor: (_, info) => (flags[info.index] === 1 ? RIDDEN_COLOR : UNRIDDEN_COLOR),
      // Ridden runs draw slightly heavier so they stay legible where they
      // overlap the dim network at low zoom.
      getWidth: (_, info) => (flags[info.index] === 1 ? 1.6 : 1),
    }
    memo.set(region, m)
  }
  return m
}

export function buildCoverageLayerProps(region: LoadedCoverageRegion) {
  const { data, getColor, getWidth } = coverageMemo(region)
  return {
    id: `coverage-${region.id}`,
    data,
    _pathType: 'open' as const,
    coordinateSystem: COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    coordinateOrigin: region.origin,
    getColor,
    widthUnits: 'pixels' as const,
    getWidth,
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
