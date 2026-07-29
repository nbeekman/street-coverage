import { useCallback, useState } from 'react'
import { DEFAULT_UNITS, isUnits, toggleUnits, type Units } from './units.ts'

const STORAGE_KEY = 'cycling-denver:units'

/** The key used before the project was renamed. Read once, then migrated. */
const LEGACY_STORAGE_KEY = 'street-coverage:units'

/**
 * localStorage throws in Safari private browsing rather than returning null,
 * so every access is guarded. A missing or corrupt value falls back to the
 * default instead of breaking the panel.
 *
 * The rename would otherwise silently reset a saved preference, so a value
 * left under the old key is carried across on first read.
 */
function readStored(): Units {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (isUnits(raw)) return raw

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (isUnits(legacy)) {
      localStorage.setItem(STORAGE_KEY, legacy)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return legacy
    }
    return DEFAULT_UNITS
  } catch {
    return DEFAULT_UNITS
  }
}

function writeStored(units: Units): void {
  try {
    localStorage.setItem(STORAGE_KEY, units)
  } catch {
    // A preference that fails to persist is not worth breaking the render for.
  }
}

export function useUnits(): { units: Units; toggle: () => void } {
  const [units, setUnits] = useState<Units>(readStored)

  const toggle = useCallback(() => {
    setUnits((current) => {
      const next = toggleUnits(current)
      writeStored(next)
      return next
    })
  }, [])

  return { units, toggle }
}
