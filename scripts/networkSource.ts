import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalize, type NormalizedWay, type OsmElement } from '../src/network/normalize.ts'
import { REGIONS, buildOverpassQuery, regionById, type Region } from '../src/network/regions.ts'

export const RAW_DIR = join(process.cwd(), 'data', 'raw')

export type RawPayload = {
  regionId: string
  fetchedAt: string
  osmTimestamp: string
  queryHash: string
  elements: OsmElement[]
}

export type RegionSource = {
  region: Region
  /** Deduplicated: every way belongs to exactly one region. */
  ways: NormalizedWay[]
  /** Distinct OSM nodes across the retained ways. */
  uniqueNodeCount: number
  droppedWays: number
  dedupedWays: number
  osmTimestamp: string
  queryHash: string
}

/**
 * Load every fetched region, normalize it, and assign each way to exactly one
 * region.
 *
 * Shared by `build-snapshot` and `build-coverage` so the rendered network and
 * the coverage denominator are computed from an identical way set. When these
 * two drifted apart the symptom would be a percentage that does not match the
 * visible map -- the same class of silent error as M1's stale-query bug.
 */
export async function loadRegionSources(rawDir = RAW_DIR): Promise<RegionSource[]> {
  let files: string[]
  try {
    files = (await readdir(rawDir)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new Error(
      `No raw data at ${rawDir}. Run "npm run fetch:network -- --group metro-core" first.`,
    )
  }
  if (files.length === 0) {
    throw new Error(
      `No raw data at ${rawDir}. Run "npm run fetch:network -- --group metro-core" first.`,
    )
  }

  // REGIONS order is the dedup precedence: boundary regions claim their ways
  // before any polygon catch-all sees them.
  const present = new Set(files.map((f) => f.slice(0, -5)))
  const ordered = REGIONS.filter((r) => present.has(r.id)).map((r) => `${r.id}.json`)
  const unknown = files.filter((f) => !ordered.includes(f))
  if (unknown.length > 0) {
    throw new Error(`Raw files for regions not in the registry: ${unknown.join(', ')}`)
  }

  const claimed = new Set<number>()
  const sources: RegionSource[] = []

  for (const file of ordered) {
    const raw = JSON.parse(await readFile(join(rawDir, file), 'utf8')) as RawPayload
    const region = regionById(raw.regionId)
    if (!region) throw new Error(`Raw file references unknown region "${raw.regionId}"`)

    // A failed --force leaves the previous raw file untouched, so a region can
    // silently carry data fetched with an older query. The filter has already
    // changed once (bike-legal path/bridleway); building a mixed snapshot set
    // would corrupt the denominator with no visible symptom.
    const expectedHash = createHash('sha256')
      .update(buildOverpassQuery(region))
      .digest('hex')
      .slice(0, 16)
    if (raw.queryHash !== expectedHash) {
      throw new Error(
        `Region "${region.id}" was fetched with a different query ` +
          `(raw ${raw.queryHash}, current ${expectedHash}). ` +
          `Re-run: npm run fetch:network -- --region ${region.id} --force`,
      )
    }

    const network = normalize(raw.elements)

    const before = network.ways.length
    const ways = network.ways.filter((w) => !claimed.has(w.id))
    for (const w of ways) claimed.add(w.id)

    if (ways.length === 0) {
      throw new Error(
        `Region "${region.id}" has no ways left after dedup (${before} were all claimed by earlier regions)`,
      )
    }

    // normalize() counted nodes across every way it returned, including the
    // ones dedup just removed. Recount over what actually ships, or a heavily
    // deduped region reports more unique nodes than it has vertices.
    const retained = new Set<number>()
    for (const w of ways) for (const ref of w.nodeRefs) retained.add(ref)

    sources.push({
      region,
      ways,
      uniqueNodeCount: retained.size,
      droppedWays: network.droppedWays,
      dedupedWays: before - ways.length,
      osmTimestamp: raw.osmTimestamp,
      queryHash: raw.queryHash,
    })
  }

  return sources
}
