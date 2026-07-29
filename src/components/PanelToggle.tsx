type Props = {
  open: boolean
  onToggle: () => void
}

/**
 * Opens the stats drawer on small screens.
 *
 * Hidden from `md` up, where the panel is always on screen and a toggle would
 * only be a way to lose it.
 */
export default function PanelToggle({ open, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide stats' : 'Show stats'}
      className="absolute top-3 left-3 z-30 flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 bg-black/75 text-neutral-200 backdrop-blur md:hidden"
    >
      {open ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 6h18M3 12h18M3 18h18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}
