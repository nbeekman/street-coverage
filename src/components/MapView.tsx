import { useMemo, useState } from 'react'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Layer } from '@deck.gl/core'
import { Map, useControl } from 'react-map-gl/maplibre'
import type { MapEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createCoverageLayer } from '../layers/coverageLayer.ts'
import { createNetworkLayer } from '../layers/networkLayer.ts'
import { createRideLayer } from '../layers/rideLayer.ts'
import type { LoadedCoverage } from '../coverage/loadCoverage.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'
import type { LoadedRides } from '../rides/loadRides.ts'

/** Free, no-token basemap. Attribution renders from the style itself. */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

/** Centered between Littleton and downtown Denver. */
const INITIAL_VIEW_STATE = {
  longitude: -105.0,
  latitude: 39.65,
  zoom: 10.5,
  pitch: 0,
  bearing: 0,
}

/**
 * Draw deck.gl layers inside MapLibre's WebGL context rather than in a canvas
 * stacked on top of it.
 *
 * Interleaving is what makes `beforeId` mean anything: in the default overlaid
 * mode deck owns a separate canvas above the whole map, so place labels can
 * never sit above the network no matter where they are in the style.
 */
function DeckOverlay({ layers }: { layers: Layer[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true, layers }))
  overlay.setProps({ layers })
  return null
}

type Props = {
  regions: LoadedRegion[]
  rides: LoadedRides | null
  showRides: boolean
  coverage: LoadedCoverage | null
  showCoverage: boolean
}

export default function MapView({
  regions,
  rides,
  showRides,
  coverage,
  showCoverage,
}: Props) {
  // The id of the style's first symbol layer. Everything deck draws is
  // inserted before it, which puts every label above every generated line.
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>(undefined)

  const layers = useMemo(() => {
    // Coverage geometry is the same network, split at ridden/unridden
    // boundaries, so the two layer sets are alternatives rather than a stack.
    const base =
      coverage && showCoverage
        ? coverage.regions.map((region) => createCoverageLayer(region, labelLayerId))
        : regions.map((region) => createNetworkLayer(region, labelLayerId))

    // Rides draw last so they sit above the network but still below labels.
    return rides && showRides ? [...base, createRideLayer(rides, labelLayerId)] : base
  }, [regions, rides, showRides, coverage, showCoverage, labelLayerId])

  return (
    <Map
      initialViewState={INITIAL_VIEW_STATE}
      mapStyle={BASEMAP_STYLE}
      style={{ position: 'absolute', inset: '0' }}
      onLoad={(event: MapEvent) => {
        const style = event.target.getStyle()
        const firstSymbol = style?.layers?.find((l) => l.type === 'symbol')
        setLabelLayerId(firstSymbol?.id)
      }}
    >
      <DeckOverlay layers={layers} />
    </Map>
  )
}
