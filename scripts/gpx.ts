import type { RawTrack, TrackPoint } from '../src/rides/types.ts'

// lat and lon appear in either order across exporters.
const TRKPT = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g
const LAT = /\blat\s*=\s*"([^"]+)"/
const LON = /\blon\s*=\s*"([^"]+)"/
const TIME = /<time>([^<]+)<\/time>/

/**
 * Parse a GPX track.
 *
 * The 2026-07-28 Strava archive was 100% FIT, but manually-entered activities
 * export as GPX, so an archive can contain both.
 */
export function parseGpx(xml: string, id: string): RawTrack {
  const points: TrackPoint[] = []

  for (const m of xml.matchAll(TRKPT)) {
    const attrs = m[1] ?? m[3] ?? ''
    const body = m[2] ?? ''
    const lat = LAT.exec(attrs)
    const lon = LON.exec(attrs)
    if (!lat || !lon) continue

    const time = TIME.exec(body)
    const parsed = time ? Date.parse(time[1]) : NaN

    points.push({
      lat: Number(lat[1]),
      lon: Number(lon[1]),
      t: Number.isNaN(parsed) ? 0 : parsed,
    })
  }

  return { id, startTime: points[0]?.t ?? 0, source: 'gpx', points }
}
