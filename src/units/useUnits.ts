import { useCallback, useState } from 'react'
import { DEFAULT_UNITS, isUnits, toggleUnits, type Units } from './units.ts'

const STORAGE_KEY = 'street-coverage:units'

/**
 * localStorage throws in Safari private browsing rather than returning null,
 * so every access is guarded. A missing or corrupt value falls back to the
 * default instead of breaking the panel.
 */
function readStored(): Units {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isUnits(raw) ? raw : DEFAULT_UNITS
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
