import { describe, expect, it } from 'vitest'
import { parseGpx } from './gpx'

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StravaGPX">
  <trk><trkseg>
      <trkpt lat="39.6133" lon="-105.0166"><ele>1620.0</ele><time>2026-07-28T13:00:00Z</time></trkpt>
      <trkpt lat="39.6140" lon="-105.0170"><time>2026-07-28T13:00:05Z</time></trkpt>
  </trkseg></trk>
</gpx>`

describe('parseGpx', () => {
  it('extracts track points in order', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.points).toHaveLength(2)
    expect(t.points[0].lat).toBeCloseTo(39.6133, 6)
    expect(t.points[0].lon).toBeCloseTo(-105.0166, 6)
  })

  it('parses timestamps to epoch ms', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.points[0].t).toBe(Date.parse('2026-07-28T13:00:00Z'))
    expect(t.points[1].t - t.points[0].t).toBe(5000)
  })

  it('marks the source and start time', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.source).toBe('gpx')
    expect(t.startTime).toBe(Date.parse('2026-07-28T13:00:00Z'))
  })

  it('leaves virtual-ride fields undefined; GPX carries no session data', () => {
    const t = parseGpx(GPX, 'morning')
    expect(t.subSport).toBeUndefined()
    expect(t.manufacturer).toBeUndefined()
  })

  it('handles a track with no points', () => {
    expect(parseGpx('<gpx><trk><trkseg></trkseg></trk></gpx>', 'empty').points).toEqual([])
  })

  it('handles points with no time element', () => {
    const t = parseGpx('<gpx><trk><trkseg><trkpt lat="39.6" lon="-105.0"></trkpt></trkseg></trk></gpx>', 'notime')
    expect(t.points).toHaveLength(1)
    expect(t.points[0].t).toBe(0)
  })

  it('reads multiple segments as one continuous track', () => {
    const two = GPX.replace('</trkseg>', '</trkseg><trkseg><trkpt lat="39.7" lon="-105.1"><time>2026-07-28T13:00:10Z</time></trkpt></trkseg>')
    expect(parseGpx(two, 'multi').points).toHaveLength(3)
  })
})
