import { describe, expect, it, vi } from 'vitest'
import { regionById } from '../src/network/regions'
import {
  OVERPASS_MIRRORS,
  OverpassError,
  fetchRegion,
  parseOverpassBody,
} from './overpass'

// Captured from overpass-api.de on 2026-07-27. Note: HTTP 200.
const DISPATCHER_TIMEOUT_HTML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "...">
<html><body>
<p><strong style="color:#FF0000">Error</strong>: runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request. </p>
</body></html>`

const VALID_BODY = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-07-27T12:00:00Z' },
  elements: [
    { type: 'node', id: 1, lon: -105, lat: 39.6 },
    { type: 'node', id: 2, lon: -104.9, lat: 39.7 },
    { type: 'way', id: 100, nodes: [1, 2], tags: { highway: 'residential' } },
  ],
})

// What overpass.osm.ch returns for a Colorado query: valid, parseable, empty.
const EMPTY_BODY = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: '2026-07-27T12:00:00Z' },
  elements: [],
})

function jsonResponse(body: string, status = 200) {
  return { ok: status < 400, status, text: async () => body }
}

describe('OVERPASS_MIRRORS', () => {
  it('excludes the Switzerland-only mirror', () => {
    // overpass.osm.ch answers fast but holds only Switzerland, returning a
    // clean empty result for Colorado rather than an error.
    expect(OVERPASS_MIRRORS.join(' ')).not.toContain('osm.ch')
  })

  it('lists more than one mirror', () => {
    expect(OVERPASS_MIRRORS.length).toBeGreaterThan(1)
  })
})

describe('parseOverpassBody', () => {
  it('parses a valid response', () => {
    const r = parseOverpassBody(VALID_BODY)
    expect(r.elements).toHaveLength(3)
    expect(r.osm3s?.timestamp_osm_base).toBe('2026-07-27T12:00:00Z')
  })

  it('rejects an HTML error body delivered with HTTP 200', () => {
    try {
      parseOverpassBody(DISPATCHER_TIMEOUT_HTML)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('HTML_ERROR')
    }
  })

  it('rejects unparseable JSON', () => {
    try {
      parseOverpassBody('{not json')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('BAD_JSON')
    }
  })

  it('rejects JSON with no elements array', () => {
    try {
      parseOverpassBody('{"version":0.6}')
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('BAD_SHAPE')
    }
  })

  it('rejects a response containing zero ways', () => {
    // The broken area-id form returned exactly this. Treating it as an empty
    // region would have written a valid-looking, entirely wrong snapshot.
    try {
      parseOverpassBody(EMPTY_BODY)
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as OverpassError).code).toBe('EMPTY_RESULT')
    }
  })
})

describe('fetchRegion', () => {
  const region = regionById('littleton')!
  const opts = { mirrors: ['https://a.test', 'https://b.test'], sleepMs: 0 }

  it('returns the parsed body on first success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_BODY))
    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rotates to the next mirror after an HTML error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(DISPATCHER_TIMEOUT_HTML))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))

    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://a.test')
    expect(fetchImpl.mock.calls[1][0]).toBe('https://b.test')
  })

  it('retries after a thrown network error', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))
    const r = await fetchRegion(region, { ...opts, fetchImpl })
    expect(r.elements).toHaveLength(3)
  })

  it('gives up after maxAttempts and reports the last cause', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(DISPATCHER_TIMEOUT_HTML))
    await expect(
      fetchRegion(region, { ...opts, fetchImpl, maxAttempts: 3 }),
    ).rejects.toThrow(/littleton/i)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('abandons a mirror that never responds, rather than waiting forever', async () => {
    // Measured 2026-07-28: two of three public mirrors accepted the connection
    // and never answered. Without a per-attempt timeout, fetch() blocks until
    // the OS gives up on the socket -- minutes of dead waiting per attempt,
    // which is what made one region take 894s.
    const hung = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )
    await expect(
      fetchRegion(region, {
        ...opts,
        fetchImpl: hung as never,
        maxAttempts: 2,
        requestTimeoutMs: 20,
      }),
    ).rejects.toThrow(/attempts failed/i)
    expect(hung).toHaveBeenCalledTimes(2)
  })

  it('reports each attempt so a slow run is not silent', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(DISPATCHER_TIMEOUT_HTML))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))
    const attempts: number[] = []
    const failures: string[] = []

    await fetchRegion(region, {
      ...opts,
      fetchImpl,
      onAttempt: ({ attempt }) => attempts.push(attempt),
      onAttemptFailed: ({ error }) => failures.push((error as OverpassError).code),
    })

    expect(attempts).toEqual([0, 1])
    expect(failures).toEqual(['HTML_ERROR'])
  })

  it('distinguishes rate limiting from other HTTP errors', async () => {
    // Overpass throttles per IP. A 429 means slow down, not "this mirror is
    // broken" -- the CLI uses the distinct code to trigger a cooldown rather
    // than just rotating to the next mirror.
    const limited = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('', 429))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))
    const codes: string[] = []
    await fetchRegion(region, {
      ...opts,
      fetchImpl: limited as never,
      onAttemptFailed: ({ error }) => codes.push((error as OverpassError).code),
    })
    expect(codes).toEqual(['RATE_LIMITED'])
  })

  it('reports a 5xx as a plain HTTP error, not rate limiting', async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('', 504))
      .mockResolvedValueOnce(jsonResponse(VALID_BODY))
    const codes: string[] = []
    await fetchRegion(region, {
      ...opts,
      fetchImpl: failing as never,
      onAttemptFailed: ({ error }) => codes.push((error as OverpassError).code),
    })
    expect(codes).toEqual(['HTTP_ERROR'])
  })

  it('posts the region query as the request body', async () => {
    // The parameters must be declared for mock.calls to be a typed tuple;
    // a bare vi.fn() infers calls as [] and indexing it is a type error.
    const fetchImpl = vi.fn(
      async (_url: string, _init: { method: string; body: string; headers: Record<string, string> }) =>
        jsonResponse(VALID_BODY),
    )
    await fetchRegion(region, { ...opts, fetchImpl })
    const init = fetchImpl.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.body).toContain('rel(112959);map_to_area->.r;')
  })
})
