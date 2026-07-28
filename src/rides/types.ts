/** One recorded position. `t` is epoch milliseconds. */
export type TrackPoint = {
  lon: number
  lat: number
  t: number
}

/** A parsed activity file, before filtering or clipping. */
export type RawTrack = {
  /** Stable id derived from the source filename. */
  id: string
  /** Epoch ms of the first record. */
  startTime: number
  source: 'fit' | 'gpx'
  /** FIT session fields; absent for GPX. Used to detect virtual rides. */
  sport?: string
  subSport?: string
  manufacturer?: string
  points: TrackPoint[]
}

/** A track that survived filtering, clipping and resampling. */
export type Ride = {
  id: string
  startTime: number
  points: TrackPoint[]
}
