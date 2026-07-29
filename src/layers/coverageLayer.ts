import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PathLayer } from '@deck.gl/layers'
import type { LoadedCoverageRegion } from '../coverage/loadCoverage.ts'
import { runCounts } from '../coverage/yearFilter.ts'
import { RIDDEN_COLOR, UNRIDDEN_COLOR, type Rgb } from './colors.ts'

type Memo = {
  data: {
    length: number
    startIndices: Uint32Array
    attributes: { getPath: { value: Float32Array; size: 2 } }
  }
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
    m = {
      data: {
        length: region.region.runCount,
        startIndices: region.buffers.startIndices,
        attributes: { getPath: { value: region.offsets, size: 2 } },
      },
    }
    memo.set(region, m)
  }
  return m
}

export function buildCoverageLayerProps(region: LoadedCoverageRegion, yearMask = 0) {
  const { data } = coverageMemo(region)
  const { flags, years } = region.buffers

  // Accessors depend on the filter, so they are not memoized -- but `data` is,
  // which is the part deck.gl would otherwise re-upload. updateTriggers below
  // recomputes only the colour attribute when the filter changes.
  const shows = (i: number) => runCounts(flags[i], years[i], yearMask)
  const getColor = (_: unknown, info: { index: number }): Rgb =>
    shows(info.index) ? RIDDEN_COLOR : UNRIDDEN_COLOR
  const getWidth = (_: unknown, info: { index: number }): number =>
    shows(info.index) ? 1.6 : 1

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
      getColor: [region.region.runCount, yearMask],
      getWidth: [region.region.runCount, yearMask],
    },
  }
}

export function createCoverageLayer(
  region: LoadedCoverageRegion,
  beforeId?: string,
  yearMask = 0,
): PathLayer {
  return new PathLayer({ ...buildCoverageLayerProps(region, yearMask), beforeId } as never)
}
