import { Encoder, Profile } from '@garmin/fitsdk'

/**
 * The SDK types `onMesg`'s payload as a narrow `Mesg`, but the encoder accepts
 * any profile field at runtime — that is how it writes real files. One cast in
 * one helper keeps the builder readable without loosening types elsewhere.
 */
function emit(encoder: Encoder, mesgNum: number, fields: Record<string, unknown>): void {
  ;(encoder.onMesg as (n: number, f: Record<string, unknown>) => void)(mesgNum, fields)
}

/**
 * Build a synthetic virtual-ride FIT file in memory.
 *
 * Replaces a real Zwift recording that used to be committed here. That file
 * carried no location or identity data -- its coordinates are Watopia -- but it
 * did carry one session's power, cadence and calorie figures plus a device
 * serial, which is not something a public repo needs.
 *
 * Everything here is invented. The values are chosen to exercise the two
 * things most likely to break silently:
 *
 *  - **Semicircle conversion.** Positions are written as raw semicircles, the
 *    unit FIT actually stores. A parser that forgets to convert produces
 *    numbers like -138818392 rather than obviously failing.
 *  - **Virtual-ride detection.** `subSport` and `manufacturer` are both set,
 *    because the filter must reject on either alone.
 */

/** degrees -> semicircles, the inverse of what the parser must do. */
export function degreesToSemicircles(degrees: number): number {
  return Math.round(degrees / (180 / 2 ** 31))
}

/** Watopia, Zwift's virtual world: in the Solomon Sea, far from any real ride. */
export const SYNTHETIC_START = { lat: -11.63562, lon: 166.95261 }

export const SYNTHETIC_RECORD_COUNT = 120

export type SyntheticOptions = {
  manufacturer?: string
  subSport?: string
  recordCount?: number
  /** Emit records with no position, as a trainer session would. */
  positioned?: boolean
}

export function buildSyntheticFit(options: SyntheticOptions = {}): Uint8Array {
  const {
    manufacturer = 'zwift',
    subSport = 'virtualActivity',
    recordCount = SYNTHETIC_RECORD_COUNT,
    positioned = true,
  } = options

  const encoder = new Encoder()
  const start = new Date('2024-01-17T21:26:09.000Z')

  emit(encoder, Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer,
    product: 0,
    timeCreated: start,
    serialNumber: 1,
  })

  for (let i = 0; i < recordCount; i++) {
    // A straight eastward line, ~1 m per step. Enough to be a real path
    // without encoding anything about a real place.
    const lat = SYNTHETIC_START.lat
    const lon = SYNTHETIC_START.lon + i * 0.00001

    const record: Record<string, unknown> = {
      timestamp: new Date(start.getTime() + i * 1000),
      distance: i * 1.0,
      speed: 1.5,
    }
    if (positioned) {
      record.positionLat = degreesToSemicircles(lat)
      record.positionLong = degreesToSemicircles(lon)
    }
    emit(encoder, Profile.MesgNum.RECORD, record)
  }

  emit(encoder, Profile.MesgNum.SESSION, {
    timestamp: new Date(start.getTime() + recordCount * 1000),
    startTime: start,
    sport: 'cycling',
    subSport,
    totalElapsedTime: recordCount,
    totalDistance: recordCount * 1.0,
  })

  return encoder.close()
}
