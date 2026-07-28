import { VIEW_MODES, type ViewMode } from './viewMode.ts'

type Props = {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  /** Disable the rides option when no ride snapshot is present. */
  ridesAvailable: boolean
}

/**
 * Exclusive selector, so coverage and traces can never be shown at once.
 * A radiogroup rather than two checkboxes -- that is what it actually is.
 */
export default function ViewToggle({ mode, onChange, ridesAvailable }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Map view"
      className="flex overflow-hidden rounded-md border border-white/20 text-xs"
    >
      {VIEW_MODES.map((option) => {
        const active = option.id === mode
        const disabled = option.id === 'rides' && !ridesAvailable
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!active && !disabled) onChange(option.id)
            }}
            className={
              disabled
                ? 'cursor-not-allowed px-3 py-1 text-neutral-600'
                : active
                  ? 'cursor-default bg-white/85 px-3 py-1 font-medium text-black'
                  : 'cursor-pointer px-3 py-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-200'
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
