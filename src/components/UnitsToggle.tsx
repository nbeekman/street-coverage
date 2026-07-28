import type { Units } from '../units/units.ts'

const OPTIONS: readonly Units[] = ['mi', 'km']

type Props = {
  units: Units
  onToggle: () => void
}

/**
 * Two-state segmented control. Clicking the inactive side toggles; clicking
 * the active side is a no-op, so a stray double-click cannot flip it back.
 */
export default function UnitsToggle({ units, onToggle }: Props) {
  return (
    <div
      role="group"
      aria-label="Distance units"
      className="flex overflow-hidden rounded-md border border-white/20 text-xs"
    >
      {OPTIONS.map((option) => {
        const active = option === units
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) onToggle()
            }}
            className={
              active
                ? 'cursor-default bg-white/85 px-2 py-0.5 font-medium text-black'
                : 'cursor-pointer px-2 py-0.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
            }
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
