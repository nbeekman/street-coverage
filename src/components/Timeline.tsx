import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { YearFilter } from '../coverage/yearFilter.ts'

type Props = {
  /** Calendar years with rides, ascending. */
  years: readonly number[]
  filter: YearFilter
  /**
   * Coverage accumulates, so its timeline reads 'through 2019'. Ride traces
   * do not -- each frame draws only that year's rides -- so the same slider
   * has to describe itself differently depending on what it is driving.
   */
  cumulative: boolean
  playing: boolean
  onPlayingChange: (playing: boolean) => void
  /** A setter, not a plain callback: playing advances from the previous
   * value, and reading that from a stale closure would skip years. */
  onChange: Dispatch<SetStateAction<YearFilter>>
}

/** Milliseconds each year holds while playing. */
const FRAME_MS = 900

/**
 * Drag through time and watch the map fill in.
 *
 * Cumulative: at 2020 the map shows everything ridden up to and including
 * 2020, which is the question a timeline asks. The year buttons above answer
 * the different question of what was covered *during* one year.
 *
 * No new data. "As of year Y" is a mask of every bit up to Y over the same
 * run buffers the year filter already uses, so scrubbing costs one pass over
 * ~70,000 runs and no fetching.
 */
export default function Timeline({
  years,
  filter,
  cumulative,
  playing,
  onPlayingChange,
  onChange,
}: Props) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Which year the slider sits at. All-time parks it at the end, since
  // all-time and "through the final year" show the same map.
  const index =
    filter !== null && filter.kind === 'through' ? filter.index : years.length - 1

  useEffect(() => {
    if (!playing) return
    timer.current = setInterval(() => {
      onChange((current) => {
        const at =
          current !== null && current.kind === 'through' ? current.index : -1
        // Stop at the end rather than looping: the point is watching it fill
        // up, and a loop that silently resets makes the last frame ambiguous.
        if (at >= years.length - 1) {
          onPlayingChange(false)
          return current
        }
        return { kind: 'through', index: at + 1 }
      })
    }, FRAME_MS)
    return () => {
      if (timer.current !== null) clearInterval(timer.current)
    }
  }, [playing, years.length, onChange])

  if (years.length < 2) return null

  const play = () => {
    // Replaying from the end would show nothing happening.
    if (index >= years.length - 1) onChange({ kind: 'through', index: 0 })
    onPlayingChange(true)
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (playing ? onPlayingChange(false) : play())}
          aria-label={playing ? 'Pause timeline' : 'Play timeline'}
          className="rounded border border-white/25 px-2 py-0.5 text-xs text-neutral-200 hover:bg-white/10"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={years.length - 1}
          value={index}
          aria-label="Show coverage as of year"
          onChange={(e) => {
            onPlayingChange(false)
            onChange({ kind: 'through', index: Number(e.target.value) })
          }}
          className="h-1 flex-1 accent-amber-300"
        />
        <span className="w-10 text-right text-xs tabular-nums text-neutral-300">
          {years[index]}
        </span>
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        {cumulative
          ? `Everything ridden through ${years[index]}`
          : `Rides from ${years[index]}`}
      </div>
    </div>
  )
}
