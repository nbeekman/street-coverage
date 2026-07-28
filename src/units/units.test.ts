import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UNITS,
  distanceIn,
  distanceLabel,
  formatDistance,
  formatShortDistance,
  isUnits,
  shortDistanceIn,
  shortDistanceLabel,
  toggleUnits,
  type Units,
} from './units.ts'

describe('DEFAULT_UNITS', () => {
  it('is miles', () => {
    expect(DEFAULT_UNITS).toBe('mi')
  })
})

describe('toggleUnits', () => {
  it('swaps between the two units', () => {
    expect(toggleUnits('mi')).toBe('km')
    expect(toggleUnits('km')).toBe('mi')
  })

  it('round-trips to itself', () => {
    for (const u of ['mi', 'km'] as Units[]) {
      expect(toggleUnits(toggleUnits(u))).toBe(u)
    }
  })
})

describe('isUnits', () => {
  it('accepts the two valid values', () => {
    expect(isUnits('mi')).toBe(true)
    expect(isUnits('km')).toBe(true)
  })

  it('rejects anything else, so a corrupt stored value falls back', () => {
    expect(isUnits('miles')).toBe(false)
    expect(isUnits('')).toBe(false)
    expect(isUnits(null)).toBe(false)
    expect(isUnits(undefined)).toBe(false)
    expect(isUnits(1609)).toBe(false)
  })
})

describe('distanceIn', () => {
  it('converts meters to kilometers', () => {
    expect(distanceIn(1000, 'km')).toBe(1)
    expect(distanceIn(9224000, 'km')).toBe(9224)
  })

  it('uses the exact international mile', () => {
    expect(distanceIn(1609.344, 'mi')).toBe(1)
  })

  it('converts a marathon to the distance everyone knows', () => {
    expect(distanceIn(42195, 'mi')).toBeCloseTo(26.2188, 3)
  })

  it('converts the real ridden total consistently in both units', () => {
    const meters = 3955193.539
    expect(distanceIn(meters, 'km')).toBeCloseTo(3955.19, 2)
    expect(distanceIn(meters, 'mi')).toBeCloseTo(2457.6433, 3)
  })

  it('reports miles as the smaller number, since a mile is longer', () => {
    const meters = 50000
    expect(distanceIn(meters, 'mi')).toBeLessThan(distanceIn(meters, 'km'))
  })

  it('leaves zero alone in both units', () => {
    expect(distanceIn(0, 'mi')).toBe(0)
    expect(distanceIn(0, 'km')).toBe(0)
  })
})

describe('distanceLabel', () => {
  it('labels each unit', () => {
    expect(distanceLabel('mi')).toBe('mi')
    expect(distanceLabel('km')).toBe('km')
  })
})

describe('formatDistance', () => {
  it('defaults to whole units', () => {
    expect(formatDistance(9224000, 'km')).toBe('9224')
    expect(formatDistance(9224000, 'mi')).toBe('5732')
  })

  it('honours a digit count', () => {
    expect(formatDistance(1609.344, 'mi', 2)).toBe('1.00')
    expect(formatDistance(1500, 'km', 1)).toBe('1.5')
  })
})

describe('short distances', () => {
  it('uses feet under miles and meters under km', () => {
    expect(shortDistanceLabel('mi')).toBe('ft')
    expect(shortDistanceLabel('km')).toBe('m')
  })

  it('leaves meters untouched under km', () => {
    expect(shortDistanceIn(500, 'km')).toBe(500)
  })

  it('converts the 500 m privacy clip to feet', () => {
    expect(shortDistanceIn(500, 'mi')).toBeCloseTo(1640.42, 2)
    expect(formatShortDistance(500, 'mi')).toBe('1,640')
    expect(formatShortDistance(500, 'km')).toBe('500')
  })

  it('converts the 25 m match radius to a readable number of feet', () => {
    expect(formatShortDistance(25, 'mi')).toBe('82')
    expect(formatShortDistance(25, 'km')).toBe('25')
  })
})
