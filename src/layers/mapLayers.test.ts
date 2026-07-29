import { describe, expect, it } from 'vitest'
import type { LoadedCoverage } from '../coverage/loadCoverage.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import type { LoadedRides } from '../rides/loadRides.ts'
import type { Layer } from '@deck.gl/core'
import { buildMapLayers } from './mapLayers.ts'

/**
 * `beforeId` is MapboxOverlay's extension to deck.gl layer props, so it is not
 * in the LayerProps type. Read through one narrow accessor rather than casting
 * at every assertion.
 */
const beforeIdOf = (layer: Layer): string | undefined =>
  (layer.props as { beforeId?: string }).beforeId

/**
 * These guard z-order, which has regressed twice and both times was caught by
 * eye rather than by a test.
 *
 * The contract: MapboxOverlay inserts the layers this function returns into
 * maplibre's stack, and reads `beforeId` from each of them. A sublayer's own
 * `beforeId` is never consulted -- which is exactly why wrapping the region
 * layers in a composite silently put everything above the place labels.
 */

const LABEL_ID = 'place_label_city'

function networkRegion(id: string): LoadedRegion {
  return {
    id,
    name: id,
    group: 'metro-core',
    manifest: { wayCount: 1, version: 3, bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 } },
    buffers: {
      positions: new Float64Array([0, 0, 1, 1]),
      startIndices: new Uint32Array([0, 2]),
      wayIds: new Float64Array([1]),
      classes: new Uint8Array([0]),
    },
    origin: [0, 0],
    offsets: new Float32Array([0, 0, 1, 1]),
  } as unknown as LoadedRegion
}

function coverage(): LoadedCoverage {
  return {
    manifest: { version: 1 },
    regions: [
      {
        id: 'denver',
        region: { regionId: 'denver', runCount: 1 },
        buffers: {
          positions: new Float64Array([0, 0, 1, 1]),
          startIndices: new Uint32Array([0, 2]),
          flags: new Uint8Array([1]),
          years: new Uint32Array([0b1]),
          meters: new Float32Array([100]),
        },
        bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
        origin: [0, 0],
        offsets: new Float32Array([0, 0, 1, 1]),
      },
    ],
  } as unknown as LoadedCoverage
}

function rides(): LoadedRides {
  return {
    manifest: { rideCount: 1, version: 2 },
    buffers: {
      positions: new Float64Array([0, 0, 1, 1]),
      startIndices: new Uint32Array([0, 2]),
      times: new Float64Array([0]),
    },
    origin: [0, 0],
    offsets: new Float32Array([0, 0, 1, 1]),
  } as unknown as LoadedRides
}

const base = { regions: [networkRegion('denver')], labelLayerId: LABEL_ID, yearMask: 0, selectedYear: null, cumulativeYears: false }

describe('buildMapLayers z-order', () => {
  it('puts every coverage-mode layer below the labels', () => {
    const layers = buildMapLayers({
      ...base,
      rides: rides(),
      coverage: coverage(),
      mode: 'coverage',
    })
    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) {
      expect(beforeIdOf(layer)).toBe(LABEL_ID)
    }
  })

  it('puts every rides-mode layer below the labels, traces included', () => {
    // The trace layer is a separate top-level layer, so it needs its own
    // beforeId -- it does not inherit one from the stack beside it.
    const layers = buildMapLayers({
      ...base,
      rides: rides(),
      coverage: coverage(),
      mode: 'rides',
    })
    expect(layers.length).toBe(2)
    for (const layer of layers) {
      expect(beforeIdOf(layer)).toBe(LABEL_ID)
    }
  })

  it('puts the network layer below the labels when coverage is absent', () => {
    const layers = buildMapLayers({
      ...base,
      rides: null,
      coverage: null,
      mode: 'coverage',
    })
    for (const layer of layers) {
      expect(beforeIdOf(layer)).toBe(LABEL_ID)
    }
  })

  it('never leaves a layer without a beforeId once the style has loaded', () => {
    // Swept across every combination rather than spot-checked: the regression
    // both times was one layer in one mode, not all of them.
    for (const mode of ['coverage', 'rides'] as const) {
      for (const withRides of [true, false]) {
        for (const withCoverage of [true, false]) {
          const layers = buildMapLayers({
            ...base,
            rides: withRides ? rides() : null,
            coverage: withCoverage ? coverage() : null,
            mode,
          })
          for (const layer of layers) {
            expect(
              beforeIdOf(layer),
              `mode=${mode} rides=${withRides} coverage=${withCoverage} layer=${layer.id}`,
            ).toBe(LABEL_ID)
          }
        }
      }
    }
  })

  it('tolerates the style not having loaded yet', () => {
    // Before onLoad resolves there is no symbol layer to insert before. Layers
    // must still build; they are rebuilt once the id arrives.
    const layers = buildMapLayers({
      ...base,
      labelLayerId: undefined,
      rides: rides(),
      coverage: coverage(),
      mode: 'rides',
    })
    expect(layers.length).toBe(2)
    for (const layer of layers) {
      expect(beforeIdOf(layer)).toBeUndefined()
    }
  })
})

describe('buildMapLayers composition', () => {
  it('draws traces above the network in rides mode', () => {
    const layers = buildMapLayers({
      ...base,
      rides: rides(),
      coverage: coverage(),
      mode: 'rides',
    })
    // Later in the array means drawn later, so the traces must come last.
    expect(layers[layers.length - 1].id).toBe('rides')
  })

  it('uses the coverage stack in coverage mode and the network stack otherwise', () => {
    const cov = buildMapLayers({ ...base, rides: null, coverage: coverage(), mode: 'coverage' })
    expect(cov[0].id).toBe('coverage-stack')

    const net = buildMapLayers({ ...base, rides: rides(), coverage: coverage(), mode: 'rides' })
    expect(net[0].id).toBe('network-stack')
  })

  it('omits the trace layer in coverage mode even when rides are loaded', () => {
    const layers = buildMapLayers({
      ...base,
      rides: rides(),
      coverage: coverage(),
      mode: 'coverage',
    })
    expect(layers.map((l) => l.id)).not.toContain('rides')
  })
})
