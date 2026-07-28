import { Decoder, Stream } from '@garmin/fitsdk'
import { semicirclesToDegrees } from '../src/rides/semicircles.ts'
import type { RawTrack, TrackPoint } from '../src/rides/types.ts'

type FitRecord = {
  positionLat?: number
  positionLong?: number
  timestamp?: Date | number
}

/**
 * Parse a FIT activity into a RawTrack.
 *
 * Positions arrive as semicircles and the SDK does not convert them, even with
 * applyScaleAndOffset. See src/rides/semicircles.ts.
 */
export function parseFit(bytes: Uint8Array, id: string): RawTrack {
  const stream = Stream.fromByteArray(bytes)
  if (!Decoder.isFIT(stream)) {
    throw new Error(`"${id}" is not a valid FIT file`)
  }

  const decoder = new Decoder(stream)
  if (!decoder.checkIntegrity()) {
    throw new Error(`"${id}" failed the FIT integrity check`)
  }

  const { messages } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  })

  const records = (messages.recordMesgs ?? []) as FitRecord[]
  const points: TrackPoint[] = []
  for (const r of records) {
    if (r.positionLat == null || r.positionLong == null) continue
    points.push({
      lat: semicirclesToDegrees(r.positionLat),
      lon: semicirclesToDegrees(r.positionLong),
      t: r.timestamp instanceof Date ? r.timestamp.getTime() : Number(r.timestamp ?? 0),
    })
  }

  const session = (messages.sessionMesgs ?? [])[0] as
    | { sport?: string; subSport?: string; startTime?: Date }
    | undefined
  const fileId = (messages.fileIdMesgs ?? [])[0] as
    | { manufacturer?: string; timeCreated?: Date }
    | undefined

  const startTime =
    points[0]?.t ?? (session?.startTime instanceof Date ? session.startTime.getTime() : 0)

  return {
    id,
    startTime,
    source: 'fit',
    sport: session?.sport,
    subSport: session?.subSport,
    manufacturer: fileId?.manufacturer,
    points,
  }
}
