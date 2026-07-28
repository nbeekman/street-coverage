import type { OsmElement } from '../src/network/normalize.ts'
import { buildOverpassQuery, type Region } from '../src/network/regions.ts'

/**
 * Deliberately excludes overpass.osm.ch: it responds quickly but holds only
 * Switzerland, returning a clean, parseable, empty result for Colorado.
 */
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const

export type OverpassErrorCode =
  | 'HTML_ERROR'
  | 'BAD_JSON'
  | 'BAD_SHAPE'
  | 'EMPTY_RESULT'
  | 'HTTP_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'EXHAUSTED'

export class OverpassError extends Error {
  code: OverpassErrorCode

  constructor(code: OverpassErrorCode, message: string) {
    super(message)
    this.name = 'OverpassError'
    this.code = code
  }
}

export type OverpassResponse = {
  elements: OsmElement[]
  osm3s?: { timestamp_osm_base?: string }
}

/**
 * Overpass signals overload with an HTML body under HTTP 200, so status codes
 * alone are not enough. A zero-way result is also treated as failure: every
 * region in the registry is known to contain streets, so an empty response
 * means the query or the area resolution is wrong, not that the town is empty.
 */
export function parseOverpassBody(body: string): OverpassResponse {
  if (body.trimStart().startsWith('<')) {
    throw new OverpassError(
      'HTML_ERROR',
      `Overpass returned an HTML error body: ${body.slice(0, 200)}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new OverpassError('BAD_JSON', `Response was not valid JSON: ${body.slice(0, 200)}`)
  }

  const candidate = parsed as Partial<OverpassResponse>
  if (!Array.isArray(candidate.elements)) {
    throw new OverpassError('BAD_SHAPE', 'Response has no "elements" array.')
  }

  const wayCount = candidate.elements.filter((e) => e.type === 'way').length
  if (wayCount === 0) {
    throw new OverpassError(
      'EMPTY_RESULT',
      'Response contained zero ways. The area probably failed to resolve.',
    )
  }

  return candidate as OverpassResponse
}

type FetchLike = (
  url: string,
  init: { method: string; body: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export type FetchRegionOptions = {
  fetchImpl?: FetchLike
  mirrors?: readonly string[]
  maxAttempts?: number
  sleepMs?: number
  /** Per-attempt ceiling. See REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number
  /** Called before each attempt so a long run is not silent. */
  onAttempt?: (info: { attempt: number; url: string }) => void
  /** Called when an attempt fails, with how long it burned. */
  onAttemptFailed?: (info: { attempt: number; url: string; ms: number; error: unknown }) => void
}

/**
 * Cap a single attempt.
 *
 * Without this, a hung mirror blocks until the OS abandons the TCP
 * connection -- minutes of dead waiting per attempt. Measured 2026-07-28:
 * two of three public mirrors accepted connections and never responded, while
 * a healthy mirror answered a 23k-way query in 15s.
 *
 * Raised from 90s to 180s after Aurora failed all 9 attempts: a large region
 * against a busy server is slow but not hung, and 90s could not tell the two
 * apart. Override per run with --timeout when a region is bigger still.
 */
const REQUEST_TIMEOUT_MS = 180_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchRegion(
  region: Region,
  options: FetchRegionOptions = {},
): Promise<OverpassResponse> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const mirrors = options.mirrors ?? OVERPASS_MIRRORS
  const maxAttempts = options.maxAttempts ?? 9
  const baseSleep = options.sleepMs ?? 8000

  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const query = buildOverpassQuery(region)
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = mirrors[attempt % mirrors.length]
    const started = Date.now()
    options.onAttempt?.({ attempt, url })

    // A hung mirror never rejects on its own; this is what bounds the attempt.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': 'street-coverage/0.1 (github.com/nbeekman)' },
        signal: controller.signal,
      })
      if (res.status === 429) {
        // Overpass throttles per IP. Distinct from a 5xx: the server is fine,
        // we are asking too fast, and the caller should slow down rather than
        // just rotate mirrors.
        throw new OverpassError('RATE_LIMITED', `${url} rate-limited us (HTTP 429)`)
      }
      if (!res.ok) {
        throw new OverpassError('HTTP_ERROR', `${url} returned HTTP ${res.status}`)
      }
      return parseOverpassBody(await res.text())
    } catch (error) {
      const wrapped =
        error instanceof Error && error.name === 'AbortError'
          ? new OverpassError('TIMEOUT', `${url} did not respond within ${timeoutMs / 1000}s`)
          : error
      lastError = wrapped
      options.onAttemptFailed?.({ attempt, url, ms: Date.now() - started, error: wrapped })

      if (attempt < maxAttempts - 1 && baseSleep > 0) {
        // Backoff caps at 60s; mirrors recover on the order of minutes.
        await sleep(Math.min(baseSleep * 2 ** Math.floor(attempt / mirrors.length), 60_000))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw new OverpassError(
    'EXHAUSTED',
    `All ${maxAttempts} attempts failed for region "${region.id}". Last error: ${String(lastError)}`,
  )
}
