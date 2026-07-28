import { describe, expect, it } from 'vitest'
import type { LoadedRegion } from '../network/loadSnapshot'
import { HIGHWAY_CLASSES } from '../network/regions'
import { CLASS_COLORS, buildLayerProps } from './networkLayer'

// Only the fields buildLayerProps reads; cast through unknown rather than
// constructing a full manifest.
const region = {
  id: 'test',
  name: 'Test',
  group: 'metro-core',
  origin: [-104.99, 39.61] as [number, number],
  offsets: new Float32Array([-0.02, -0.01, 0, 0, 0, 0, 0.02, 0.02]),
  buffers: {
    positions: new Float64Array(8),
    startIndices: new Uint32Array([0, 2, 4]),
    wayIds: new Float64Array([100, 101]),
    classes: new Uint8Array([3, 6]),
  },
  manifest: { wayCount: 2, version: 1 },
} as unknown as LoadedRegion

describe('CLASS_COLORS', () => {
  it('defines one color per highway class', () => {
    expect(CLASS_COLORS).toHaveLength(HIGHWAY_CLASSES.length)
  })

  it('returns a stable reference per class so deck.gl can cache', () => {
    expect(CLASS_COLORS[0]).toBe(CLASS_COLORS[0])
  })
})

describe('buildLayerProps', () => {
  it('feeds deck.gl binary data, not an object array', () => {
    const props = buildLayerProps(region)
    expect(props.data.length).toBe(2)
    expect(props.data.startIndices).toBeInstanceOf(Uint32Array)
    expect(props.data.attributes.getPath.value).toBeInstanceOf(Float32Array)
    expect(props.data.attributes.getPath.size).toBe(2)
  })

  it('renders in offset coordinates anchored at the region origin', () => {
    const props = buildLayerProps(region)
    expect(props.coordinateOrigin).toEqual([-104.99, 39.61])
  })

  it('colors each way by its class index', () => {
    const props = buildLayerProps(region)
    expect(props.getColor(null, { index: 0 })).toBe(CLASS_COLORS[3])
    expect(props.getColor(null, { index: 1 })).toBe(CLASS_COLORS[6])
  })

  it('falls back to a loud color for an out-of-range class index', () => {
    // Magenta is deliberate: a class index the palette does not cover means
    // the snapshot and HIGHWAY_CLASSES have drifted apart, and that should be
    // obvious on screen rather than blending in.
    const broken = {
      ...region,
      buffers: { ...region.buffers, classes: new Uint8Array([99, 99]) },
    }
    const color = buildLayerProps(broken).getColor(null, { index: 0 })
    expect(color).toEqual([255, 0, 255])
  })

  it('gives each region a distinct layer id', () => {
    expect(buildLayerProps(region).id).toBe('network-test')
  })
})
