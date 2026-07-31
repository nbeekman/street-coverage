export type Timed<T> = {
  value: T
  /** Wall time of the load that actually ran, replayed to cached callers. */
  decodeMs: number
}

/**
 * Run an async load at most once per page, timing it.
 *
 * The view hooks re-run their effect every time their view is switched back
 * to. Without this each switch refetched the whole snapshot and handed the map
 * a brand new object -- and since deck.gl compares props by reference, that
 * re-uploaded every vertex and redrew geometry that was already on screen.
 *
 * A rejection is deliberately not cached: a load that failed on a flaky
 * connection should be retried when the user next asks for that view, not
 * replayed as a permanent error.
 */
export function timedOnce<A extends unknown[], T>(
  load: (...args: A) => Promise<T>,
): (...args: A) => Promise<Timed<T>> {
  let pending: Promise<Timed<T>> | null = null

  return (...args: A) => {
    if (pending !== null) return pending

    const started = performance.now()
    pending = load(...args)
      .then((value) => ({ value, decodeMs: Math.round(performance.now() - started) }))
      .catch((error: unknown) => {
        pending = null
        throw error
      })
    return pending
  }
}
