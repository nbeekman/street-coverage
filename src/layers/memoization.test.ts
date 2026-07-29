import { describe, expect, it } from 'vitest'
import type { LoadedCoverageRegion } from '../coverage/loadCoverage.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import { buildCoverageLayerProps, coverageMemo } from './coverageLayer.ts'
import { buildLayerProps, networkMemo } from './networkLayer.ts'

/**
 * These pin reference identity, not values. deck.gl diffs layer props by
 * reference: if `data` is a new object each render it re-uploads every vertex,
 * which is what made two attempts at viewport culling slower than the problem
 * they were fixing. A value-equality test would pass while the bug returned.
 */

function fakeNetworkRegion(id: string): LoadedRegion {
  return {
    id,
    name: id,
    group: 'metro-core',
    manifest: { wayCount: 2, version: 3, bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 } },
    buffers: {
      positions: new Float64Array([0, 0, 1, 1, 2, 2, 3, 3]),
      startIndices: new Uint32Array([0, 2, 4]),
      wayIds: new Float64Array([1, 2]),
      classes: new Uint8Array([0, 3]),
    },
    origin: [0, 0],
    offsets: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]),
  } as unknown as LoadedRegion
}

function fakeCoverageRegion(id: string): LoadedCoverageRegion {
  return {
    id,
    region: { regionId: id, runCount: 2 },
    buffers: {
      positions: new Float64Array([0, 0, 1, 1, 2, 2, 3, 3]),
      startIndices: new Uint32Array([0, 2, 4]),
      flags: new Uint8Array([1, 0]),
      years: new Uint32Array([0b1, 0]),
      meters: new Float32Array([100, 200]),
    },
    bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
    origin: [0, 0],
    offsets: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]),
  } as unknown as LoadedCoverageRegion
}

describe('network layer memoization', () => {
  it('returns the same data object across calls', () => {
    const region = fakeNetworkRegion('denver')
    expect(networkMemo(region).data).toBe(networkMemo(region).data)
  })

  it('returns the same accessor across calls', () => {
    const region = fakeNetworkRegion('denver')
    expect(networkMemo(region).getColor).toBe(networkMemo(region).getColor)
  })

  it('carries the identical data reference into rebuilt layer props', () => {
    // This is the property culling depends on: rebuild the props as the camera
    // moves and deck.gl must see the same binary payload it already uploaded.
    const region = fakeNetworkRegion('denver')
    expect(buildLayerProps(region).data).toBe(buildLayerProps(region).data)
    expect(buildLayerProps(region).getColor).toBe(buildLayerProps(region).getColor)
  })

  it('keeps distinct regions distinct', () => {
    expect(networkMemo(fakeNetworkRegion('a')).data).not.toBe(
      networkMemo(fakeNetworkRegion('b')).data,
    )
  })

  it('still wraps the region buffers rather than copying them', () => {
    const region = fakeNetworkRegion('denver')
    const { data } = networkMemo(region)
    expect(data.startIndices).toBe(region.buffers.startIndices)
    expect(data.attributes.getPath.value).toBe(region.offsets)
  })
})

describe('coverage layer memoization', () => {
  it('returns the same data object across calls', () => {
    const region = fakeCoverageRegion('denver')
    expect(coverageMemo(region).data).toBe(coverageMemo(region).data)
  })

  it('memoizes data but deliberately not the accessors', () => {
    // Accessors depend on the year filter, so they are rebuilt per call. That
    // is cheap; updateTriggers decides whether the colour attribute is
    // recomputed. Only `data` must keep its identity, because that is the
    // buffer deck.gl would otherwise re-upload.
    const region = fakeCoverageRegion('denver')
    expect(coverageMemo(region).data).toBe(coverageMemo(region).data)
  })

  it('carries the identical data reference into rebuilt layer props', () => {
    const region = fakeCoverageRegion('denver')
    expect(buildCoverageLayerProps(region).data).toBe(buildCoverageLayerProps(region).data)
  })

  it('keeps the same data reference across year filters', () => {
    // Changing the filter must not look like new geometry, or every year
    // click would re-upload the whole metro.
    const region = fakeCoverageRegion('denver')
    expect(buildCoverageLayerProps(region, 0).data).toBe(
      buildCoverageLayerProps(region, 0b100).data,
    )
  })

  it('colors ridden runs differently from unridden ones', () => {
    const { getColor } = buildCoverageLayerProps(fakeCoverageRegion('denver'))
    expect(getColor(null, { index: 0 })).not.toEqual(getColor(null, { index: 1 }))
  })
})
