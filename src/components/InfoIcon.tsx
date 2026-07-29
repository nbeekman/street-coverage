type Props = {
  open: boolean
  onToggle: () => void
  /** What the icon explains, for screen readers. */
  label: string
  /** Id of the element holding the explanation. */
  controls: string
}

/**
 * Small "i" that reveals an explanation.
 *
 * Hover opens it on a pointer; click toggles, which is the only thing that
 * works on a touch screen. Focus opens it too, so it is reachable by keyboard.
 *
 * The explanation itself is rendered by the parent rather than here: this icon
 * lives inside a table wrapped in `overflow-x-auto`, and a scroll container
 * clips both axes -- an absolutely positioned tooltip would be cut off.
 */
export default function InfoIcon({ open, onToggle, label, controls }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      onMouseEnter={() => !open && onToggle()}
      onMouseLeave={() => open && onToggle()}
      onFocus={() => !open && onToggle()}
      onBlur={() => open && onToggle()}
      className={
        'ml-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border align-middle text-[9px] leading-none ' +
        (open
          ? 'border-white/60 bg-white/20 text-neutral-100'
          : 'border-white/30 text-neutral-400 hover:border-white/60 hover:text-neutral-100')
      }
    >
      i
    </button>
  )
}
