/**
 * The map shows one of these at a time.
 *
 * They were independent checkboxes, which allowed both at once -- and the
 * semi-transparent traces then sat on top of the coverage colors they were
 * meant to be compared against, so neither read clearly. Exclusive modes make
 * the comparison a toggle rather than a pile.
 */
export type ViewMode = 'coverage' | 'rides'

export const VIEW_MODES: readonly { id: ViewMode; label: string }[] = [
  { id: 'coverage', label: 'Coverage' },
  { id: 'rides', label: 'Rides' },
]
