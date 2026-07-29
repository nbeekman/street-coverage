import type { YearFilter } from '../coverage/yearFilter.ts'

type Props = {
  /** Calendar years with rides, ascending. Index is the filter value. */
  years: readonly number[]
  filter: YearFilter
  onChange: (filter: YearFilter) => void
}

/**
 * All-time, or one year.
 *
 * Only years present in the data are offered -- the manifest lists exactly the
 * years that have rides, so a gap year never appears as a dead option.
 */
export default function YearSelector({ years, filter, onChange }: Props) {
  if (years.length === 0) return null

  const sameFilter = (a: YearFilter, b: YearFilter) =>
    a === null || b === null ? a === b : a.kind === b.kind && a.index === b.index

  const option = (label: string, value: YearFilter) => {
    const active = sameFilter(filter, value)
    return (
      <button
        key={label}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => !active && onChange(value)}
        className={
          'rounded px-1.5 py-0.5 text-xs tabular-nums ' +
          (active
            ? 'cursor-default bg-white/85 font-medium text-black'
            : 'cursor-pointer text-neutral-400 hover:bg-white/10 hover:text-neutral-200')
        }
      >
        {label}
      </button>
    )
  }

  return (
    <div role="radiogroup" aria-label="Filter by year" className="flex flex-wrap gap-1">
      {option('All time', null)}
      {years.map((year, index) => option(String(year), { kind: 'year', index }))}
    </div>
  )
}
