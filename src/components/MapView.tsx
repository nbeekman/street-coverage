import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { Map } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createNetworkLayer } from '../layers/networkLayer.ts'
import type { LoadedRegion } from '../network/loadSnapshot.ts'

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

type Props = {
  regions: LoadedRegion[]
}

export default function MapView({ regions }: Props) {
  const layers = useMemo(
    () => regions.map((region) => createNetworkLayer(region)),
    [regions],
  )

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      style={{ position: 'absolute', inset: '0' }}
    >
      <Map mapStyle={BASEMAP_STYLE} />
    </DeckGL>
  )
}
