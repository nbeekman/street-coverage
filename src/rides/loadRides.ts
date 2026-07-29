import { validateRides, type RidesBuffers, type RidesManifest } from './snapshot.ts'

export type LoadedRides = {
  manifest: RidesManifest
  buffers: RidesBuffers
  origin: [number, number]
  offsets: Float32Array
}

type FetchLike = typeof globalThis.fetch

/**
 * Load the rides snapshot, or null if there isn't one.
 *
 * Having no rides yet is a normal state -- the snapshot is gitignored, so a
 * fresh clone always starts without it. Only a corrupt or mismatched snapshot
 * is an error.
 */
export async function loadRides(
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<LoadedRides | null> {
  const res = await fetchImpl('rides/manifest.json')
  if (!res.ok) return null

  const text = await res.text()
  // A dev server's SPA fallback answers a missing file with index.html at 200.
  if (text.trimStart().startsWith('<')) return null

  let manifest: RidesManifest
  try {
    manifest = JSON.parse(text) as RidesManifest
  } catch {
    return null
  }

  const get = async (name: string) => {
    const r = await fetchImpl(`rides/${name}`)
    if (!r.ok) throw new Error(`rides/${name} returned HTTP ${r.status}`)
    return r.arrayBuffer()
  }

  const [pos, starts, times, metersBytes] = await Promise.all([
    get('offsets.bin'),
    get('startIndices.bin'),
    get('times.bin'),
    get('meters.bin'),
  ])

  const buffers: RidesBuffers = {
    offsets: new Float32Array(pos),
    startIndices: new Uint32Array(starts),
    times: new Float64Array(times),
    meters: new Float32Array(metersBytes),
  }

  validateRides(manifest, buffers)

  // Both precomputed at build time; no Float64 reaches the browser.
  return { manifest, buffers, origin: manifest.origin, offsets: buffers.offsets }
}
