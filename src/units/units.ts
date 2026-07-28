/**
 * Display units. Storage and computation are always meters -- this module
 * only converts at the edge, so no distance is ever round-tripped through a
 * lossy unit and back.
 */
export type Units = 'mi' | 'km'

/** International mile. Exact by definition. */
const METERS_PER_MILE = 1609.344

/** International foot. Exact by definition. */
const METERS_PER_FOOT = 0.3048

const METERS_PER_KM = 1000

/** The rider is in Denver. Miles is what the ride computer reads. */
export const DEFAULT_UNITS: Units = 'mi'

export function toggleUnits(units: Units): Units {
  return units === 'mi' ? 'km' : 'mi'
}

export function isUnits(value: unknown): value is Units {
  return value === 'mi' || value === 'km'
}

/** Long distances -- route and network totals. */
export function distanceIn(meters: number, units: Units): number {
  return meters / (units === 'mi' ? METERS_PER_MILE : METERS_PER_KM)
}

export function distanceLabel(units: Units): string {
  return units
}

export function formatDistance(meters: number, units: Units, digits = 0): string {
  return distanceIn(meters, units).toFixed(digits)
}

/**
 * Short distances -- the privacy clip radius and the match radius, which are
 * hundreds of meters rather than thousands. Miles would read as "0.31".
 */
export function shortDistanceIn(meters: number, units: Units): number {
  return units === 'mi' ? meters / METERS_PER_FOOT : meters
}

export function shortDistanceLabel(units: Units): string {
  return units === 'mi' ? 'ft' : 'm'
}

export function formatShortDistance(meters: number, units: Units): string {
  return Math.round(shortDistanceIn(meters, units)).toLocaleString()
}
